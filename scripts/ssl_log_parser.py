"""SSL game log parser.

Parses standard SSL binary log format (.log.gz) and extracts goal scenes.
Each goal scene contains ball/robot positions for the 10 seconds before the goal.

SSL log format:
  Header: "SSL_LOG_FILE" (12 bytes) + version (int32, big-endian)
  Messages: timestamp_ns (int64) + message_type (int32) + size (int32) + data
  Message types:
    2: SSL_WrapperPacket (vision 2010)
    3: Referee
    4: SSL_WrapperPacket (vision 2014)
    5: TrackerWrapperPacket (tracker 2020)
"""

import gzip
import io
import struct
import sys
import os
import zlib
from typing import Iterator

# protoモジュールをパスに追加
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_SCRIPT_DIR, "proto"))

from state import ssl_gc_referee_message_pb2
from vision import ssl_vision_wrapper_pb2
from messages_robocup_ssl_wrapper_tracked_pb2 import TrackerWrapperPacket

MSG_TYPE_VISION_2010 = 2
MSG_TYPE_REFEREE = 3
MSG_TYPE_VISION_2014 = 4
MSG_TYPE_TRACKER = 5

SSL_LOG_HEADER = b"SSL_LOG_FILE"
SCENE_DURATION_SEC = 10.0
OUTPUT_FPS = 10


def _iter_messages(data: bytes) -> Iterator[tuple[int, int, bytes]]:
    """(timestamp_ns, message_type, raw_data) を順に返すイテレータ。"""
    offset = 0

    # ヘッダー検証
    header = data[offset : offset + 12]
    if header != SSL_LOG_HEADER:
        raise ValueError(f"Invalid SSL log header: {header!r}")
    offset += 12
    _version = struct.unpack_from(">i", data, offset)[0]
    offset += 4

    while offset < len(data):
        if offset + 16 > len(data):
            break
        timestamp_ns, msg_type, msg_size = struct.unpack_from(">qii", data, offset)
        offset += 16
        if msg_size < 0 or offset + msg_size > len(data):
            break
        yield timestamp_ns, msg_type, data[offset : offset + msg_size]
        offset += msg_size


def _detection_to_frame(timestamp_ns: int, wrapper) -> dict | None:
    """SSL_WrapperPacket の detection フレームを dict に変換。"""
    if not wrapper.HasField("detection"):
        return None
    det = wrapper.detection
    return {
        "t_ns": timestamp_ns,
        "ball": {"x": int(det.balls[0].x), "y": int(det.balls[0].y)} if det.balls else None,
        "robots_yellow": [
            {"id": r.robot_id, "x": int(r.x), "y": int(r.y), "theta": round(r.orientation, 1)}
            for r in det.robots_yellow
            if r.HasField("x") and r.HasField("y")
        ],
        "robots_blue": [
            {"id": r.robot_id, "x": int(r.x), "y": int(r.y), "theta": round(r.orientation, 1)}
            for r in det.robots_blue
            if r.HasField("x") and r.HasField("y")
        ],
    }


def _tracker_to_frame(timestamp_ns: int, wrapper) -> dict | None:
    """TrackerWrapperPacket のフレームを dict に変換。"""
    if not wrapper.HasField("tracked_frame"):
        return None
    tf = wrapper.tracked_frame
    ball = None
    if tf.balls:
        b = tf.balls[0]
        ball = {"x": int(b.pos.x * 1000), "y": int(b.pos.y * 1000)}

    robots_yellow = []
    robots_blue = []
    from messages_robocup_ssl_detection_tracked_pb2 import TeamColor
    for r in tf.robots:
        team_color = r.robot_id.team_color
        entry = {
            "id": r.robot_id.id,
            "x": int(r.pos.x * 1000),
            "y": int(r.pos.y * 1000),
            "theta": round(r.orientation, 1),
        }
        if team_color == TeamColor.Value("TEAM_COLOR_YELLOW"):
            robots_yellow.append(entry)
        else:
            robots_blue.append(entry)

    return {
        "t_ns": timestamp_ns,
        "ball": ball,
        "robots_yellow": robots_yellow,
        "robots_blue": robots_blue,
    }


