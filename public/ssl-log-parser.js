/**
 * SSL game log parser (browser)
 *
 * ssl_log_parser.py のブラウザ版移植。
 * .log.gz ファイルを ArrayBuffer として受け取り、全フレームと
 * レフェリースナップショット、ゴールマーカーを返す。
 *
 * SSL log format:
 *   Header : "SSL_LOG_FILE" (12 bytes) + version (int32 big-endian)
 *   Messages: timestamp_ns (int64 BE) + msg_type (int32 BE) + size (int32 BE) + data
 *   Message types: 2=Vision2010, 3=Referee, 4=Vision2014, 5=Tracker
 */

const MSG_TYPE_VISION_2010 = 2;
const MSG_TYPE_REFEREE    = 3;
const MSG_TYPE_VISION_2014 = 4;
const MSG_TYPE_TRACKER    = 5;
const SSL_LOG_HEADER      = 'SSL_LOG_FILE';

class SSLLogParser {
  /**
   * @param {object} pbRoot - protobuf.Root インスタンス（protobufjs v7）
   */
  constructor(pbRoot) {
    this._root = pbRoot;
    // メッセージ型のキャッシュ
    this._SSL_WrapperPacket      = pbRoot.lookupType('SSL_WrapperPacket');
    this._TrackerWrapperPacket   = pbRoot.lookupType('TrackerWrapperPacket');
    this._Referee                = pbRoot.lookupType('Referee');
  }

  /**
   * .log.gz ファイルをパースする
   * @param {ArrayBuffer} gzipBuffer
   * @param {function} onProgress - (ratio: 0..1) コールバック（任意）
   * @returns {{ frames, refereeSnapshots, goalMarkers, durationNs }}
   */
  async parse(gzipBuffer, onProgress) {
    // 1. gzip 展開
    const data = await this._decompress(gzipBuffer);
    if (onProgress) onProgress(0.05);

    // 2. メッセージ反復
    const frames = [];
    const refereeSnapshots = [];
    let hasTracker = false;
    let msgCount = 0;

    const totalBytes = data.byteLength;
    for (const { timestampNs, msgType, raw, byteOffset } of this._iterMessages(data)) {
      msgCount++;

      if (msgType === MSG_TYPE_REFEREE) {
        try {
          const ref = this._Referee.decode(raw);
          refereeSnapshots.push({ timestampNs, ref });
        } catch (_) {}

      } else if ((msgType === MSG_TYPE_VISION_2010 || msgType === MSG_TYPE_VISION_2014) && !hasTracker) {
        try {
          const wrapper = this._SSL_WrapperPacket.decode(raw);
          const frame = this._visionToFrame(timestampNs, wrapper);
          if (frame) frames.push(frame);
        } catch (_) {}

      } else if (msgType === MSG_TYPE_TRACKER) {
        try {
          const wrapper = this._TrackerWrapperPacket.decode(raw);
          const frame = this._trackerToFrame(timestampNs, wrapper);
          if (frame) {
            if (!hasTracker) {
              hasTracker = true;
              frames.length = 0;  // vision データを破棄
            }
            frames.push(frame);
          }
        } catch (_) {}
      }

      if (onProgress && msgCount % 5000 === 0) {
        onProgress(0.05 + 0.9 * (byteOffset / totalBytes));
        await new Promise(r => setTimeout(r, 0));
      }
    }

    if (onProgress) onProgress(0.95);

    // 3. ゴールマーカー検出
    const goalMarkers = this._detectGoals(refereeSnapshots);

    const durationNs = frames.length > 1
      ? frames[frames.length - 1].timestampNs - frames[0].timestampNs
      : BigInt(0);

    if (onProgress) onProgress(1.0);
    return { frames, refereeSnapshots, goalMarkers, durationNs };
  }

  // --- 内部メソッド ---

  async _decompress(buffer) {
    if (typeof DecompressionStream !== 'undefined') {
      try {
        const ds = new DecompressionStream('gzip');
        const stream = new Blob([buffer]).stream().pipeThrough(ds);
        return new Uint8Array(await new Response(stream).arrayBuffer());
      } catch (e) {
        // フォールバックへ
      }
    }
    // pako フォールバック
    if (typeof pako === 'undefined') throw new Error('gzip展開失敗: pakoが見つかりません');
    return pako.inflate(new Uint8Array(buffer));
  }

