/**
 * SSL ゲームログプレイヤー
 * ssl-field.js, ssl-log-parser.js が先に読み込まれていること
 */

// Referee ステージ名マッピング
const STAGE_NAMES = {
  0:  'プレゲーム',
  1:  '前半',
  2:  'ハーフタイム',
  3:  '後半',
  4:  'オーバータイム前半',
  5:  'オーバータイム前半ハーフタイム',
  6:  'オーバータイム後半',
  7:  'オーバータイム後半ハーフタイム',
  8:  'PK戦',
  9:  '試合終了（後半）',
  10: '試合終了（PK）',
};

// Referee コマンド名マッピング
const COMMAND_NAMES = {
  0:  'HALT',
  1:  '停止 (STOP)',
  2:  '通常プレー開始',
  3:  'フォースプレー開始',
  4:  'キックオフ (Yellow)',
  5:  'キックオフ (Blue)',
  6:  'ペナルティキック (Yellow)',
  7:  'ペナルティキック (Blue)',
  8:  'ダイレクトフリーキック (Yellow)',
  9:  'ダイレクトフリーキック (Blue)',
  10: 'インダイレクトフリーキック (Yellow)',
  11: 'インダイレクトフリーキック (Blue)',
  12: 'タイムアウト (Yellow)',
  13: 'タイムアウト (Blue)',
  14: 'ゴール (Yellow)',
  15: 'ボールプレースメント (Yellow)',
  16: 'ボールプレースメント (Blue)',
};

function formatTimeNs(ns) {
  // BigInt or Number
  const totalMs = Number(ns) / 1e6;
  const totalSec = totalMs / 1000;
  const min = Math.floor(totalSec / 60);
  const sec = (totalSec % 60).toFixed(1).padStart(4, '0');
  return `${min}:${sec}`;
}

// フレーム配列を二分探索で timestampNs に最近傍フレームインデックスを返す
function findFrameIndex(frames, targetNs) {
  if (frames.length === 0) return 0;
  let lo = 0, hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].timestampNs < targetNs) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0) {
    const diffPrev = targetNs - frames[lo - 1].timestampNs;
    const diffCurr = frames[lo].timestampNs - targetNs;
    if (diffPrev < diffCurr) return lo - 1;
  }
  return lo;
}

// Referee スナップショットを timestampNs で二分探索
function findRefereeIndex(snapshots, targetNs) {
  if (snapshots.length === 0) return -1;
  let lo = 0, hi = snapshots.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (snapshots[mid].timestampNs <= targetNs) lo = mid;
    else hi = mid - 1;
  }
  return snapshots[lo].timestampNs <= targetNs ? lo : -1;
}

class LogPlayer {
  constructor() {
    this.frames = [];
    this.refereeSnapshots = [];
    this.goalMarkers = [];
    this.durationNs = BigInt(0);
    this.startNs = BigInt(0);

    this.currentFrameIdx = 0;
    this.playing = false;
    this.speed = 1.0;
    this._rafId = null;
    this._lastTime = null;
    this._elapsedNs = 0;  // 現在フレームから次フレームまでのナノ秒蓄積

    this.robotElements = null;
    this.ballEl = null;
    this._zoomPan = null;
    this._boundLoop = this._loop.bind(this);

    this._buildUI();
    this._setupDropZone();
    this._setupKeyboard();
  }

  // --- UI 構築 ---

  _buildUI() {
    // 要素参照
    this._dropZone    = document.getElementById('drop-zone');
    this._playerBody  = document.getElementById('player-body');
    this._fieldCont   = document.getElementById('field-container');
    this._parseProgress = document.getElementById('parse-progress');
    this._parseBar    = document.getElementById('parse-progress-bar');

    this._btnPlay     = document.getElementById('btn-play');
    this._btnStepBack = document.getElementById('btn-step-back');
    this._btnStepFwd  = document.getElementById('btn-step-fwd');
    this._btnChange   = document.getElementById('btn-change-file');
    this._speedBtns   = document.getElementById('speed-btns');
    this._timeline    = document.getElementById('timeline-track');
    this._tlProgress  = document.getElementById('timeline-progress');
    this._tlThumb     = document.getElementById('timeline-thumb');
    this._timeCurrent = document.getElementById('time-current');
    this._timeTotal   = document.getElementById('time-total');

    this._scoreIbis   = document.getElementById('score-ibis');
    this._scoreTigers = document.getElementById('score-tigers');
    this._refStage    = document.getElementById('ref-stage');
    this._refCommand  = document.getElementById('ref-command');
    this._goalLog     = document.getElementById('goal-log-list');

    // ボタンイベント
    this._btnPlay.addEventListener('click', () => this.togglePlay());
    this._btnStepBack.addEventListener('click', () => this.stepFrames(-1));
    this._btnStepFwd.addEventListener('click', () => this.stepFrames(1));
    this._btnChange.addEventListener('click', () => this._showDropZone());

    // 速度ボタン
    this._speedBtns.addEventListener('click', e => {
      const btn = e.target.closest('.speed-btn');
      if (!btn) return;
      this.setSpeed(parseFloat(btn.dataset.speed));
      this._speedBtns.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });

    // タイムラインドラッグ
    let dragging = false;
    this._timeline.addEventListener('pointerdown', e => {
      dragging = true;
      this._timeline.setPointerCapture(e.pointerId);
      this._seekFromPointer(e);
    });
    this._timeline.addEventListener('pointermove', e => {
      if (!dragging) return;
      this._seekFromPointer(e);
    });
    this._timeline.addEventListener('pointerup', e => {
      dragging = false;
      this._timeline.releasePointerCapture(e.pointerId);
    });
    this._timeline.addEventListener('pointercancel', e => {
      dragging = false;
    });
  }

