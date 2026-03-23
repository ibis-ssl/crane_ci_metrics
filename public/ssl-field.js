// SSL フィールド共有モジュール
// goals.js と player.js から使用される SVG フィールド描画ユーティリティ

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

const COLORS = {
  yellow_team: '#FDD663',  // SSL yellow チーム
  blue_team:   '#5B9BF5',  // SSL blue チーム
  // goals.js との後方互換エイリアス
  ibis:   '#FDD663',
  tigers: '#5B9BF5',
  ball: '#ff8c00',
  field: '#2d7a2d',
  line: '#ffffff',
  goal: '#cccccc',
};

const SVG_NS = 'http://www.w3.org/2000/svg';
const VIEW_MARGIN = 700;

function createSVGElement(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

// SVGフィールドを描画して要素IDマップを返す
function buildFieldSVG() {
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
  for (const [team, color] of [['yellow', COLORS.yellow_team], ['blue', COLORS.blue_team]]) {
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
      robotElements[team].push({ g, label });
    }
  }

  // ボール要素
  const ballEl = createSVGElement('circle', {
    r: FIELD.ball_radius * 2.5, fill: COLORS.ball,
    stroke: '#cc6600', 'stroke-width': 15, visibility: 'hidden',
  });
  svg.appendChild(ballEl);

  // ゲームイベントオーバーレイ（最前面）
  const eventOverlay = createSVGElement('g', { class: 'game-event-overlay' });
  svg.appendChild(eventOverlay);

  return { svg, robotElements, ballEl, eventOverlay };
}

function updateFrame(frame, robotElements, ballEl) {
  // ボール更新
  if (frame.ball) {
    ballEl.setAttribute('cx', frame.ball.x);
    ballEl.setAttribute('cy', -frame.ball.y);
    ballEl.setAttribute('visibility', 'visible');
  } else {
    ballEl.setAttribute('visibility', 'hidden');
  }

  // ロボット更新
  for (const [teamKey, svgTeam] of [['robots_yellow', 'yellow'], ['robots_blue', 'blue']]) {
    const robots = frame[teamKey] || [];
    const els = robotElements[svgTeam];

    els.forEach(({ g }) => g.setAttribute('visibility', 'hidden'));

    for (const robot of robots) {
      if (robot.id >= els.length) continue;
      const { g, label } = els[robot.id];
      const theta = -(robot.theta || 0);
      g.setAttribute('transform', `translate(${robot.x},${-robot.y}) rotate(${theta * 180 / Math.PI})`);
      g.setAttribute('visibility', 'visible');
      label.textContent = String(robot.id);
    }
  }
}

/**
 * ゲームイベントオーバーレイを更新する
 * @param {SVGGElement} overlayGroup - buildFieldSVG() が返す eventOverlay
 * @param {Array} events - { type, byTeam, byBot, location, opacity, label, icon, details } の配列
 *   location: { x, y } mm単位
 */
