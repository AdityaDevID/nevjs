import { clamp } from './math.js';

export class Tilemap {
  constructor({ tileSize = 16, data = [], solid = [], colors = {}, tileset = null, tilesetCols = 0, x = 0, y = 0 } = {}) {
    this.tileSize = tileSize;
    this.data = data.map((row) => [...row]);
    this.rows = this.data.length;
    this.cols = this.rows ? Math.max(...this.data.map((r) => r.length)) : 0;
    for (const row of this.data) while (row.length < this.cols) row.push(0);
    this.solid = typeof solid === 'function' ? solid : (id) => solidSet.has(id);
    const solidSet = new Set(typeof solid === 'function' ? [] : solid);
    this.colors = colors;
    this.tileset = tileset;
    this.tilesetCols = tilesetCols || (tileset ? Math.floor(tileset.width / tileSize) : 0);
    this.x = x;
    this.y = y;
  }

  static fromString(text, legend, options = {}) {
    const data = text
      .split('\n')
      .map((l) => l.replace(/\r$/, ''))
      .filter((l, i, a) => !(l.trim() === '' && (i === 0 || i === a.length - 1)))
      .map((line) => [...line].map((ch) => legend[ch] ?? 0));
    return new Tilemap({ ...options, data });
  }

  get width() {
    return this.cols * this.tileSize;
  }
  get height() {
    return this.rows * this.tileSize;
  }

  inBounds(col, row) {
    return col >= 0 && row >= 0 && col < this.cols && row < this.rows;
  }

  get(col, row) {
    return this.inBounds(col, row) ? this.data[row][col] : 0;
  }

  set(col, row, id) {
    if (this.inBounds(col, row)) this.data[row][col] = id;
  }

  toTile(wx, wy) {
    return { col: Math.floor((wx - this.x) / this.tileSize), row: Math.floor((wy - this.y) / this.tileSize) };
  }

  tileRect(col, row) {
    return { x: this.x + col * this.tileSize, y: this.y + row * this.tileSize, w: this.tileSize, h: this.tileSize };
  }

  isSolid(col, row) {
    if (!this.inBounds(col, row)) return !!this.edgesSolid;
    return this.solid(this.data[row][col]);
  }

  solidAt(wx, wy) {
    const { col, row } = this.toTile(wx, wy);
    return this.isSolid(col, row);
  }

  rectHitsSolid(r) {
    const eps = 1e-6;
    const c0 = Math.floor((r.x - this.x) / this.tileSize);
    const c1 = Math.floor((r.x + r.w - eps - this.x) / this.tileSize);
    const r0 = Math.floor((r.y - this.y) / this.tileSize);
    const r1 = Math.floor((r.y + r.h - eps - this.y) / this.tileSize);
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) if (this.isSolid(col, row)) return true;
    }
    return false;
  }

  tilesIn(r) {
    const out = [];
    const c0 = Math.floor((r.x - this.x) / this.tileSize);
    const c1 = Math.floor((r.x + r.w - 1e-6 - this.x) / this.tileSize);
    const r0 = Math.floor((r.y - this.y) / this.tileSize);
    const r1 = Math.floor((r.y + r.h - 1e-6 - this.y) / this.tileSize);
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        if (this.inBounds(col, row)) out.push({ col, row, id: this.data[row][col], rect: this.tileRect(col, row) });
      }
    }
    return out;
  }

  draw(ctx, view) {
    const ts = this.tileSize;
    const c0 = clamp(Math.floor((view.x - this.x) / ts), 0, this.cols - 1);
    const c1 = clamp(Math.floor((view.x + view.w - this.x) / ts), 0, this.cols - 1);
    const r0 = clamp(Math.floor((view.y - this.y) / ts), 0, this.rows - 1);
    const r1 = clamp(Math.floor((view.y + view.h - this.y) / ts), 0, this.rows - 1);
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const id = this.data[row][col];
        if (!id) continue;
        const dx = this.x + col * ts;
        const dy = this.y + row * ts;
        if (this.tileset && this.tilesetCols) {
          const idx = id - 1;
          ctx.drawImage(this.tileset, (idx % this.tilesetCols) * ts, Math.floor(idx / this.tilesetCols) * ts, ts, ts, dx, dy, ts, ts);
        } else {
          ctx.fillStyle = this.colors[id] ?? '#888';
          ctx.fillRect(dx, dy, ts, ts);
        }
      }
    }
  }
}
