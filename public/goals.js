// ssl-field.js から FIELD, COLORS, SVG_NS, VIEW_MARGIN,
// createSVGElement, buildFieldSVG, updateFrame をインポート（script タグで先に読み込む）

class GoalScenePlayer {
  constructor(scene, robotElements, ballEl, seekbar, timeDisplay, onStop) {
    this.frames = scene.frames;
    this.robotElements = robotElements;
    this.ballEl = ballEl;
    this.seekbar = seekbar;
    this.timeDisplay = timeDisplay;
    this.onStop = onStop;
    this.currentFrame = 0;
    this.playing = false;
    this.speed = 1.0;
    this.lastTime = null;
    this.interval = 1000 / scene.fps;
    this.elapsed = 0;
    this._rafId = null;
    this._boundLoop = this._loop.bind(this);
  }

  get totalFrames() { return this.frames.length; }

  seek(frameIndex) {
    this.currentFrame = Math.max(0, Math.min(frameIndex, this.totalFrames - 1));
    this._render();
  }

  play() {
    if (this.playing) return;
    if (this.currentFrame >= this.totalFrames - 1) this.currentFrame = 0;
    this.playing = true;
    this.lastTime = null;
    this._rafId = requestAnimationFrame(this._boundLoop);
  }

  pause() {
    this.playing = false;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = null;
  }

  setSpeed(s) { this.speed = s; }