function updateGameEvents(overlayGroup, events) {
  // 既存子要素を全削除
  while (overlayGroup.firstChild) overlayGroup.removeChild(overlayGroup.firstChild);

  for (const ev of events) {
    if (!ev.location) continue;

    const x = ev.location.x;
    const y = -ev.location.y;  // Y軸反転

    const teamColor = ev.byTeam === 'yellow' ? COLORS.yellow_team
      : ev.byTeam === 'blue' ? COLORS.blue_team
      : '#888888';

    const g = createSVGElement('g', { opacity: String(ev.opacity) });

    // 背景円
    g.appendChild(createSVGElement('circle', {
      cx: x, cy: y, r: 150,
      fill: teamColor, stroke: 'black', 'stroke-width': 15, opacity: '0.8',
    }));

    // アイコン (絵文字テキスト)
    const iconText = createSVGElement('text', {
      x, y,
      'text-anchor': 'middle', 'dominant-baseline': 'central',
      'font-size': 160, 'pointer-events': 'none', 'user-select': 'none',
    });
    iconText.textContent = ev.icon || '⚠️';
    g.appendChild(iconText);

    // イベント名ラベル
    const nameText = createSVGElement('text', {
      x, y: y + 220,
      'text-anchor': 'middle', 'dominant-baseline': 'central',
      'font-size': 130, 'font-weight': 'bold',
      fill: 'white', stroke: 'black', 'stroke-width': 40,
      'paint-order': 'stroke',
      'pointer-events': 'none', 'user-select': 'none',
    });
    nameText.textContent = ev.label || 'イベント';
    g.appendChild(nameText);

    // ボット番号
    if (ev.byBot != null) {
      const botText = createSVGElement('text', {
        x, y: y + 380,
        'text-anchor': 'middle', 'dominant-baseline': 'central',
        'font-size': 110,
        fill: 'white', stroke: 'black', 'stroke-width': 30,
        'paint-order': 'stroke',
        'pointer-events': 'none', 'user-select': 'none',
      });
      botText.textContent = `#${ev.byBot}`;
      g.appendChild(botText);
    }

    // 補足情報（速度・距離等）
    if (ev.details) {
      const detText = createSVGElement('text', {
        x, y: y + (ev.byBot != null ? 510 : 380),
        'text-anchor': 'middle', 'dominant-baseline': 'central',
        'font-size': 100, 'font-weight': 'bold',
        fill: '#FDD663', stroke: 'black', 'stroke-width': 25,
        'paint-order': 'stroke',
        'pointer-events': 'none', 'user-select': 'none',
      });
      detText.textContent = ev.details;
      g.appendChild(detText);
    }

    overlayGroup.appendChild(g);
  }
}

// SVGズーム/パン制御クラス
class SvgZoomPan {
  constructor(svg) {
    this.svg = svg;
    const vb = svg.getAttribute('viewBox').split(' ').map(Number);
    this._baseVB = [...vb];
    this._vb = [...vb];
    this._dragging = false;
    this._lastPos = null;

    svg.addEventListener('wheel', this._onWheel.bind(this), { passive: false });
    svg.addEventListener('pointerdown', this._onPointerDown.bind(this));
    svg.addEventListener('pointermove', this._onPointerMove.bind(this));
    svg.addEventListener('pointerup', this._onPointerUp.bind(this));
    svg.addEventListener('pointercancel', this._onPointerUp.bind(this));
    svg.addEventListener('dblclick', this.reset.bind(this));
  }

  _applyVB() {
    this.svg.setAttribute('viewBox', this._vb.join(' '));
  }

  _svgPoint(clientX, clientY) {
    const rect = this.svg.getBoundingClientRect();
    return {
      x: this._vb[0] + (clientX - rect.left) / rect.width * this._vb[2],
      y: this._vb[1] + (clientY - rect.top) / rect.height * this._vb[3],
    };
  }

  _onWheel(e) {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.1 : 0.9;
    const pt = this._svgPoint(e.clientX, e.clientY);
    this._vb[2] *= factor;
    this._vb[3] *= factor;
    this._vb[0] = pt.x - (pt.x - this._vb[0]) * factor;
    this._vb[1] = pt.y - (pt.y - this._vb[1]) * factor;
    this._applyVB();
  }

  _onPointerDown(e) {
    if (e.button !== 0) return;
    this._dragging = true;
    this._lastPos = { x: e.clientX, y: e.clientY };
    this.svg.setPointerCapture(e.pointerId);
  }

  _onPointerMove(e) {
    if (!this._dragging) return;
    const rect = this.svg.getBoundingClientRect();
    const dx = -(e.clientX - this._lastPos.x) / rect.width * this._vb[2];
    const dy = -(e.clientY - this._lastPos.y) / rect.height * this._vb[3];
    this._vb[0] += dx;
    this._vb[1] += dy;
    this._lastPos = { x: e.clientX, y: e.clientY };
    this._applyVB();
  }

  _onPointerUp(e) {
    this._dragging = false;
    this.svg.releasePointerCapture(e.pointerId);
  }

  reset() {
    this._vb = [...this._baseVB];
    this._applyVB();
  }
}
