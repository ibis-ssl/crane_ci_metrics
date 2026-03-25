/**
 * 試合詳細分析ページ
 *
 * URLパラメータ: ?id=<match_id>
 * データ: analysis-data/<id>.json を fetch して描画する
 *
 * 依存: ssl-field.js, heatmap-renderer.js (先に読み込み済み)
 * goals.js の GoalScenePlayer / buildSceneCard は defer で後から読み込まれるため、
 * ゴールシーン描画は DOMContentLoaded + goals.js 読み込み後に実行する。
 */

// ============================================================
// ユーティリティ
// ============================================================
function formatSec(sec) {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, '0');
  return `${m}:${ss}`;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ============================================================
// FullReplayPlayer — JSON フレームを再生する
// ============================================================
class FullReplayPlayer {
  constructor({ frames, fps, robotElements, ballEl, scoreTimeline, refereeCommands }) {
    this.frames = frames;
    this.fps = fps;
    this.interval = 1000 / fps;
    this.robotElements = robotElements;
    this.ballEl = ballEl;
    this.scoreTimeline = scoreTimeline;     // [{t_sec, yellow, blue}, ...]
    this.refereeCommands = refereeCommands; // [{t_sec, stage, command}, ...]
    this.currentIdx = 0;
    this.playing = false;
    this.speed = 1.0;
    this.elapsed = 0;
    this.lastTime = null;
    this._rafId = null;
    this._boundLoop = this._loop.bind(this);

    // コールバック
    this.onFrame = null;  // (frame, idx) => void
  }

  get totalFrames() { return this.frames.length; }

  get currentFrame() { return this.frames[this.currentIdx] || null; }

  get totalSec() {
    const last = this.frames[this.totalFrames - 1];
    return last ? last.t_sec : 0;
  }

  seek(idx) {
    this.currentIdx = clamp(idx, 0, this.totalFrames - 1);
    this._render();
  }

  play() {
    if (this.playing || this.totalFrames === 0) return;
    if (this.currentIdx >= this.totalFrames - 1) this.currentIdx = 0;
    this.playing = true;
    this.elapsed = 0;
    this.lastTime = null;
    this._rafId = requestAnimationFrame(this._boundLoop);
  }

  pause() {
    this.playing = false;
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
  }

  setSpeed(s) { this.speed = s; }

  _loop(now) {
    if (!this.playing) return;
    if (this.lastTime !== null) {
      this.elapsed += (now - this.lastTime) * this.speed;
      while (this.elapsed >= this.interval) {
        this.elapsed -= this.interval;
        this.currentIdx++;
        if (this.currentIdx >= this.totalFrames) {
          this.currentIdx = this.totalFrames - 1;
          this.playing = false;
          this._render();
          if (this.onStop) this.onStop();
          return;
        }
      }
    }
    this.lastTime = now;
    this._render();
    this._rafId = requestAnimationFrame(this._boundLoop);
  }

  _render() {
    const frame = this.frames[this.currentIdx];
    if (!frame) return;
    updateFrame(frame, this.robotElements, this.ballEl);
    if (this.onFrame) this.onFrame(frame, this.currentIdx);
  }

  /** t_sec 以下の最後の要素を二分探索で返す。見つからなければ fallback を返す。*/
  static _bisect(arr, t_sec, fallback) {
    if (arr.length === 0 || arr[0].t_sec > t_sec) return fallback;
    let lo = 0, hi = arr.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (arr[mid].t_sec <= t_sec) lo = mid; else hi = mid - 1;
    }
    return arr[lo];
  }

  /** t_sec に対応するスコアを返す */
  scoreAt(t_sec) {
    return FullReplayPlayer._bisect(this.scoreTimeline, t_sec, { yellow: 0, blue: 0 });
  }

  /** t_sec に対応するレフェリーコマンドを返す */
  commandAt(t_sec) {
    return FullReplayPlayer._bisect(this.refereeCommands, t_sec, { stage: '–', command: '–' });
  }
}

// ============================================================
// イベントカテゴリ判定
// ============================================================
const EVENT_GOAL_TYPES  = new Set([8, 39, 44, 45]);
const EVENT_FOUL_TYPES  = new Set([13,14,15,17,18,19,20,21,22,24,26,27,28,29,31,43,51,52]);
const EVENT_BALL_TYPES  = new Set([6,7,11]);

function eventCategory(typeVal) {
  if (EVENT_GOAL_TYPES.has(typeVal)) return 'goal';
  if (EVENT_FOUL_TYPES.has(typeVal)) return 'foul';
  if (EVENT_BALL_TYPES.has(typeVal)) return 'ball';
  return 'info';
}

