// SSL フィールド定数 (mm単位)
const FIELD = {
  length: 12000,
  width: 9000,
  goal_width: 1800,
  goal_depth: 180,
  penalty_area_length: 1800,
  penalty_area_width: 3600,
  center_circle_radius: 500,
  ball_radius: 43,
  robot_radius: 90,
};

// チームカラー
const COLORS = {
  ibis: '#1e88e5',     // 黄チーム=ibis(青表示)
  tigers: '#e53935',   // 青チーム=TIGERs(赤表示)
  ball: '#ff8c00',
  field: '#2d7a2d',
  line: '#ffffff',
  goal: '#cccccc',
};

const SVG_NS = 'http://www.w3.org/2000/svg';
const VIEW_MARGIN = 700;  // フィールド外のマージン(mm)

function createSVGElement(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

// SVGフィールドを描画して要素IDマップを返す
function buildFieldSVG(sceneId) {
  const vx = -FIELD.length / 2 - VIEW_MARGIN;
  const vy = -FIELD.width / 2 - VIEW_MARGIN;
  const vw = FIELD.length + VIEW_MARGIN * 2;
  const vh = FIELD.width + VIEW_MARGIN * 2;

  const svg = createSVGElement('svg', {
    viewBox: `${vx} ${vy} ${vw} ${vh}`,
    preserveAspectRatio: 'xMidYMid meet',
    class: 'goal-field-svg',
  });

  // フィールド背景
  svg.appendChild(createSVGElement('rect', {
    x: vx, y: vy, width: vw, height: vh, fill: COLORS.field,
  }));

  // フィールド外枠
  svg.appendChild(createSVGElement('rect', {
    x: -FIELD.length / 2, y: -FIELD.width / 2,
    width: FIELD.length, height: FIELD.width,
    fill: 'none', stroke: COLORS.line, 'stroke-width': 30,
  }));

  // センターライン
  svg.appendChild(createSVGElement('line', {
    x1: 0, y1: -FIELD.width / 2, x2: 0, y2: FIELD.width / 2,
    stroke: COLORS.line, 'stroke-width': 30,
  }));

  // センターサークル
  svg.appendChild(createSVGElement('circle', {
    cx: 0, cy: 0, r: FIELD.center_circle_radius,
    fill: 'none', stroke: COLORS.line, 'stroke-width': 30,
  }));

  // センタードット
  svg.appendChild(createSVGElement('circle', {
    cx: 0, cy: 0, r: 60, fill: COLORS.line,
  }));

  // ペナルティエリア (両端)
  for (const side of [-1, 1]) {
    const px = side * (FIELD.length / 2 - FIELD.penalty_area_length);
    svg.appendChild(createSVGElement('rect', {
      x: side > 0 ? px : -FIELD.length / 2,
      y: -FIELD.penalty_area_width / 2,
      width: FIELD.penalty_area_length,
      height: FIELD.penalty_area_width,
      fill: 'none', stroke: COLORS.line, 'stroke-width': 30,
    }));

    // ゴール
    svg.appendChild(createSVGElement('rect', {
      x: side > 0 ? FIELD.length / 2 : -FIELD.length / 2 - FIELD.goal_depth,
      y: -FIELD.goal_width / 2,
      width: FIELD.goal_depth,
      height: FIELD.goal_width,
      fill: 'none', stroke: COLORS.goal, 'stroke-width': 40,
    }));
  }

  // ロボット要素（yellow + blue、各16体分を事前生成）
  const robotElements = { yellow: [], blue: [] };
  for (const [team, color] of [['yellow', COLORS.ibis], ['blue', COLORS.tigers]]) {
    for (let i = 0; i < 16; i++) {
      const g = createSVGElement('g', { visibility: 'hidden', 'data-team': team, 'data-idx': i });
      const circle = createSVGElement('circle', {
        r: FIELD.robot_radius, fill: color, opacity: 0.85,
        stroke: 'white', 'stroke-width': 20,
      });
      const dirLine = createSVGElement('line', {
        x1: 0, y1: 0, x2: FIELD.robot_radius, y2: 0,
        stroke: 'white', 'stroke-width': 25,
      });
      const label = createSVGElement('text', {
        'text-anchor': 'middle', 'dominant-baseline': 'central',
        fill: 'white', 'font-size': 120, 'font-weight': 'bold',
        'pointer-events': 'none',
      });
      label.textContent = String(i);
      g.appendChild(circle);
      g.appendChild(dirLine);
      g.appendChild(label);
      svg.appendChild(g);
      robotElements[team].push(g);
    }
  }

  // ボール要素
  const ballEl = createSVGElement('circle', {
    r: FIELD.ball_radius * 2.5, fill: COLORS.ball,
    stroke: '#cc6600', 'stroke-width': 15, visibility: 'hidden',
  });
  svg.appendChild(ballEl);

  return { svg, robotElements, ballEl };
}

function updateFrame(frame, robotElements, ballEl) {
  // ボール更新
  if (frame.ball) {
    ballEl.setAttribute('cx', frame.ball.x);
    ballEl.setAttribute('cy', -frame.ball.y);  // Y軸反転 (SVGは下が正)
    ballEl.setAttribute('visibility', 'visible');
  } else {
    ballEl.setAttribute('visibility', 'hidden');
  }

  // ロボット更新
  for (const [teamKey, svgTeam] of [['robots_yellow', 'yellow'], ['robots_blue', 'blue']]) {
    const robots = frame[teamKey] || [];
    const els = robotElements[svgTeam];

    // 全要素を非表示に
    els.forEach(g => g.setAttribute('visibility', 'hidden'));

    for (const robot of robots) {
      if (robot.id >= els.length) continue;
      const g = els[robot.id];
      const x = robot.x;
      const y = -robot.y;  // Y軸反転
      const theta = -(robot.theta || 0);  // 角度も反転
      g.setAttribute('transform', `translate(${x},${y}) rotate(${theta * 180 / Math.PI})`);
      g.setAttribute('visibility', 'visible');
      // ラベルのID更新
      g.querySelector('text').textContent = String(robot.id);
    }
  }
}

class GoalScenePlayer {
  constructor(scene, robotElements, ballEl, seekbar, timeDisplay) {
    this.frames = scene.frames;
    this.robotElements = robotElements;
    this.ballEl = ballEl;
    this.seekbar = seekbar;
    this.timeDisplay = timeDisplay;
    this.currentFrame = 0;
    this.playing = false;
    this.speed = 1.0;
    this.lastTime = null;
    this.interval = 1000 / scene.fps;
    this.elapsed = 0;
    this._rafId = null;
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
    this._rafId = requestAnimationFrame(this._loop.bind(this));
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
          return;
        }
      }
    }
    this.lastTime = now;
    this._render();
    this._rafId = requestAnimationFrame(this._loop.bind(this));
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

