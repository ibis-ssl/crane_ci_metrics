/**
 * SSL game log parser (browser)
 *
 * ssl_log_parser.py のブラウザ版移植。
 * .log.gz ファイルを ArrayBuffer として受け取り、全フレームと
 * レフェリースナップショット、ゴールマーカー、ゲームイベント、チーム名を返す。
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
    this._SSL_WrapperPacket      = pbRoot.lookupType('SSL_WrapperPacket');
    this._TrackerWrapperPacket   = pbRoot.lookupType('TrackerWrapperPacket');
    this._Referee                = pbRoot.lookupType('Referee');
  }

  /**
   * .log.gz ファイルをパースする
   * @param {ArrayBuffer} gzipBuffer
   * @param {function} onProgress - (ratio: 0..1) コールバック（任意）
   * @returns {{ frames, refereeSnapshots, goalMarkers, gameEvents, teamNames, durationNs }}
   */
  async parse(gzipBuffer, onProgress) {
    const data = await this._decompress(gzipBuffer);
    if (onProgress) onProgress(0.05);

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
              frames.length = 0;
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

    const goalMarkers = this._detectGoals(refereeSnapshots);
    const gameEvents  = this._extractGameEvents(refereeSnapshots);
    const teamNames   = this._extractTeamNames(refereeSnapshots);

    const durationNs = frames.length > 1
      ? frames[frames.length - 1].timestampNs - frames[0].timestampNs
      : BigInt(0);

    if (onProgress) onProgress(1.0);
    return { frames, refereeSnapshots, goalMarkers, gameEvents, teamNames, durationNs };
  }

  // --- 内部メソッド ---

  async _decompress(buffer) {
    if (typeof DecompressionStream !== 'undefined') {
      try {
        const ds = new DecompressionStream('gzip');
        const stream = new Blob([buffer]).stream().pipeThrough(ds);
        return new Uint8Array(await new Response(stream).arrayBuffer());
      } catch (e) {}
    }
    if (typeof pako === 'undefined') throw new Error('gzip展開失敗: pakoが見つかりません');
    return pako.inflate(new Uint8Array(buffer));
  }

  * _iterMessages(data) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let offset = 0;

    const headerBytes = data.slice(0, 12);
    const headerStr = new TextDecoder().decode(headerBytes);
    if (headerStr !== SSL_LOG_HEADER) {
      throw new Error(`無効なSSLログヘッダー: "${headerStr}"`);
    }
    offset = 16;

    while (offset + 16 <= data.byteLength) {
      const timestampNs = view.getBigInt64(offset, false);
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
        markers.push({ timestampNs, scoredBy: 'yellow', score: { yellow, blue } });
      } else if (blue > prevBlue) {
        markers.push({ timestampNs, scoredBy: 'blue', score: { yellow, blue } });
      }

      prevYellow = yellow;
      prevBlue   = blue;
    }

    return markers;
  }

  /**
   * refereeスナップショットからゲームイベントを抽出・重複排除する
   * @returns {Array} 正規化済みゲームイベント配列
   */
  _extractGameEvents(refereeSnapshots) {
    const seenIds = new Set();
    const events = [];

    // GameEvent の oneof フィールド名一覧 (位置情報を持つもの)
    const oneofFields = [
      'ballLeftFieldTouchLine', 'ballLeftFieldGoalLine', 'aimlessKick',
      'attackerTooCloseToDefenseArea', 'defenderInDefenseArea', 'boundaryCrossing',
      'keeperHeldBall', 'botDribbledBallTooFar', 'botPushedBot', 'botHeldBallDeliberately',
      'botTippedOver', 'botDroppedParts', 'attackerTouchedBallInDefenseArea',
      'botKickedBallTooFast', 'botCrashUnique', 'botCrashDrawn',
      'defenderTooCloseToKickPoint', 'botTooFastInStop', 'botInterferedPlacement',
      'possibleGoal', 'goal', 'invalidGoal', 'attackerDoubleTouchedBall',
      'placementSucceeded', 'penaltyKickFailed', 'noProgressInGame', 'placementFailed',
      'multipleCards', 'multipleFouls', 'botSubstitution', 'excessiveBotSubstitution',
      'tooManyRobots', 'challengeFlag', 'challengeFlagHandled', 'emergencyStop',
      'unsportingBehaviorMinor', 'unsportingBehaviorMajor',
      'indirectGoal', 'chippedGoal', 'kickTimeout',
      'attackerTouchedOpponentInDefenseArea', 'attackerTouchedOpponentInDefenseAreaSkipped',
      'botCrashUniqueSkipped', 'botPushedBotSkipped', 'defenderInDefenseAreaPartially',
      'multiplePlacementFailures',
    ];

    for (const { timestampNs, ref } of refereeSnapshots) {
      if (!ref.gameEvents || ref.gameEvents.length === 0) continue;

      for (const ge of ref.gameEvents) {
        const id = ge.id || null;
        if (id && seenIds.has(id)) continue;
        if (id) seenIds.add(id);

        // oneof フィールドからイベントデータを取得
        let eventData = null;
        let fieldName = null;
        for (const f of oneofFields) {
          if (ge[f] != null) {
            eventData = ge[f];
            fieldName = f;
            break;
          }
        }

        // チーム、ボット番号、位置を取得
        let byTeam = null;
        let byBot = null;
        let location = null;

        if (eventData) {
          if (eventData.byTeam != null) {
            // Team enum: UNKNOWN=0, YELLOW=1, BLUE=2
            byTeam = eventData.byTeam === 1 ? 'yellow' : eventData.byTeam === 2 ? 'blue' : null;
          }
          if (eventData.byBot != null) byBot = eventData.byBot;
          if (eventData.kickingBot != null && byBot == null) byBot = eventData.kickingBot;

          if (eventData.location) {
            location = { x: eventData.location.x || 0, y: eventData.location.y || 0 };
          } else if (eventData.ballLocation) {
            location = { x: eventData.ballLocation.x || 0, y: eventData.ballLocation.y || 0 };
          }
        }

        // createdTimestamp を BigInt に統一
        let eventTimestampNs = timestampNs;
        if (ge.createdTimestamp != null) {
          try {
            eventTimestampNs = BigInt(ge.createdTimestamp.toString());
          } catch (_) {}
        }

        events.push({
          id: id || `${String(timestampNs)}_${ge.type}_${events.length}`,
          timestampNs: eventTimestampNs,
          type: ge.type || 0,
          fieldName,
          byTeam,
          byBot,
          location,  // メートル単位
          eventData,
        });
      }
    }

    // タイムスタンプ順にソート
    events.sort((a, b) => (a.timestampNs < b.timestampNs ? -1 : a.timestampNs > b.timestampNs ? 1 : 0));
    return events;
  }

  /**
   * refereeスナップショットから最初のチーム名を取得する
   * @returns {{ yellow: string, blue: string }}
   */
  _extractTeamNames(refereeSnapshots) {
    for (const { ref } of refereeSnapshots) {
      const yellowName = ref.yellow && ref.yellow.name;
      const blueName   = ref.blue   && ref.blue.name;
      if (yellowName || blueName) {
        return {
          yellow: yellowName || 'Yellow',
          blue:   blueName   || 'Blue',
        };
      }
    }
    return { yellow: 'Yellow', blue: 'Blue' };
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
