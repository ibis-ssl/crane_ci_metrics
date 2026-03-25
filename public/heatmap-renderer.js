/**
 * ヒートマップ描画モジュール
 *
 * SSL フィールド座標系 (mm 単位、100mm ビン) のヒートマップを Canvas に描画する。
 * フィールド背景（緑 + 白線）も込みで描画するので、単体で使用可能。
 *
 * データ形式: [[x_bin, y_bin, count], ...]
 *   x_bin: 0–119 (左=0, 右=119)
 *   y_bin: 0–89  (下=0, 上=89)
 *   count: 正整数
 */

class HeatmapRenderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{ binsX?: number, binsY?: number }} options
   */
  constructor(canvas, { binsX = 120, binsY = 90 } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.binsX = binsX;
    this.binsY = binsY;
    this._fieldCache = null;
    this._fieldCacheW = 0;
    this._fieldCacheH = 0;
  }

  // -----------------------------------------------------------------------
  // カラースキーム
  // -----------------------------------------------------------------------

  /**
   * 正規化された値 (0–1) を RGBA 文字列に変換する。
   * @param {number} norm  0.0 〜 1.0
   * @param {'hot'|'yellow'|'blue'} scheme
   * @returns {string}
   */
  _color(norm, scheme) {
    if (norm <= 0) return 'rgba(0,0,0,0)';
    // アルファ: 低密度は薄く、高密度は不透明に
    const alpha = Math.min(0.92, 0.15 + norm * 0.77);

    switch (scheme) {
      case 'hot': {
        // 黒 → 赤 → オレンジ → 黄 (matplotlib 'hot' 風)
        const r = Math.min(255, norm * 3 * 255) | 0;
        const g = Math.min(255, Math.max(0, (norm * 3 - 1) * 255)) | 0;
        const b = Math.min(255, Math.max(0, (norm * 3 - 2) * 255)) | 0;
        return `rgba(${r},${g},${b},${alpha.toFixed(2)})`;
      }
      case 'yellow': {
        // 暗緑 → 濃い黄 → 明るい黄白
        const r = (180 + norm * 75) | 0;
        const g = (150 + norm * 105) | 0;
        const b = (0 + norm * 60) | 0;
        return `rgba(${r},${g},${b},${alpha.toFixed(2)})`;
      }
      case 'blue': {
        // 暗緑 → 紺 → 明るい青白
        const r = (0 + norm * 100) | 0;
        const g = (50 + norm * 130) | 0;
        const b = (150 + norm * 105) | 0;
        return `rgba(${r},${g},${b},${alpha.toFixed(2)})`;
      }
      default: {
        const v = (norm * 255) | 0;
        return `rgba(${v},${v},${v},${alpha.toFixed(2)})`;
      }
    }
  }

  // -----------------------------------------------------------------------
  // フィールド背景描画
  // -----------------------------------------------------------------------

  _getFieldCache(W, H) {
    if (this._fieldCache && this._fieldCacheW === W && this._fieldCacheH === H) {
      return this._fieldCache;
    }
    const offscreen = document.createElement('canvas');
    offscreen.width  = W;
    offscreen.height = H;
    this._drawFieldTo(offscreen.getContext('2d'), W, H);
    this._fieldCache  = offscreen;
    this._fieldCacheW = W;
    this._fieldCacheH = H;
    return offscreen;
  }

  _drawField() {
    const { canvas, ctx } = this;
    const W = canvas.width;
    const H = canvas.height;
    ctx.drawImage(this._getFieldCache(W, H), 0, 0);
  }

  _drawFieldTo(ctx, W, H) {
    const { binsX, binsY } = this;

    // 緑背景
    ctx.fillStyle = '#2d7a2d';
    ctx.fillRect(0, 0, W, H);

    // フィールド座標 → canvas 座標変換
    // フィールド: x [-6000,6000] mm, y [-4500,4500] mm (binsX×100mm, binsY×100mm)
    const margin = 0.05;  // キャンバスの5%をマージンに
    const scaleX = W * (1 - 2 * margin) / binsX;
    const scaleY = H * (1 - 2 * margin) / binsY;
    const offX = W * margin;
    const offH = H * margin;

    // ビン座標 → canvas pixel (Y 軸反転)
    const toX = (binX) => offX + binX * scaleX;
    const toY = (binY) => H - offH - (binY + 1) * scaleY;

    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = Math.max(1, W / 400);

    // フィールド外枠
    ctx.strokeRect(toX(0), toY(binsY - 1), binsX * scaleX, binsY * scaleY);

    // センターライン (x=60 bin)
    ctx.beginPath();
    ctx.moveTo(toX(binsX / 2), toY(binsY - 1));
    ctx.lineTo(toX(binsX / 2), toY(-1) + scaleY);
    ctx.stroke();

    // センターサークル (半径 500mm = 5 bin)
    const cx = toX(binsX / 2);
    const cy = toY(binsY / 2 - 0.5);
    const rX = 5 * scaleX;
    const rY = 5 * scaleY;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rX, rY, 0, 0, Math.PI * 2);
    ctx.stroke();

    // ペナルティエリア (両端): x 幅 18bin, y 幅 36bin
    const paW = 18 * scaleX;
    const paH = 36 * scaleY;
    const paY = toY(binsY / 2 - 1 + 18);

    // 左 (x=0〜18)
    ctx.strokeRect(toX(0), paY, paW, paH);
    // 右 (x=102〜120)
    ctx.strokeRect(toX(binsX - 18), paY, paW, paH);
  }

  // -----------------------------------------------------------------------
  // ヒートマップ描画
  // -----------------------------------------------------------------------

  /**
   * ヒートマップを描画する。
   * @param {Array<[number, number, number]>} data  [[x_bin, y_bin, count], ...]
   * @param {'hot'|'yellow'|'blue'} colorScheme
   */
  render(data, colorScheme = 'hot') {
    const { canvas, ctx, binsX, binsY } = this;
    const W = canvas.width;
    const H = canvas.height;

    this._drawField();

    if (!data || data.length === 0) return;

    const margin = 0.05;
    const cellW = W * (1 - 2 * margin) / binsX;
    const cellH = H * (1 - 2 * margin) / binsY;
    const offX = W * margin;
    const offH = H * margin;

    // 最大 count で正規化
    let maxCount = 1;
    for (const d of data) {
      if (d[2] > maxCount) maxCount = d[2];
    }

    // log スケールで描画 (高密度部分を見やすく)
    const logMax = Math.log(maxCount + 1);

    for (const [xb, yb, count] of data) {
      const norm = Math.log(count + 1) / logMax;
      ctx.fillStyle = this._color(norm, colorScheme);
      const px = offX + xb * cellW;
      const py = H - offH - (yb + 1) * cellH;
      ctx.fillRect(px, py, cellW + 0.5, cellH + 0.5);
    }
  }

  /**
   * フィールド背景のみに戻す。
   */
  clear() {
    this._drawField();
  }
}