  _loop(now) {
    if (!this.playing) return;
    if (this.lastTime !== null) {
      this.elapsed += (now - this.lastTime) * this.speed;
      while (this.elapsed >= this.interval) {
        this.elapsed -= this.interval;
        this.currentFrame++;
        if (this.currentFrame >= this.totalFrames) {
          this.currentFrame = this.totalFrames - 1;
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
    const frame = this.frames[this.currentFrame];
    updateFrame(frame, this.robotElements, this.ballEl);
    const t = frame.t.toFixed(1);
    const total = this.frames[this.totalFrames - 1].t.toFixed(1);
    this.timeDisplay.textContent = `${t}s / ${total}s`;
    this.seekbar.value = this.currentFrame;
  }
}

/**
 * @param {object} scene
 * @param {{ yellow?: string, blue?: string }} [teamNames]  省略時は ibis/TIGERs
 */
function buildSceneCard(scene, teamNames) {
  const yLabel = teamNames?.yellow || 'ibis';
  const bLabel = teamNames?.blue   || 'TIGERs';

  const card = document.createElement('div');
  card.className = 'goal-scene-card';
  card.dataset.team = scene.scored_by;

  const isYellow   = scene.scored_by === 'yellow' || scene.scored_by === 'ibis';
  const teamLabel  = isYellow ? `${yLabel} ゴール` : `${bLabel} ゴール`;
  const badgeClass = isYellow ? 'ibis' : 'tigers';
  const yScore = scene.score_after.yellow ?? scene.score_after.ibis   ?? 0;
  const bScore = scene.score_after.blue   ?? scene.score_after.tigers ?? 0;

  // カードヘッダー
  const header = document.createElement('div');
  header.className = 'goal-card-header';
  const runLink = scene.run_id
    ? `<a class="goal-run-link" href="https://github.com/ibis-ssl/crane/actions/runs/${scene.run_id}" target="_blank">#${scene.run_id}</a>`
    : '';
  header.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px">
      <span class="goal-card-badge ${badgeClass}">${teamLabel}</span>
      <span class="goal-card-score">${yScore} - ${bScore}</span>
    </div>
    <div style="display:flex;align-items:center;gap:8px">
      <span class="goal-card-meta">${scene.date || ''}</span>
      ${runLink}
    </div>
  `;
  card.appendChild(header);

  // SVGフィールド
  const fieldContainer = document.createElement('div');
  fieldContainer.className = 'goal-field-container';
  const { svg, robotElements, ballEl } = buildFieldSVG();
  fieldContainer.appendChild(svg);
  card.appendChild(fieldContainer);

  // 凡例
  const legend = document.createElement('div');
  legend.className = 'goal-legend';
  legend.innerHTML = `
    <span class="goal-legend-item"><span class="goal-legend-dot" style="background:${COLORS.ibis}"></span>${yLabel}</span>
    <span class="goal-legend-item"><span class="goal-legend-dot" style="background:${COLORS.tigers}"></span>${bLabel}</span>
    <span class="goal-legend-item"><span class="goal-legend-dot" style="background:${COLORS.ball}"></span>ボール</span>
  `;
  card.appendChild(legend);

  // コントロール
  const controls = document.createElement('div');
  controls.className = 'goal-player-controls';

  const seekbar = document.createElement('input');
  seekbar.type = 'range';
  seekbar.min = 0;
  seekbar.max = scene.frames.length - 1;
  seekbar.value = 0;
  seekbar.className = 'goal-seekbar';

  const timeDisplay = document.createElement('span');
  timeDisplay.className = 'goal-time-display';
  timeDisplay.textContent = `0.0s / ${scene.frames[scene.frames.length - 1].t.toFixed(1)}s`;

  const playBtn = document.createElement('button');
  playBtn.className = 'goal-play-btn';
  playBtn.textContent = '▶';

  const player = new GoalScenePlayer(scene, robotElements, ballEl, seekbar, timeDisplay, () => {
    playBtn.textContent = '▶';
  });
  player.seek(0);

  playBtn.addEventListener('click', () => {
    if (player.playing) {
      player.pause();
      playBtn.textContent = '▶';
    } else {
      player.play();
      playBtn.textContent = '⏸';
    }
  });

  seekbar.addEventListener('input', () => {
    player.pause();
    playBtn.textContent = '▶';
    player.seek(Number(seekbar.value));
  });

  // 速度ボタン
  const speedBtns = document.createElement('div');
  speedBtns.style.cssText = 'display:flex;gap:4px';
  for (const s of [0.5, 1, 2]) {
    const btn = document.createElement('button');
    btn.className = 'goal-speed-btn' + (s === 1 ? ' active' : '');
    btn.textContent = s === 1 ? '1x' : `${s}x`;
    btn.addEventListener('click', () => {
      player.setSpeed(s);
      speedBtns.querySelectorAll('.goal-speed-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
    speedBtns.appendChild(btn);
  }

  const row = document.createElement('div');
  row.className = 'goal-player-row';
  row.appendChild(playBtn);
  row.appendChild(timeDisplay);
  row.appendChild(speedBtns);

  controls.appendChild(row);
  controls.appendChild(seekbar);
  card.appendChild(controls);

  return card;
}

// メイン処理
let allScenes = [];
let currentFilter = 'all';

function renderScenes(filter) {
  const container = document.getElementById('goal-scenes-container');
  const countEl = document.getElementById('goal-count');
  container.innerHTML = '';

  const filtered = filter === 'all' ? allScenes : allScenes.filter(s => s.scored_by === filter);
  countEl.textContent = `${filtered.length} シーン`;

  if (filtered.length === 0) {
    container.innerHTML = '<div class="no-data-message">該当するゴールシーンがありません。</div>';
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'goal-scenes-grid';

  for (const scene of filtered) {
    grid.appendChild(buildSceneCard(scene));
  }

  container.appendChild(grid);
}

// goals.html 専用ロジック: 他ページで goals.js を流用する場合はスキップ
if (document.getElementById('filter-buttons')) {
  document.getElementById('filter-buttons').addEventListener('click', (e) => {
    const btn = e.target.closest('.goal-filter-btn');
    if (!btn) return;
    document.querySelectorAll('.goal-filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    renderScenes(currentFilter);
  });

  fetch('goal_scenes.json')
    .then(res => res.json())
    .then(json => {
      document.getElementById('loading-message').style.display = 'none';

      if (!json.scenes || json.scenes.length === 0) {
        document.getElementById('goal-scenes-container').innerHTML =
          '<div class="chart-card no-data-message">ゴールシーンデータがありません。</div>';
        return;
      }

      // 新しい順（日付降順）
      allScenes = json.scenes.slice().sort((a, b) => b.date.localeCompare(a.date));
      renderScenes(currentFilter);
    })
    .catch(err => {
      console.error('データ読み込みに失敗:', err);
      document.getElementById('loading-message').innerHTML =
        '<p style="color:#cf222e">goal_scenes.json の読み込みに失敗しました。</p>';
    });
}
