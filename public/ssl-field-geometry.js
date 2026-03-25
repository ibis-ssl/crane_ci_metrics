// SSL フィールド共通定数・幾何学データ
// ssl-field.js と heatmap-renderer.js から共有されます

const SSL_FIELD = {
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

const FIELD_COLORS = {
  yellow_team: '#FDD663',  // SSL yellow チーム
  blue_team:   '#5B9BF5',  // SSL blue チーム
  ball: '#ff8c00',
  field: '#2d7a2d',
  line: '#ffffff',
  goal: '#cccccc',
};

/**
 * フィールド白線の幾何学データをmm座標で返す。
 * 座標系: 原点=フィールド中心、x: -6000〜6000mm、y: -4500〜4500mm
 *
 * type一覧:
 *   'rect'   — { x, y, w, h }  (x, y は左上角)
 *   'line'   — { x1, y1, x2, y2 }
 *   'circle' — { cx, cy, r }
 *   'dot'    — { cx, cy, r }   (塗り潰し円、センタードット)
 *   'goal'   — { x, y, w, h }  (ゴールエリア、色はFIELD_COLORS.goal)
 *
 * @returns {Array<Object>}
 */
function getFieldLineElements() {
  const { length: L, width: W, penalty_area_length: paL, penalty_area_width: paW,
    center_circle_radius: ccR, goal_width: gW, goal_depth: gD } = SSL_FIELD;

  return [
    // フィールド外枠
    { type: 'rect', x: -L / 2, y: -W / 2, w: L, h: W },

    // センターライン
    { type: 'line', x1: 0, y1: -W / 2, x2: 0, y2: W / 2 },

    // センターサークル
    { type: 'circle', cx: 0, cy: 0, r: ccR },

    // センタードット
    { type: 'dot', cx: 0, cy: 0, r: 60 },

    // 左ペナルティエリア
    { type: 'rect', x: -L / 2, y: -paW / 2, w: paL, h: paW },

    // 右ペナルティエリア
    { type: 'rect', x: L / 2 - paL, y: -paW / 2, w: paL, h: paW },

    // 左ゴール
    { type: 'goal', x: -L / 2 - gD, y: -gW / 2, w: gD, h: gW },

    // 右ゴール
    { type: 'goal', x: L / 2, y: -gW / 2, w: gD, h: gW },
  ];
}
