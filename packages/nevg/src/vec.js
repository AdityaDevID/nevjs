export const vec = (x = 0, y = 0) => ({ x, y });
export const vadd = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const vsub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const vscale = (a, s) => ({ x: a.x * s, y: a.y * s });
export const vdot = (a, b) => a.x * b.x + a.y * b.y;
export const vcross = (a, b) => a.x * b.y - a.y * b.x;
export const vlen = (a) => Math.hypot(a.x, a.y);
export const vdist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
export const vnorm = (a) => {
  const l = Math.hypot(a.x, a.y);
  return l ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
};
export const vrotate = (a, rad) => {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
};
export const vangle = (a) => Math.atan2(a.y, a.x);
export const vfromAngle = (rad, len = 1) => ({ x: Math.cos(rad) * len, y: Math.sin(rad) * len });
export const vlerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const angleDiff = (a, b) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d <= -Math.PI) d += Math.PI * 2;
  return d;
};
export const turnToward = (a, b, step) => {
  const d = angleDiff(a, b);
  return Math.abs(d) <= step ? b : a + Math.sign(d) * step;
};

export function segmentRect(p1, p2, r) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  let t0 = 0;
  let t1 = 1;
  for (const [p, q] of [
    [-dx, p1.x - r.x],
    [dx, r.x + r.w - p1.x],
    [-dy, p1.y - r.y],
    [dy, r.y + r.h - p1.y],
  ]) {
    if (p === 0) {
      if (q < 0) return null;
    } else {
      const t = q / p;
      if (p < 0) {
        if (t > t1) return null;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return null;
        if (t < t1) t1 = t;
      }
    }
  }
  return t0;
}

export function circleRectOverlap(c, r) {
  const nx = Math.max(r.x, Math.min(c.x, r.x + r.w));
  const ny = Math.max(r.y, Math.min(c.y, r.y + r.h));
  const dx = c.x - nx;
  const dy = c.y - ny;
  return dx * dx + dy * dy < c.r * c.r;
}