// ============================================================
// メイン処理
// ============================================================
(async () => {
  const params = new URLSearchParams(location.search);
  const matchId = params.get('id');

  if (!matchId) {
    document.getElementById('loading-msg').textContent = 'URLパラメータ ?id= が指定されていません。';
    return;
  }

  // データ読み込み
  let data;
  try {
    const res = await fetch(`./analysis-data/${encodeURIComponent(matchId)}.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (e) {
    document.getElementById('loading-msg').textContent = `データの読み込みに失敗しました: ${e.message}`;
    return;
  }

  // ローディング非表示、コンテンツ表示
  document.getElementById('loading-overlay').style.display = 'none';
  document.getElementById('main-content').style.display = 'block';

  const { meta, replay_frames, ball_heatmap, robot_heatmaps, goal_scenes,
          events, possession, score_timeline, referee_commands } = data;

  // ============================================================
  // ① スコアボード & ヘッダー
  // ============================================================
  const yName = meta.teams.yellow || 'Yellow';
  const bName = meta.teams.blue   || 'Blue';
  document.title = `${yName} vs ${bName} – 試合分析`;
  document.getElementById('an-title')    && (document.getElementById('an-title').textContent    = `${yName} vs ${bName}`);
  document.getElementById('match-title').textContent   = `${yName} vs ${bName}`;
  document.getElementById('match-subtitle').textContent = `${meta.filename}  |  ${formatSec(meta.duration_sec)}`;

  document.getElementById('sb-yellow-name').textContent  = yName;
  document.getElementById('sb-blue-name').textContent    = bName;
  document.getElementById('sb-yellow-score').textContent = String(meta.final_score.yellow);
  document.getElementById('sb-blue-score').textContent   = String(meta.final_score.blue);
  document.getElementById('sb-duration').textContent     = formatSec(meta.duration_sec);

  // ヒートマップタイトル & フィルタボタンにチーム名を反映
  const heatYellowTitle = document.getElementById('heatmap-yellow-title');
  const heatBlueTitle   = document.getElementById('heatmap-blue-title');
  if (heatYellowTitle) heatYellowTitle.textContent = `${yName} チーム`;
  if (heatBlueTitle)   heatBlueTitle.textContent   = `${bName} チーム`;

  const filterBtnYellow = document.getElementById('filter-btn-yellow');
  const filterBtnBlue   = document.getElementById('filter-btn-blue');
  if (filterBtnYellow) filterBtnYellow.textContent = yName;
  if (filterBtnBlue)   filterBtnBlue.textContent   = bName;

  if (meta.gdrive_url) {
    const dlLink = document.getElementById('log-download-link');
    dlLink.href = meta.gdrive_url;
    dlLink.style.display = '';
  }

  // ============================================================
  // ② フルリプレイ
  // ============================================================
  const { svg, robotElements, ballEl, eventOverlay } = buildFieldSVG();
  document.getElementById('replay-field-container').appendChild(svg);
  new SvgZoomPan(svg);

  const player = new FullReplayPlayer({
    frames: replay_frames,
    fps: 3,
    robotElements,
    ballEl,
    scoreTimeline: score_timeline || [],
    refereeCommands: referee_commands || [],
  });

  // UI 要素
  const btnPlay      = document.getElementById('rp-play');
  const btnStepBack  = document.getElementById('rp-step-back');
  const btnStepFwd   = document.getElementById('rp-step-fwd');
  const rateSelect   = document.getElementById('rp-rate-select');
  const timelineTrack = document.getElementById('rp-timeline-track');
  const timelineProg  = document.getElementById('rp-timeline-progress');
  const timelineThumb = document.getElementById('rp-timeline-thumb');
  const timeCurrent   = document.getElementById('rp-time-current');
  const timeTotal     = document.getElementById('rp-time-total');
  const scoreYellow   = document.getElementById('replay-score-yellow');
  const scoreBlue     = document.getElementById('replay-score-blue');
  const stageEl       = document.getElementById('replay-stage');
  const commandEl     = document.getElementById('replay-command');

  timeTotal.textContent = formatSec(player.totalSec);

  function updateReplayUI(frame, idx) {
    const frac = player.totalFrames > 1 ? idx / (player.totalFrames - 1) : 0;
    const pct = (frac * 100).toFixed(2) + '%';
    timelineProg.style.width = pct;
    timelineThumb.style.left = pct;
    timeCurrent.textContent = formatSec(frame.t_sec);

    const score = player.scoreAt(frame.t_sec);
    scoreYellow.textContent = String(score.yellow);
    scoreBlue.textContent   = String(score.blue);

    const cmd = player.commandAt(frame.t_sec);
    stageEl.textContent   = cmd.stage;
    commandEl.textContent = cmd.command || '–';
  }

  function resetPlayIcon() {
    btnPlay.querySelector('#rp-play-icon').style.display  = '';
    btnPlay.querySelector('#rp-pause-icon').style.display = 'none';
  }

  player.onFrame = updateReplayUI;
  player.onStop  = resetPlayIcon;

  if (replay_frames.length > 0) player.seek(0);

  // 再生ボタン
  btnPlay.addEventListener('click', () => {
    if (player.playing) {
      player.pause();
      resetPlayIcon();
    } else {
      player.play();
      btnPlay.querySelector('#rp-play-icon').style.display  = 'none';
      btnPlay.querySelector('#rp-pause-icon').style.display = '';
    }
  });

  btnStepBack.addEventListener('click', () => { player.pause(); player.seek(player.currentIdx - 1); resetPlayIcon(); });
  btnStepFwd.addEventListener('click',  () => { player.pause(); player.seek(player.currentIdx + 1); resetPlayIcon(); });
  rateSelect.addEventListener('change', () => player.setSpeed(parseFloat(rateSelect.value)));

  // タイムラインシーク
  function seekFromPointer(e) {
    const rect = timelineTrack.getBoundingClientRect();
    const frac = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    const idx  = Math.round(frac * (player.totalFrames - 1));
    player.seek(idx);
  }
  let dragging = false;
  timelineTrack.addEventListener('pointerdown', (e) => { dragging = true; timelineTrack.setPointerCapture(e.pointerId); seekFromPointer(e); });
  timelineTrack.addEventListener('pointermove', (e) => { if (dragging) seekFromPointer(e); });
  timelineTrack.addEventListener('pointerup',   ()  => { dragging = false; });

  // キーボードショートカット
  document.addEventListener('keydown', (e) => {
    if (['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)) return;
    if (e.key === ' ') { e.preventDefault(); btnPlay.click(); }
    else if (e.key === 'ArrowLeft')  { player.pause(); player.seek(player.currentIdx - 1); }
    else if (e.key === 'ArrowRight') { player.pause(); player.seek(player.currentIdx + 1); }
    else if (e.key === 'Home') { player.pause(); player.seek(0); }
    else if (e.key === 'End')  { player.pause(); player.seek(player.totalFrames - 1); }
  });

  // ============================================================
  // ③ スコアタイムライン (ApexCharts)
  // ============================================================
  if (score_timeline && score_timeline.length > 0) {
    const categories = score_timeline.map(s => formatSec(s.t_sec));
    new ApexCharts(document.getElementById('score-chart'), {
      chart: { type: 'line', height: 220, background: 'transparent', toolbar: { show: false },
               animations: { enabled: false } },
      theme: { mode: 'dark' },
      series: [
        { name: yName, data: score_timeline.map(s => s.yellow), color: '#FDD663' },
        { name: bName, data: score_timeline.map(s => s.blue),   color: '#5B9BF5' },
      ],
      xaxis: { categories, labels: { show: score_timeline.length < 60 }, title: { text: '時刻' } },
      yaxis: { labels: { formatter: v => String(Math.round(v)) }, min: 0,
               title: { text: 'スコア' }, tickAmount: Math.max(meta.final_score.yellow, meta.final_score.blue) + 1 },
      stroke: { curve: 'stepline', width: 2 },
      markers: { size: 4 },
      grid: { borderColor: 'rgba(255,255,255,0.08)' },
      tooltip: { x: { formatter: v => v } },
    }).render();
  }

  // ============================================================
  // ④ ポゼッション (ApexCharts)
  // ============================================================
  if (possession && possession.timestamps && possession.timestamps.length > 0) {
    const yellowRatio = possession.yellow_ratio.map(r => Math.round(r * 100));
    const blueRatio   = yellowRatio.map(r => 100 - r);
    new ApexCharts(document.getElementById('possession-chart'), {
      chart: { type: 'area', height: 220, background: 'transparent', toolbar: { show: false },
               animations: { enabled: false }, stacked: true },
      theme: { mode: 'dark' },
      series: [
        { name: yName, data: yellowRatio, color: '#FDD663' },
        { name: bName, data: blueRatio,   color: '#5B9BF5' },
      ],
      xaxis: {
        categories: possession.timestamps.map(t => formatSec(t)),
        tickAmount: Math.min(12, possession.timestamps.length),
        labels: { rotate: -30 },
        title: { text: '時刻' },
      },
      yaxis: { max: 100, labels: { formatter: v => `${v}%` }, title: { text: 'ポゼッション率' } },
      fill: { opacity: 0.7 },
      stroke: { width: 1 },
      grid: { borderColor: 'rgba(255,255,255,0.08)' },
      tooltip: { y: { formatter: v => `${v}%` } },
      dataLabels: { enabled: false },
    }).render();
  }

  // ============================================================
  // ⑤ ヒートマップ
  // ============================================================
  function initCanvas(id) {
    const canvas = document.getElementById(id);
    if (!canvas) return null;
    // デバイスピクセル比に対応
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.offsetWidth  || 400;
    const h = canvas.offsetHeight || (w * 3 / 4);
    canvas.width  = w * dpr;
    canvas.height = h * dpr;
    canvas.getContext('2d').scale(dpr, dpr);
    return canvas;
  }

  // ResizeObserver でサイズ確定後に描画
  const drawHeatmaps = () => {
    const ballCanvas   = initCanvas('heatmap-ball');
    const yellowCanvas = initCanvas('heatmap-yellow');
    const blueCanvas   = initCanvas('heatmap-blue');

    if (ballCanvas && ball_heatmap)
      new HeatmapRenderer(ballCanvas).render(ball_heatmap, 'hot');
    if (yellowCanvas && robot_heatmaps?.yellow)
      new HeatmapRenderer(yellowCanvas).render(robot_heatmaps.yellow, 'yellow');
    if (blueCanvas && robot_heatmaps?.blue)
      new HeatmapRenderer(blueCanvas).render(robot_heatmaps.blue, 'blue');
  };

  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(drawHeatmaps);
    ['heatmap-ball','heatmap-yellow','heatmap-blue'].forEach(id => {
      const el = document.getElementById(id);
      if (el) ro.observe(el);
    });
  } else {
    setTimeout(drawHeatmaps, 100);
  }

  // ============================================================
  // ⑥ ゴールシーン集
  // ============================================================
  function renderGoalScenes() {
    const container = document.getElementById('goal-scenes-container');
    if (!container) return;
    if (!goal_scenes || goal_scenes.length === 0) {
      container.innerHTML = '<p style="color:var(--an-on-variant)">ゴールシーンデータがありません。</p>';
      return;
    }
    for (const scene of goal_scenes) {
      container.appendChild(buildSceneCard(
        { ...scene, date: meta.filename },
        { yellow: yName, blue: bName },
      ));
    }
  }

  // goals.js の GoalScenePlayer が読み込まれるまで待つ
  if (typeof GoalScenePlayer !== 'undefined') {
    renderGoalScenes();
  } else {
    window.addEventListener('load', renderGoalScenes);
  }

  // ============================================================
  // ⑦ イベントテーブル
  // ============================================================
  const eventsData = events || [];
  let currentEventFilter = 'all';

  function renderEvents(filter) {
    const tbody = document.getElementById('events-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const filtered = filter === 'all'    ? eventsData :
                     filter === 'yellow' ? eventsData.filter(e => e.by_team === 'yellow') :
                     filter === 'blue'   ? eventsData.filter(e => e.by_team === 'blue') :
                     eventsData.filter(e => eventCategory(e.type) === filter);

    for (const ev of filtered) {
      const cat = eventCategory(ev.type);
      const tr = document.createElement('tr');
      const locStr = ev.location ? `(${ev.location.x}, ${ev.location.y})` : '–';
      const teamChip = ev.by_team
        ? `<span class="an-team-chip ${ev.by_team}"></span>${ev.by_team === 'yellow' ? yName : bName}`
        : '–';
      tr.innerHTML = `
        <td style="font-family:'JetBrains Mono',monospace;font-size:0.8rem">${ev.t_sec.toFixed(1)}</td>
        <td><span class="an-event-badge ${cat}">${ev.label}</span></td>
        <td>${teamChip}</td>
        <td>${ev.by_bot != null ? `#${ev.by_bot}` : '–'}</td>
        <td style="font-size:0.78rem;color:var(--an-on-variant)">${locStr}</td>
      `;
      tbody.appendChild(tr);
    }

    if (filtered.length === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="5" style="text-align:center;color:var(--an-on-variant)">該当するイベントがありません</td>';
      tbody.appendChild(tr);
    }
  }

  renderEvents('all');

  document.getElementById('event-filter-bar')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.an-filter-btn');
    if (!btn) return;
    document.querySelectorAll('.an-filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentEventFilter = btn.dataset.filter;
    renderEvents(currentEventFilter);
  });

  // ============================================================
  // ⑧ レフェリーコマンドテーブル
  // ============================================================
  const cmdTbody = document.getElementById('commands-tbody');
  if (cmdTbody && referee_commands) {
    for (const c of referee_commands) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-family:'JetBrains Mono',monospace;font-size:0.8rem">${c.t_sec.toFixed(1)}</td>
        <td>${c.stage}</td>
        <td>${c.command || '–'}</td>
      `;
      cmdTbody.appendChild(tr);
    }
    if (referee_commands.length === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="3" style="text-align:center;color:var(--an-on-variant)">データなし</td>';
      cmdTbody.appendChild(tr);
    }
  }

})();