def _downsample_frames(
    frames: list[dict], goal_time_ns: int, duration_sec: float, fps: int
) -> list[dict]:
    """ゴール前 duration_sec 秒を fps フレーム/秒にダウンサンプリング。"""
    start_ns = goal_time_ns - int(duration_sec * 1e9)
    interval_ns = int(1e9 / fps)
    result = []

    for i in range(int(duration_sec * fps)):
        target_ns = start_ns + i * interval_ns
        # target_ns に最も近いフレームを選択
        best = min(
            (f for f in frames if f["t_ns"] >= start_ns),
            key=lambda f: abs(f["t_ns"] - target_ns),
            default=None,
        )
        if best is not None:
            result.append({
                "t": round(i / fps, 1),
                "ball": best["ball"],
                "robots_yellow": best["robots_yellow"],
                "robots_blue": best["robots_blue"],
            })

    return result


def extract_goal_scenes(log_gz_bytes: bytes) -> list[dict]:
    """SSL game log (.log.gz) からゴールシーンを抽出する。

    Returns:
        各ゴールのシーンデータ（dict）のリスト。
        各 dict のキー: goal_index, scored_by, score_after, duration_sec, fps, frames
    """
    # gzip展開（不完全なgzipストリームにも対応するため zlib を直接使用）
    try:
        data = gzip.decompress(log_gz_bytes)
    except EOFError:
        dec = zlib.decompressobj(47)  # 47 = zlib+gzip自動検出
        data = dec.decompress(log_gz_bytes)
        data += dec.flush()

    # 全メッセージを走査してRefereeとフレームデータを収集
    referee_snapshots: list[tuple[int, object]] = []  # (timestamp_ns, Referee)
    position_frames: list[dict] = []  # {t_ns, ball, robots_yellow, robots_blue}
    has_tracker = False

    for timestamp_ns, msg_type, raw in _iter_messages(data):
        if msg_type == MSG_TYPE_REFEREE:
            try:
                ref = ssl_gc_referee_message_pb2.Referee()
                ref.ParseFromString(raw)
                referee_snapshots.append((timestamp_ns, ref))
            except Exception:
                pass

        elif msg_type in (MSG_TYPE_VISION_2010, MSG_TYPE_VISION_2014) and not has_tracker:
            try:
                wrapper = ssl_vision_wrapper_pb2.SSL_WrapperPacket()
                wrapper.ParseFromString(raw)
                frame = _detection_to_frame(timestamp_ns, wrapper)
                if frame:
                    position_frames.append(frame)
            except Exception:
                pass

        elif msg_type == MSG_TYPE_TRACKER:
            try:
                wrapper = TrackerWrapperPacket()
                wrapper.ParseFromString(raw)
                frame = _tracker_to_frame(timestamp_ns, wrapper)
                if frame:
                    if not has_tracker:
                        # Trackerデータが存在 → Visionデータを破棄してTrackerを使用
                        has_tracker = True
                        position_frames = []
                    position_frames.append(frame)
            except Exception:
                pass

    # スコア変化点（ゴール）を検出
    scenes = []
    prev_yellow_score = 0
    prev_blue_score = 0
    goal_index = 0

    for goal_time_ns, ref in referee_snapshots:
        yellow_score = ref.yellow.score
        blue_score = ref.blue.score

        scored_by = None
        if yellow_score > prev_yellow_score:
            scored_by = "ibis"
        elif blue_score > prev_blue_score:
            scored_by = "tigers"

        if scored_by:
            # ゴール前 SCENE_DURATION_SEC 秒のフレームを抽出
            start_ns = goal_time_ns - int(SCENE_DURATION_SEC * 1e9)
            scene_frames_raw = [f for f in position_frames if start_ns <= f["t_ns"] <= goal_time_ns]

            if scene_frames_raw:
                frames = _downsample_frames(scene_frames_raw, goal_time_ns, SCENE_DURATION_SEC, OUTPUT_FPS)
                scenes.append({
                    "goal_index": goal_index,
                    "scored_by": scored_by,
                    "score_after": {"ibis": yellow_score, "tigers": blue_score},
                    "duration_sec": SCENE_DURATION_SEC,
                    "fps": OUTPUT_FPS,
                    "frames": frames,
                })
                goal_index += 1

        prev_yellow_score = yellow_score
        prev_blue_score = blue_score

    return scenes