  * _iterMessages(data) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let offset = 0;

    // ヘッダー検証
    const headerBytes = data.slice(0, 12);
    const headerStr = new TextDecoder().decode(headerBytes);
    if (headerStr !== SSL_LOG_HEADER) {
      throw new Error(`無効なSSLログヘッダー: "${headerStr}"`);
    }
    offset = 16;  // 12 bytes header + 4 bytes version

    while (offset + 16 <= data.byteLength) {
      const timestampNs = view.getBigInt64(offset, false);  // big-endian
      const msgType     = view.getInt32(offset + 8, false);
      const msgSize     = view.getInt32(offset + 12, false);
      offset += 16;

      if (msgSize < 0 || offset + msgSize > data.byteLength) break;

      offset += msgSize;
      yield {
        timestampNs,
        msgType,
        raw: data.subarray(offset - msgSize, offset),
        byteOffset: offset,
      };
    }
  }

  _visionToFrame(timestampNs, wrapper) {
    if (!wrapper.detection) return null;
    const det = wrapper.detection;
    return {
      timestampNs,
      ball: det.balls && det.balls.length > 0
        ? { x: Math.round(det.balls[0].x), y: Math.round(det.balls[0].y) }
        : null,
      robots_yellow: (det.robotsYellow || []).map(r => ({
        id: r.robotId, x: Math.round(r.x), y: Math.round(r.y), theta: r.orientation || 0,
      })),
      robots_blue: (det.robotsBlue || []).map(r => ({
        id: r.robotId, x: Math.round(r.x), y: Math.round(r.y), theta: r.orientation || 0,
      })),
    };
  }

  _trackerToFrame(timestampNs, wrapper) {
    if (!wrapper.trackedFrame) return null;
    const tf = wrapper.trackedFrame;

    const ball = tf.balls && tf.balls.length > 0 && tf.balls[0].pos
      ? { x: Math.round(tf.balls[0].pos.x * 1000), y: Math.round(tf.balls[0].pos.y * 1000) }
      : null;

    const robots_yellow = [];
    const robots_blue = [];
    for (const r of (tf.robots || [])) {
      if (!r.robotId || !r.pos) continue;
      const entry = {
        id: r.robotId.id,
        x: Math.round(r.pos.x * 1000),
        y: Math.round(r.pos.y * 1000),
        theta: r.orientation || 0,
      };
      // TEAM_COLOR_YELLOW = 0, TEAM_COLOR_BLUE = 1
      if (r.robotId.teamColor === 0) robots_yellow.push(entry);
      else robots_blue.push(entry);
    }

    return { timestampNs, ball, robots_yellow, robots_blue };
  }

  _detectGoals(refereeSnapshots) {
    const markers = [];
    let prevYellow = 0;
    let prevBlue = 0;

    for (const { timestampNs, ref } of refereeSnapshots) {
      const yellow = (ref.yellow && ref.yellow.score != null) ? ref.yellow.score : 0;
      const blue   = (ref.blue   && ref.blue.score   != null) ? ref.blue.score   : 0;

      if (yellow > prevYellow) {
        markers.push({ timestampNs, scoredBy: 'ibis', score: { ibis: yellow, tigers: blue } });
      } else if (blue > prevBlue) {
        markers.push({ timestampNs, scoredBy: 'tigers', score: { ibis: yellow, tigers: blue } });
      }

      prevYellow = yellow;
      prevBlue   = blue;
    }

    return markers;
  }
}

// protobuf.json を読み込んで SSLLogParser インスタンスを生成するファクトリ
async function createSSLLogParser(protoJsonUrl) {
  const res = await fetch(protoJsonUrl);
  if (!res.ok) throw new Error(`proto JSON 読み込み失敗: ${res.status}`);
  const jsonDescriptor = await res.json();
  const root = protobuf.Root.fromJSON(jsonDescriptor);
  return new SSLLogParser(root);
}
