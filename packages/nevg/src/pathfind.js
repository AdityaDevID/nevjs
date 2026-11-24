class MinHeap {
  constructor() {
    this.a = [];
  }
  get size() {
    return this.a.length;
  }
  push(item) {
    const a = this.a;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

export function gridFromTilemap(tilemap, { solidOutside = true } = {}) {
  return {
    cols: tilemap.cols,
    rows: tilemap.rows,
    blocked: (col, row) => (tilemap.inBounds(col, row) ? tilemap.isSolid(col, row) : solidOutside),
  };
}

const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIRS8 = [...DIRS4, [1, 1], [1, -1], [-1, 1], [-1, -1]];

export function findPath(grid, start, goal, options = {}) {
  const { diagonal = false, cost = () => 1, maxNodes = 10_000, allowGoalBlocked = false } = options;
  const { cols, rows } = grid;
  const inside = (c, r) => c >= 0 && r >= 0 && c < cols && r < rows;
  const free = (c, r) => inside(c, r) && !grid.blocked(c, r) && cost(c, r) !== Infinity;
  if (!inside(start.col, start.row) || !inside(goal.col, goal.row)) return null;
  const goalBlocked = !free(goal.col, goal.row);
  if (goalBlocked && !allowGoalBlocked) return null;
  if (start.col === goal.col && start.row === goal.row) return [{ col: start.col, row: start.row }];

  const key = (c, r) => r * cols + c;
  const h = (c, r) => {
    const dx = Math.abs(c - goal.col);
    const dy = Math.abs(r - goal.row);
    return diagonal ? dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy) : dx + dy;
  };
  const g = new Map([[key(start.col, start.row), 0]]);
  const parent = new Map();
  const closed = new Set();
  const open = new MinHeap();
  open.push({ c: start.col, r: start.row, f: h(start.col, start.row) });
  let expanded = 0;

  const build = (c, r) => {
    const out = [{ col: c, row: r }];
    let k = key(c, r);
    while (parent.has(k)) {
      k = parent.get(k);
      out.push({ col: k % cols, row: Math.floor(k / cols) });
    }
    return out.reverse();
  };

  while (open.size) {
    const cur = open.pop();
    const ck = key(cur.c, cur.r);
    if (closed.has(ck)) continue;
    closed.add(ck);
    if (cur.c === goal.col && cur.r === goal.row) return build(cur.c, cur.r);
    if (++expanded > maxNodes) return null;
    for (const [dx, dy] of diagonal ? DIRS8 : DIRS4) {
      const nc = cur.c + dx;
      const nr = cur.r + dy;
      const isGoal = nc === goal.col && nr === goal.row;
      if (!free(nc, nr)) {
        if (!(isGoal && allowGoalBlocked && goalBlocked)) continue;
        if (diagonal && dx !== 0 && dy !== 0 && (!free(cur.c + dx, cur.r) || !free(cur.c, cur.r + dy))) continue;
        return build(cur.c, cur.r);
      }
      if (dx !== 0 && dy !== 0 && (!free(cur.c + dx, cur.r) || !free(cur.c, cur.r + dy))) continue;
      const nk = key(nc, nr);
      if (closed.has(nk)) continue;
      const step = (dx !== 0 && dy !== 0 ? Math.SQRT2 : 1) * cost(nc, nr);
      const ng = g.get(ck) + step;
      if (ng < (g.get(nk) ?? Infinity)) {
        g.set(nk, ng);
        parent.set(nk, ck);
        open.push({ c: nc, r: nr, f: ng + h(nc, nr) });
      }
    }
  }
  return null;
}

export function pathToWorld(tilemap, path) {
  return path.map(({ col, row }) => {
    const r = tilemap.tileRect(col, row);
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  });
}

export function simplifyPath(path) {
  if (path.length < 3) return path.slice();
  const out = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const a = path[i - 1];
    const b = path[i];
    const c = path[i + 1];
    if (b.col - a.col !== c.col - b.col || b.row - a.row !== c.row - b.row) out.push(b);
  }
  out.push(path[path.length - 1]);
  return out;
}

export function lineOfSight(grid, a, b) {
  let { col: x0, row: y0 } = a;
  const { col: x1, row: y1 } = b;
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  for (;;) {
    if ((x0 !== a.col || y0 !== a.row) && grid.blocked(x0, y0)) return false;
    if (x0 === x1 && y0 === y1) return true;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }
}

export function reachable(grid, start, maxSteps = Infinity, { diagonal = false } = {}) {
  const { cols, rows } = grid;
  const seen = new Map([[start.row * cols + start.col, 0]]);
  const queue = [{ col: start.col, row: start.row }];
  const out = [{ col: start.col, row: start.row, steps: 0 }];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    const steps = seen.get(cur.row * cols + cur.col);
    if (steps >= maxSteps) continue;
    for (const [dx, dy] of diagonal ? DIRS8 : DIRS4) {
      const c = cur.col + dx;
      const r = cur.row + dy;
      if (c < 0 || r < 0 || c >= cols || r >= rows || grid.blocked(c, r) || seen.has(r * cols + c)) continue;
      if (dx !== 0 && dy !== 0 && (grid.blocked(cur.col + dx, cur.row) || grid.blocked(cur.col, cur.row + dy))) continue;
      seen.set(r * cols + c, steps + 1);
      queue.push({ col: c, row: r });
      out.push({ col: c, row: r, steps: steps + 1 });
    }
  }
  return out;
}