function buildSceneCard(scene) {
  const card = document.createElement('div');
  card.className = 'goal-scene-card';
  card.dataset.team = scene.scored_by;

  const isIbis = scene.scored_by === 'ibis';
  const teamLabel = isIbis ? 'ibis ゴール' : 'TIGERs ゴール';

  // カードヘッダー
  const header = document.createElement('div');
  header.className = 'goal-card-header';
  header.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px">
      <span class="goal-card-badge ${scene.scored_by}">${teamLabel}</span>
      <span class="goal-card-score">${scene.score_after.ibis} - ${scene.score_after.tigers}</span>
    </div>
    <div style="display:flex;align-items:center;gap:8px">
      <span class="goal-card-meta">${scene.date}</span>
      <a class="goal-run-link" href="https://github.com/ibis-ssl/crane/actions/runs/${scene.run_id}" target="_blank">#${scene.run_id}</a>
    </div>
  `;
  card.appendChild(header);

  // SVGフィールド
  const fieldContainer = document.createElement('div');
  fieldContainer.className = 'goal-field-container';
  const { svg, robotElements, ballEl } = buildFieldSVG(scene.run_id + '_' + scene.goal_index);
  fieldContainer.appendChild(svg);
  card.appendChild(fieldContainer);

  // 凡例
  const legend = document.createElement('div');
  legend.className = 'goal-legend';
  legend.innerHTML = `
    <span class="goal-legend-item"><span class="goal-legend-dot" style="background:${COLORS.ibis}"></span>ibis (yellow)</span>
    <span class="goal-legend-item"><span class="goal-legend-dot" style="background:${COLORS.tigers}"></span>TIGERs (blue)</span>
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

  const player = new GoalScenePlayer(scene, robotElements, ballEl, seekbar, timeDisplay);
  player.seek(0);

  const playBtn = document.createElement('button');
  playBtn.className = 'goal-play-btn';
  playBtn.textContent = '▶';
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

  // 再生状態に合わせてボタンを更新
  setInterval(() => {
    if (!player.playing) playBtn.textContent = '▶';
  }, 200);

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