  _seekFromPointer(e) {
    const rect = this._timeline.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const targetNs = this.startNs + BigInt(Math.round(Number(this.durationNs) * ratio));
    this._seekToNs(targetNs);
  }

  _setupDropZone() {
    const zone = this._dropZone;
    const input = document.getElementById('file-input');

    zone.addEventListener('dragover', e => {
      e.preventDefault();
      zone.classList.add('drag-over');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file) this.loadFile(file);
    });

    input.addEventListener('change', () => {
      if (input.files[0]) this.loadFile(input.files[0]);
    });
  }

  _setupKeyboard() {
    document.addEventListener('keydown', e => {
      // フォームフォーカス中は無視
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
      if (this.frames.length === 0) return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          this.togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          e.shiftKey ? this.stepSeconds(-1) : this.stepFrames(-1);
          break;
        case 'ArrowRight':
          e.preventDefault();
          e.shiftKey ? this.stepSeconds(1) : this.stepFrames(1);
          break;
        case '[':
          this._changeSpeedStep(-1);
          break;
        case ']':
          this._changeSpeedStep(1);
          break;
        case 'Home':
          e.preventDefault();
          this._seekToFrameIdx(0);
          break;
        case 'End':
          e.preventDefault();
          this._seekToFrameIdx(this.frames.length - 1);
          break;
      }
    });
  }

  _changeSpeedStep(dir) {
    const speeds = [0.25, 0.5, 1, 2, 4];
    const idx = speeds.indexOf(this.speed);
    const newIdx = Math.max(0, Math.min(speeds.length - 1, idx + dir));
    const newSpeed = speeds[newIdx];
    this.setSpeed(newSpeed);
    this._speedBtns.querySelectorAll('.speed-btn').forEach(b => {
      b.classList.toggle('active', parseFloat(b.dataset.speed) === newSpeed);
    });
  }

  // --- ファイル読み込み ---

  async loadFile(file) {
    this.pause();
    this._showProgress(true);

    try {
      const buffer = await file.arrayBuffer();

      const parser = await createSSLLogParser('./proto/ssl_combined.json');
      const result = await parser.parse(buffer, ratio => {
        this._parseBar.style.width = `${Math.round(ratio * 100)}%`;
      });

      this.frames = result.frames;
      this.refereeSnapshots = result.refereeSnapshots;
      this.goalMarkers = result.goalMarkers;
      this.durationNs = result.durationNs;
      this.startNs = this.frames.length > 0 ? this.frames[0].timestampNs : BigInt(0);

      this._showProgress(false);
      this._showPlayer(file.name);
    } catch (err) {
      this._showProgress(false);
      alert(`ログの読み込みに失敗しました:\n${err.message}`);
      console.error(err);
    }
  }

  _showProgress(visible) {
    this._parseProgress.style.display = visible ? 'block' : 'none';
    this._parseBar.style.width = '0%';
  }

  _showPlayer(fileName) {
    this._dropZone.style.display = 'none';
    this._playerBody.style.display = 'block';

    // フィールドSVG を構築（初回のみ）
    if (!this.robotElements) {
      const { svg, robotElements, ballEl } = buildFieldSVG();
      this._fieldCont.innerHTML = '';
      this._fieldCont.appendChild(svg);
      this.robotElements = robotElements;
      this.ballEl = ballEl;
      this._zoomPan = new SvgZoomPan(svg);
    }

    // ゴールマーカーをタイムラインに描画
    this._buildGoalMarkers();

    // ゴールログ更新
    this._buildGoalLog();

    // 合計時間表示
    this._timeTotal.textContent = formatTimeNs(this.durationNs);

    // 先頭フレームへ
    this._seekToFrameIdx(0);
  }

  _showDropZone() {
    this.pause();
    this._dropZone.style.display = '';
    this._playerBody.style.display = 'none';
  }

  _buildGoalMarkers() {
    // 既存マーカーを削除
    this._timeline.querySelectorAll('.player-timeline-marker').forEach(el => el.remove());

    const durNum = Number(this.durationNs);
    if (durNum <= 0) return;

    for (const gm of this.goalMarkers) {
      const relNs = Number(gm.timestampNs - this.startNs);
      const pct = Math.min(100, Math.max(0, (relNs / durNum) * 100));
      const marker = document.createElement('div');
      marker.className = `player-timeline-marker ${gm.scoredBy}`;
      marker.style.left = `${pct}%`;
      marker.title = `${gm.scoredBy === 'ibis' ? 'ibis' : 'TIGERs'} ゴール (${gm.score.ibis}-${gm.score.tigers})`;
      this._timeline.appendChild(marker);
    }
  }

  _buildGoalLog() {
    this._goalLog.innerHTML = '';
    if (this.goalMarkers.length === 0) {
      this._goalLog.innerHTML = '<span class="no-data-text">ゴールなし</span>';
      return;
    }

    for (const gm of this.goalMarkers) {
      const relNs = gm.timestampNs - this.startNs;
      const item = document.createElement('div');
      item.className = 'goal-log-item';
      item.innerHTML = `
        <span class="goal-log-badge ${gm.scoredBy}"></span>
        <span class="goal-log-time">${formatTimeNs(relNs)}</span>
        <span class="goal-log-label">${gm.scoredBy === 'ibis' ? 'ibis' : 'TIGERs'} ゴール (${gm.score.ibis}-${gm.score.tigers})</span>
      `;
      item.addEventListener('click', () => this._seekToNs(gm.timestampNs));
      this._goalLog.appendChild(item);
    }
  }

  // --- 再生制御 ---

  togglePlay() {
    if (this.playing) this.pause();
    else this.play();
  }

  play() {
    if (this.playing || this.frames.length === 0) return;
    if (this.currentFrameIdx >= this.frames.length - 1) this.currentFrameIdx = 0;
    this.playing = true;
    this._lastTime = null;
    this._elapsedNs = 0;
    this._btnPlay.textContent = '⏸';
    this._rafId = requestAnimationFrame(this._boundLoop);
  }

  pause() {
    this.playing = false;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = null;
    this._btnPlay.textContent = '▶';
  }

  setSpeed(s) {
    this.speed = s;
  }

  stepFrames(delta) {
    this.pause();
    this._seekToFrameIdx(this.currentFrameIdx + delta);
  }

  stepSeconds(deltaSec) {
    this.pause();
    if (this.frames.length === 0) return;
    const currentNs = this.frames[this.currentFrameIdx].timestampNs;
    const targetNs = currentNs + BigInt(Math.round(deltaSec * 1e9));
    this._seekToNs(targetNs);
  }

  _seekToFrameIdx(idx) {
    const clamped = Math.max(0, Math.min(idx, this.frames.length - 1));
    this.currentFrameIdx = clamped;
    this._elapsedNs = 0;
    this._render();
  }

  _seekToNs(targetNs) {
    if (this.frames.length === 0) return;
    const clamped = targetNs < this.startNs ? this.startNs
      : targetNs > this.startNs + this.durationNs ? this.startNs + this.durationNs
      : targetNs;
    this.currentFrameIdx = findFrameIndex(this.frames, clamped);
    this._elapsedNs = 0;
    this._render();
  }

  // --- requestAnimationFrame ループ ---

  _loop(now) {
    if (!this.playing) return;

    if (this._lastTime !== null) {
      const wallDeltaNs = (now - this._lastTime) * 1e6 * this.speed;
      this._elapsedNs += wallDeltaNs;

      // 蓄積時間でフレームを進める
      while (this.currentFrameIdx < this.frames.length - 1) {
        const nextDeltaNs = Number(
          this.frames[this.currentFrameIdx + 1].timestampNs -
          this.frames[this.currentFrameIdx].timestampNs
        );
        if (this._elapsedNs < nextDeltaNs) break;
        this._elapsedNs -= nextDeltaNs;
        this.currentFrameIdx++;
      }

      if (this.currentFrameIdx >= this.frames.length - 1) {
        this.currentFrameIdx = this.frames.length - 1;
        this._render();
        this.pause();
        return;
      }
    }

    this._lastTime = now;
    this._render();
    this._rafId = requestAnimationFrame(this._boundLoop);
  }

  // --- 描画 ---

  _render() {
    if (this.frames.length === 0 || !this.robotElements) return;

    const frame = this.frames[this.currentFrameIdx];
    updateFrame(frame, this.robotElements, this.ballEl);

    // タイムライン更新
    const relNs = frame.timestampNs - this.startNs;
    const durNum = Number(this.durationNs);
    const pct = durNum > 0 ? Math.min(100, Number(relNs) / durNum * 100) : 0;
    this._tlProgress.style.width = `${pct}%`;
    this._tlThumb.style.left = `${pct}%`;
    this._timeCurrent.textContent = formatTimeNs(relNs);

    // レフェリー状態更新
    const refIdx = findRefereeIndex(this.refereeSnapshots, frame.timestampNs);
    if (refIdx >= 0) {
      const { ref } = this.refereeSnapshots[refIdx];
      this._scoreIbis.textContent   = (ref.yellow && ref.yellow.score != null) ? ref.yellow.score : '0';
      this._scoreTigers.textContent = (ref.blue   && ref.blue.score   != null) ? ref.blue.score   : '0';
      this._refStage.textContent   = STAGE_NAMES[ref.stage]   ?? String(ref.stage);
      this._refCommand.textContent = COMMAND_NAMES[ref.command] ?? String(ref.command);
    }
  }
}

// --- ページ初期化 ---
const player = new LogPlayer();
