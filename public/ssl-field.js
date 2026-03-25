// SSL フィールド共有モジュール
// goals.js と player.js から使用される SVG フィールド描画ユーティリティ
// フィールド定数は ssl-field-geometry.js で定義（このファイルより前に読み込むこと）

// 後方互換性のためエイリアスを維持
const FIELD = SSL_FIELD;
const COLORS = FIELD_COLORS;

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

  // グラデーション・フィルター定義
  // SVGが複数ページに埋め込まれる際のID衝突を防ぐためユニークなプレフィックスを使用
  const uid = Math.random().toString(36).slice(2, 8);
  const defs = createSVGElement('defs');

  // ドロップシャドウフィルター
  const shadowFilter = createSVGElement('filter', {
    id: `robot-shadow-${uid}`, x: '-40%', y: '-40%', width: '180%', height: '180%',
  });
  const fds = createSVGElement('feDropShadow', {
    dx: '15', dy: '15', stdDeviation: '25',
    'flood-color': '#000000', 'flood-opacity': '0.5',
  });
  shadowFilter.appendChild(fds);
  defs.appendChild(shadowFilter);

  // 黄チーム: 右上ハイライト → 外縁に向かって鮮明な黄
  const gradYellow = createSVGElement('radialGradient', { id: `grad-yellow-${uid}`, cx: '38%', cy: '38%', r: '65%' });
  gradYellow.appendChild(createSVGElement('stop', { offset: '0%',   'stop-color': '#FFF59D' }));
  gradYellow.appendChild(createSVGElement('stop', { offset: '100%', 'stop-color': '#FFD600' }));
  defs.appendChild(gradYellow);

  // 青チーム: 右上ハイライト → 外縁に向かって濃い青
  const gradBlue = createSVGElement('radialGradient', { id: `grad-blue-${uid}`, cx: '38%', cy: '38%', r: '65%' });
  gradBlue.appendChild(createSVGElement('stop', { offset: '0%',   'stop-color': '#90CAF9' }));
  gradBlue.appendChild(createSVGElement('stop', { offset: '100%', 'stop-color': '#1565C0' }));
  defs.appendChild(gradBlue);

  svg.appendChild(defs);

  // フィールド背景
  svg.appendChild(createSVGElement('rect', {
    x: vx, y: vy, width: vw, height: vh, fill: COLORS.field,
  }));

  // フィールド白線（共通幾何学データから生成）
  for (const el of getFieldLineElements()) {
    if (el.type === 'rect') {
      svg.appendChild(createSVGElement('rect', {
        x: el.x, y: el.y, width: el.w, height: el.h,
        fill: 'none', stroke: COLORS.line, 'stroke-width': 30,
      }));
    } else if (el.type === 'line') {
      svg.appendChild(createSVGElement('line', {
        x1: el.x1, y1: el.y1, x2: el.x2, y2: el.y2,
        stroke: COLORS.line, 'stroke-width': 30,
      }));
    } else if (el.type === 'circle') {
      svg.appendChild(createSVGElement('circle', {
        cx: el.cx, cy: el.cy, r: el.r,
        fill: 'none', stroke: COLORS.line, 'stroke-width': 30,
      }));
    } else if (el.type === 'dot') {
      svg.appendChild(createSVGElement('circle', {
        cx: el.cx, cy: el.cy, r: el.r, fill: COLORS.line,
      }));
    } else if (el.type === 'goal') {
      svg.appendChild(createSVGElement('rect', {
        x: el.x, y: el.y, width: el.w, height: el.h,
        fill: 'none', stroke: COLORS.goal, 'stroke-width': 40,
      }));
    }
  }

  // ロボット要素（yellow + blue、各16体分を事前生成）
  const robotElements = { yellow: [], blue: [] };
  for (const [team, gradId, strokeColor] of [
    ['yellow', `url(#grad-yellow-${uid})`, '#B8860B'],
    ['blue',   `url(#grad-blue-${uid})`,   '#0D47A1'],
  ]) {
    for (let i = 0; i < 16; i++) {
      const g = createSVGElement('g', { visibility: 'hidden', 'data-team': team, 'data-idx': i });
      const circle = createSVGElement('circle', {
        r: FIELD.robot_radius, fill: gradId,
        stroke: strokeColor, 'stroke-width': 22,
        filter: `url(#robot-shadow-${uid})`,
      });
      const dirLine = createSVGElement('line', {
        x1: 0, y1: 0, x2: FIELD.robot_radius, y2: 0,
        stroke: 'white', 'stroke-width': 28,
      });
      const label = createSVGElement('text', {
        'text-anchor': 'middle', 'dominant-baseline': 'central',
        fill: 'white', 'font-size': 120, 'font-weight': 'bold',
        stroke: strokeColor, 'stroke-width': 25, 'paint-order': 'stroke',
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
