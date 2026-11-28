// NevF Animate — mesin animasi premium setara Anime.js:
// animate(), createTimeline(), stagger(), easing lengkap (termasuk
// cubic-bezier, steps, dan spring berbasis fisika).
//
// Aman diimpor di server (SSR): tidak ada akses DOM saat import,
// semua akses DOM dijaga (guard) dan dilakukan lazily saat animasi dibuat.

/* ============================== Easing ============================== */

const BACK_S = 1.70158;

function bounceOut(t) {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
}

export const easings = {
  linear: (t) => t,
  easeInQuad: (t) => t * t,
  easeOutQuad: (t) => 1 - (1 - t) * (1 - t),
  easeInOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  easeInCubic: (t) => t * t * t,
  easeOutCubic: (t) => 1 - Math.pow(1 - t, 3),
  easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  easeInQuart: (t) => t * t * t * t,
  easeOutQuart: (t) => 1 - Math.pow(1 - t, 4),
  easeInOutQuart: (t) => (t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2),
  easeInQuint: (t) => t * t * t * t * t,
  easeOutQuint: (t) => 1 - Math.pow(1 - t, 5),
  easeInOutQuint: (t) => (t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2),
  easeInSine: (t) => 1 - Math.cos((t * Math.PI) / 2),
  easeOutSine: (t) => Math.sin((t * Math.PI) / 2),
  easeInOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  easeInExpo: (t) => (t === 0 ? 0 : Math.pow(2, 10 * t - 10)),
  easeOutExpo: (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  easeInOutExpo: (t) =>
    t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2,
  easeInCirc: (t) => 1 - Math.sqrt(1 - t * t),
  easeOutCirc: (t) => Math.sqrt(1 - Math.pow(t - 1, 2)),
  easeInOutCirc: (t) =>
    t < 0.5 ? (1 - Math.sqrt(1 - Math.pow(2 * t, 2))) / 2 : (Math.sqrt(1 - Math.pow(-2 * t + 2, 2)) + 1) / 2,
  easeInBack: (t) => (BACK_S + 1) * t * t * t - BACK_S * t * t,
  easeOutBack: (t) => 1 + (BACK_S + 1) * Math.pow(t - 1, 3) + BACK_S * Math.pow(t - 1, 2),
  easeInOutBack: (t) => {
    const s = BACK_S * 1.525;
    return t < 0.5
      ? (Math.pow(2 * t, 2) * ((s + 1) * 2 * t - s)) / 2
      : (Math.pow(2 * t - 2, 2) * ((s + 1) * (2 * t - 2) + s) + 2) / 2;
  },
  easeOutBounce: bounceOut,
  easeInBounce: (t) => 1 - bounceOut(1 - t),
  easeInOutBounce: (t) => (t < 0.5 ? (1 - bounceOut(1 - 2 * t)) / 2 : (1 + bounceOut(2 * t - 1)) / 2),
  easeOutElastic: (t) =>
    t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1,
  easeInElastic: (t) =>
    t === 0 ? 0 : t === 1 ? 1 : -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * ((2 * Math.PI) / 3)),
  easeInOutElastic: (t) =>
    t === 0
      ? 0
      : t === 1
        ? 1
        : t < 0.5
          ? -(Math.pow(2, 20 * t - 10) * Math.sin((20 * t - 11.125) * ((2 * Math.PI) / 4.5))) / 2
          : (Math.pow(2, -20 * t + 10) * Math.sin((20 * t - 11.125) * ((2 * Math.PI) / 4.5))) / 2 + 1,
};

/** Easing cubic-bezier ala CSS: selesaikan kurva x(t) dengan Newton + bisection. */
export function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t) => ((ay * t + by) * t + cy) * t;
  const derivX = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return function (t) {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let u = t;
    for (let i = 0; i < 8; i++) {
      const err = sampleX(u) - t;
      if (Math.abs(err) < 1e-6) return sampleY(u);
      const d = derivX(u);
      if (Math.abs(d) < 1e-6) break;
      u -= err / d;
    }
    let lo = 0;
    let hi = 1;
    u = t;
    while (hi - lo > 1e-6) {
      if (sampleX(u) < t) lo = u;
      else hi = u;
      u = (lo + hi) / 2;
    }
    return sampleY(u);
  };
}

/** Easing berjenjang (sprite frames / efek ketik). */
export function steps(n, mode = 'end') {
  const count = Math.max(1, Math.floor(n) || 1);
  return function (t) {
    if (t >= 1) return 1;
    if (t <= 0) return mode === 'start' ? 1 / count : 0;
    if (mode === 'start') return Math.min(1, (Math.floor(t * count) + 1) / count);
    return Math.floor(t * count) / count;
  };
}

/**
 * Spring berbasis fisika (bukan easing murni): simulasi semi-implicit Euler
 * pada langkah tetap 1/240 dari 0 → 1 saat factory dipanggil. Durasi efektif
 * animasi ditentukan oleh waktu settle simulasi (maks 10 detik), dan kurva
 * hasil simulasi dipakai sebagai easing. Hasil ditandai `.isSpring` agar
 * animate() bisa mendeteksinya.
 */
export function spring({ stiffness = 100, damping = 10, mass = 1, velocity = 0 } = {}) {
  const dt = 1 / 240;
  const maxSteps = 240 * 10;
  const samples = [0];
  let x = 0;
  let v = velocity;
  for (let i = 0; i < maxSteps; i++) {
    const a = (-stiffness * (x - 1) - damping * v) / mass;
    v += a * dt;
    x += v * dt;
    samples.push(x);
    if (Math.abs(x - 1) < 1e-4 && Math.abs(v) < 1e-4) break;
  }
  samples.push(1); // titik akhir eksak
  const duration = (samples.length - 1) * dt * 1000;
  const fn = function (t) {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const pos = t * (samples.length - 1);
    const i = Math.floor(pos);
    const f = pos - i;
    return samples[i] + (samples[i + 1] - samples[i]) * f;
  };
  fn.isSpring = true;
  fn.springDuration = duration;
  fn.springParams = { stiffness, damping, mass, velocity };
  return fn;
}

function resolveEase(ease) {
  if (ease == null) return easings.easeOutQuad;
  if (typeof ease === 'string') return easings[ease] || easings.easeOutQuad;
  if (Array.isArray(ease)) return cubicBezier(ease[0], ease[1], ease[2], ease[3]);
  if (typeof ease === 'function') return ease;
  return easings.easeOutQuad;
}

/* ============================== Stagger ============================== */

// Pseudo-random deterministik per indeks (untuk from: 'random').
function rand01(i) {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * stagger(value, opts) → fungsi (el, i, total) => number.
 * value bisa angka tunggal (jarak antar target) atau rentang [dari, ke].
 */
export function stagger(value, opts = {}) {
  const from = opts.from ?? 'first';
  const start = opts.start ?? 0;
  const easeFn = opts.ease != null ? resolveEase(opts.ease) : null;
  const grid = opts.grid || null;
  return function (el, i, total) {
    const count = Math.max(1, total || 1);
    let d;
    let maxD;
    if (grid) {
      const rows = grid[0];
      const cols = grid[1];
      const r = Math.floor(i / cols);
      const c = i % cols;
      if (from === 'random') {
        d = rand01(i);
        maxD = 1;
      } else {
        let or;
        let oc;
        if (from === 'last') {
          or = rows - 1;
          oc = cols - 1;
        } else if (from === 'center') {
          or = (rows - 1) / 2;
          oc = (cols - 1) / 2;
        } else if (typeof from === 'number') {
          or = Math.floor(from / cols);
          oc = from % cols;
        } else {
          or = 0;
          oc = 0;
        }
        if (opts.axis === 'x') {
          d = Math.abs(c - oc);
          maxD = Math.max(oc, cols - 1 - oc);
        } else if (opts.axis === 'y') {
          d = Math.abs(r - or);
          maxD = Math.max(or, rows - 1 - or);
        } else {
          d = Math.hypot(r - or, c - oc);
          maxD = Math.hypot(Math.max(or, rows - 1 - or), Math.max(oc, cols - 1 - oc));
        }
      }
    } else if (from === 'random') {
      d = rand01(i) * (count - 1);
      maxD = count - 1;
    } else {
      let o;
      if (from === 'last') o = count - 1;
      else if (from === 'center') o = (count - 1) / 2;
      else if (typeof from === 'number') o = from;
      else o = 0;
      d = Math.abs(i - o);
      maxD = Math.max(o, count - 1 - o);
    }
    const norm = maxD > 0 ? d / maxD : 0;
    if (Array.isArray(value)) {
      const e = easeFn ? easeFn(norm) : norm;
      return value[0] + (value[1] - value[0]) * e;
    }
    return start + value * (easeFn ? easeFn(norm) * maxD : d);
  };
}

/* ============================== Nilai (values) ============================== */

function parseColor(str) {
  const s = str.trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    const hex = m[1];
    if (hex.length === 3)
      return {
        type: 'color',
        r: parseInt(hex[0] + hex[0], 16),
        g: parseInt(hex[1] + hex[1], 16),
        b: parseInt(hex[2] + hex[2], 16),
        a: 1,
      };
    if (hex.length === 6)
      return {
        type: 'color',
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: 1,
      };
    if (hex.length === 8)
      return {
        type: 'color',
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: parseInt(hex.slice(6, 8), 16) / 255,
      };
    return null;
  }
  m = s.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const parts = m[1].split(',').map((p) => parseFloat(p));
    if (parts.length >= 3 && parts.slice(0, 3).every((n) => Number.isFinite(n)))
      return { type: 'color', r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  }
  return null;
}

function parseValue(v) {
  if (typeof v === 'number') return { type: 'num', n: v, unit: '' };
  if (typeof v === 'string') {
    const color = parseColor(v);
    if (color) return color;
    const m = v.trim().match(/^(-?\d*\.?\d+(?:e[-+]?\d+)?)([a-z%]*)$/i);
    if (m) return { type: 'num', n: parseFloat(m[1]), unit: m[2] };
    return { type: 'raw', str: v };
  }
  if (v == null) return { type: 'num', n: 0, unit: '' };
  return { type: 'raw', str: String(v) };
}

function toColor(v) {
  if (v.type === 'color') return v;
  if (v.type === 'num') return { type: 'color', r: v.n, g: v.n, b: v.n, a: 1 };
  return parseColor(v.str) || { type: 'color', r: 0, g: 0, b: 0, a: 1 };
}

// Samakan tipe/unit pasangan from–to agar bisa diinterpolasi.
function unifyPair(a, b) {
  if (a.type === 'color' || b.type === 'color') return [toColor(a), toColor(b)];
  if (a.type === 'num' && b.type === 'num') {
    if (!a.unit && b.unit) a = { ...a, unit: b.unit };
    if (!b.unit && a.unit) b = { ...b, unit: a.unit };
  }
  return [a, b];
}

function interp(a, b, p) {
  if (a.type === 'num' && b.type === 'num')
    return { type: 'num', n: a.n + (b.n - a.n) * p, unit: b.unit || a.unit };
  if (a.type === 'color' && b.type === 'color')
    return {
      type: 'color',
      r: a.r + (b.r - a.r) * p,
      g: a.g + (b.g - a.g) * p,
      b: a.b + (b.b - a.b) * p,
      a: a.a + (b.a - a.a) * p,
    };
  return p >= 1 ? b : a;
}

function roundNum(n) {
  const r = Math.round(n * 10000) / 10000;
  return r === 0 ? 0 : r; // hindari -0
}

function formatValue(v, forDOM) {
  if (v.type === 'num') {
    const n = roundNum(v.n);
    if (v.unit) return `${n}${v.unit}`;
    return forDOM ? String(n) : n;
  }
  if (v.type === 'color') {
    const r = Math.round(v.r);
    const g = Math.round(v.g);
    const b = Math.round(v.b);
    const a = Math.round(v.a * 1000) / 1000;
    return a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  return v.str;
}

function applyRelative(fromParsed, str) {
  const m = str.trim().match(/^([+\-*])=\s*(-?\d*\.?\d+(?:e[-+]?\d+)?)([a-z%]*)$/i);
  if (!m || fromParsed.type !== 'num') return null;
  const n = parseFloat(m[2]);
  let v;
  if (m[1] === '+') v = fromParsed.n + n;
  else if (m[1] === '-') v = fromParsed.n - n;
  else v = fromParsed.n * n;
  return { type: 'num', n: v, unit: m[3] || fromParsed.unit };
}

function isRelativeString(v) {
  return typeof v === 'string' && /^[+\-*]=/.test(v.trim());
}

/* ============================== Target & DOM ============================== */

function isElement(v) {
  return !!v && typeof v === 'object' && v.nodeType === 1;
}

function resolveTargets(targets) {
  if (targets == null) return [];
  if (typeof targets === 'string') {
    const doc = globalThis.document;
    if (doc && typeof doc.querySelectorAll === 'function') {
      try {
        return Array.from(doc.querySelectorAll(targets));
      } catch {
        return [];
      }
    }
    return [];
  }
  if (isElement(targets)) return [targets];
  if (Array.isArray(targets)) return targets.filter((t) => t != null);
  if (typeof targets === 'object' && typeof targets.length === 'number') {
    // NodeList / array-like
    try {
      const arr = Array.from(targets).filter((t) => t != null);
      if (arr.length || targets.length === 0) return arr;
    } catch {
      /* abaikan, perlakukan sebagai objek tunggal */
    }
  }
  return [targets];
}

const TRANSFORM_PROPS = new Set([
  'x', 'y', 'z',
  'translateX', 'translateY', 'translateZ',
  'scale', 'scaleX', 'scaleY', 'scaleZ',
  'rotate', 'rotateX', 'rotateY', 'rotateZ',
  'skewX', 'skewY', 'perspective',
]);
const TRANSFORM_ALIAS = { x: 'translateX', y: 'translateY', z: 'translateZ' };

const transformStates = new WeakMap();
function getTransformState(el) {
  let s = transformStates.get(el);
  if (!s) {
    s = { values: new Map() };
    transformStates.set(el, s);
  }
  return s;
}

const ZERO_PX = { type: 'num', n: 0, unit: 'px' };
const ZERO_DEG = { type: 'num', n: 0, unit: 'deg' };
const ONE = { type: 'num', n: 1, unit: '' };

function composeTransform(values) {
  const parts = [];
  const g = (k) => values.get(k);
  const f = (v) => formatValue(v, true);
  if (g('perspective')) parts.push(`perspective(${f(g('perspective'))})`);
  if (g('translateX') || g('translateY') || g('translateZ'))
    parts.push(
      `translate3d(${f(g('translateX') || ZERO_PX)}, ${f(g('translateY') || ZERO_PX)}, ${f(g('translateZ') || ZERO_PX)})`,
    );
  if (g('scaleX') || g('scaleY') || g('scaleZ'))
    parts.push(`scale3d(${f(g('scaleX') || ONE)}, ${f(g('scaleY') || ONE)}, ${f(g('scaleZ') || ONE)})`);
  if (g('rotate')) parts.push(`rotate(${f(g('rotate'))})`);
  if (g('rotateX')) parts.push(`rotateX(${f(g('rotateX'))})`);
  if (g('rotateY')) parts.push(`rotateY(${f(g('rotateY'))})`);
  if (g('rotateZ')) parts.push(`rotateZ(${f(g('rotateZ'))})`);
  if (g('skewX') || g('skewY')) parts.push(`skew(${f(g('skewX') || ZERO_DEG)}, ${f(g('skewY') || ZERO_DEG)})`);
  return parts.join(' ');
}

const DIMENSIONAL_PROPS = new Set([
  'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight',
  'top', 'left', 'right', 'bottom', 'inset',
  'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'fontSize', 'borderRadius', 'borderWidth', 'gap', 'rowGap', 'columnGap',
  'letterSpacing', 'wordSpacing', 'textIndent', 'outlineWidth',
]);

// Nilai transform & properti dimensi CSS WAJIB membawa satuan di browser
// (translate3d(750, …) tanpa px tidak valid dan diabaikan diam-diam).
function withUnit(parsed, unit) {
  return parsed && parsed.type === 'num' && !parsed.unit ? { ...parsed, unit } : parsed;
}

function setTransformValue(el, prop, parsed) {
  if (prop.startsWith('translate') || prop === 'perspective') parsed = withUnit(parsed, 'px');
  else if (prop.startsWith('rotate') || prop.startsWith('skew')) parsed = withUnit(parsed, 'deg');
  const st = getTransformState(el);
  if (prop === 'scale') {
    st.values.set('scaleX', parsed);
    st.values.set('scaleY', parsed);
  } else {
    st.values.set(prop, parsed);
  }
  el.style.transform = composeTransform(st.values);
}

// Baca nilai awal sebuah properti dari target (untuk "from" & revert).
function captureFrom(target, prop, hint) {
  if (isElement(target)) {
    if (TRANSFORM_PROPS.has(prop)) {
      const canon = TRANSFORM_ALIAS[prop] || prop;
      const key = canon === 'scale' ? 'scaleX' : canon;
      const cur = getTransformState(target).values.get(key);
      if (cur) return { ...cur };
      if (canon.startsWith('scale')) return { type: 'num', n: 1, unit: '' };
      if (canon.startsWith('rotate') || canon.startsWith('skew'))
        return { type: 'num', n: 0, unit: (hint && hint.unit) || 'deg' };
      return { type: 'num', n: 0, unit: (hint && hint.unit) || 'px' };
    }
    let raw = '';
    try {
      raw = prop.startsWith('--') ? target.style.getPropertyValue(prop) : target.style[prop] || '';
    } catch {
      raw = '';
    }
    if ((raw === '' || raw == null) && typeof globalThis.getComputedStyle === 'function') {
      try {
        raw = globalThis.getComputedStyle(target)[prop] || '';
      } catch {
        raw = '';
      }
    }
    if (raw === '' || raw == null) {
      if (hint && hint.type === 'color') return { type: 'color', r: 0, g: 0, b: 0, a: 1 };
      return { type: 'num', n: prop === 'opacity' ? 1 : 0, unit: (hint && hint.unit) || '' };
    }
    const [from] = unifyPair(parseValue(raw), hint || { type: 'num', n: 0, unit: '' });
    return from;
  }
  const cur = target[prop];
  if (cur === undefined) {
    if (hint && hint.type === 'color') return { type: 'color', r: 0, g: 0, b: 0, a: 1 };
    return { type: 'num', n: prop === 'opacity' ? 1 : 0, unit: (hint && hint.unit) || '' };
  }
  const [from] = unifyPair(parseValue(cur), hint || { type: 'num', n: 0, unit: '' });
  return from;
}

function makeApplier(target, prop) {
  if (isElement(target)) {
    if (TRANSFORM_PROPS.has(prop)) {
      const canon = TRANSFORM_ALIAS[prop] || prop;
      return (val) => setTransformValue(target, canon, val);
    }
    if (prop.startsWith('--')) return (val) => target.style.setProperty(prop, formatValue(val, true));
    return (val) => {
      if (DIMENSIONAL_PROPS.has(prop)) val = withUnit(val, 'px');
      target.style[prop] = formatValue(val, true);
    };
  }
  return (val) => {
    target[prop] = formatValue(val, false);
  };
}

// Buat fungsi restore untuk revert(); dicatat sekali per (target, prop/elemen).
function makeRestorer(target, prop, seen) {
  if (isElement(target)) {
    if (TRANSFORM_PROPS.has(prop)) {
      if (seen.has(target)) return null;
      seen.add(target);
      const original = target.style.transform || '';
      return () => {
        target.style.transform = original;
        transformStates.delete(target);
      };
    }
    if (prop.startsWith('--')) {
      const original = target.style.getPropertyValue(prop);
      return () => {
        if (original) target.style.setProperty(prop, original);
        else target.style.removeProperty(prop);
      };
    }
    const original = target.style[prop] || '';
    return () => {
      target.style[prop] = original;
    };
  }
  const had = prop in target;
  const original = target[prop];
  return () => {
    if (had) target[prop] = original;
    else delete target[prop];
  };
}

/* ============================== Track (per target+prop) ============================== */

const RESERVED = new Set([
  'duration', 'delay', 'endDelay', 'ease', 'easing',
  'loop', 'alternate', 'reversed', 'autoplay',
  'onBegin', 'onUpdate', 'onLoop', 'onComplete', 'targets',
]);

function isKeyframeItem(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v) && ('to' in v || 'value' in v);
}

function buildTrack(target, index, total, prop, rawSpec, baseDuration, baseEase) {
  let spec = rawSpec;
  if (typeof spec === 'function') spec = spec(target, index, total);

  const resolveTo = (rawTo, prevParsed) => {
    let v = rawTo;
    if (typeof v === 'function') v = v(target, index, total);
    if (isRelativeString(v)) {
      const rel = applyRelative(prevParsed, v);
      if (rel) return rel;
    }
    return parseValue(v);
  };

  let segments;
  if (Array.isArray(spec) && !(spec.length === 2 && !isKeyframeItem(spec[0]) && !isKeyframeItem(spec[1]))) {
    // Keyframes: array objek {to|value,...} atau array skalar > 2 nilai.
    const items = spec.map((it) => (isKeyframeItem(it) ? it : { to: it }));
    const n = items.length;
    const specified = items.map((it) => (typeof it.duration === 'number' ? it.duration : null));
    const specSum = specified.reduce((a, b) => a + (b || 0), 0);
    const unspecCount = specified.filter((d) => d === null).length;
    let durs;
    if (unspecCount === 0) {
      durs = specified.slice();
    } else if (specSum > baseDuration && specSum > 0) {
      const k = baseDuration / specSum;
      durs = specified.map((d) => (d === null ? 0 : d * k));
    } else {
      const each = Math.max(0, (baseDuration - specSum) / unspecCount);
      durs = specified.map((d) => (d === null ? each : d));
    }
    // Hint untuk nilai awal: keyframe pertama.
    const firstTo = resolveTo(items[0].to ?? items[0].value, { type: 'num', n: 0, unit: '' });
    let prev = captureFrom(target, prop, firstTo);
    segments = [];
    let cursor = 0;
    items.forEach((it, idx) => {
      const ease = resolveEase(it.ease ?? baseEase);
      let dur = durs[idx];
      if (ease.isSpring) dur = ease.springDuration;
      const toRaw = it.to ?? it.value;
      let to = resolveTo(toRaw, prev);
      [prev, to] = unifyPair(prev, to);
      const start = cursor + (typeof it.delay === 'number' ? it.delay : 0);
      segments.push({ start, dur, from: prev, to, ease });
      cursor = start + dur;
      prev = to;
    });
  } else {
    // Nilai tunggal atau [from, to].
    let from;
    let to;
    if (Array.isArray(spec)) {
      to = resolveTo(spec[1], parseValue(spec[0]));
      [from, to] = unifyPair(parseValue(spec[0]), to);
    } else {
      const hint = isRelativeString(spec) ? null : parseValue(typeof spec === 'function' ? 0 : spec);
      from = captureFrom(target, prop, hint);
      to = resolveTo(spec, from);
      [from, to] = unifyPair(from, to);
    }
    const ease = resolveEase(baseEase);
    const dur = ease.isSpring ? ease.springDuration : baseDuration;
    segments = [{ start: 0, dur, from, to, ease }];
  }

  const last = segments[segments.length - 1];
  return {
    target,
    prop,
    segments,
    length: last ? last.start + last.dur : 0,
    delay: 0,
    apply: makeApplier(target, prop),
  };
}

function renderTrack(track, local) {
  const segs = track.segments;
  if (!segs.length) return;
  let seg = segs[segs.length - 1];
  for (const s of segs) {
    if (local <= s.start + s.dur) {
      seg = s;
      break;
    }
  }
  let p;
  if (seg.dur <= 0) p = local >= seg.start ? 1 : 0;
  else if (local <= seg.start) p = 0;
  else p = Math.min(1, (local - seg.start) / seg.dur);
  track.apply(interp(seg.from, seg.to, seg.ease(p)));
}

/* ============================== Ticker global ============================== */

const activePlayables = new Set();
let frameScheduled = false;

function nowMs() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function scheduleFrame() {
  if (frameScheduled) return;
  frameScheduled = true;
  if (typeof globalThis.requestAnimationFrame === 'function') {
    globalThis.requestAnimationFrame(tick);
  } else {
    setTimeout(() => tick(nowMs()), 16);
  }
}

function tick(t) {
  frameScheduled = false;
  const ts = typeof t === 'number' ? t : nowMs();
  for (const p of Array.from(activePlayables)) p._advance(ts);
  if (activePlayables.size) scheduleFrame();
}

function activate(p) {
  activePlayables.add(p);
  scheduleFrame();
}

function deactivate(p) {
  activePlayables.delete(p);
}

/* ============================== Playable (basis Animation & Timeline) ============================== */

class Playable {
  constructor(opts = {}) {
    this._loopOpt = opts.loop ?? false;
    this._alternate = !!opts.alternate;
    this._dir = opts.reversed ? -1 : 1;
    this._cb = {
      begin: opts.onBegin,
      update: opts.onUpdate,
      loop: opts.onLoop,
      complete: opts.onComplete,
    };
    this._playhead = 0;
    this._playing = false;
    this._lastT = null;
    this._begun = false;
    this._lastIteration = 0;
    this.completed = false;
    this._cancelled = false;
    this.currentTime = 0;
    this.progress = 0;
    this._newFinished();
  }

  _newFinished() {
    this.finished = new Promise((res, rej) => {
      this._resolveFinished = res;
      this._rejectFinished = rej;
    });
    // Cegah unhandled rejection bila konsumen tidak memasang handler.
    this.finished.catch(() => {});
  }

  get iterations() {
    const l = this._loopOpt;
    if (l === true) return Infinity;
    if (l === false || l == null) return 1;
    return Math.max(1, Math.floor(l) || 1);
  }

  get totalDuration() {
    return this._span();
  }

  _span() {
    const it = this.iterations;
    return it === Infinity ? Infinity : this._iterTotal() * it;
  }

  _iterTotal() {
    return 0;
  }

  _renderAt(_t, _iteration) {}

  _restoreOriginals() {}

  _startBound() {
    const s = this._span();
    return Number.isFinite(s) ? s : this._iterTotal();
  }

  _renderPlayhead() {
    const iterTotal = this._iterTotal();
    const span = this._span();
    const P = this._playhead;
    let iteration = 0;
    let tIn = 0;
    if (iterTotal > 0) {
      if (Number.isFinite(span) && P >= span) {
        iteration = this.iterations - 1;
        tIn = iterTotal;
      } else {
        iteration = Math.floor(P / iterTotal);
        tIn = P - iteration * iterTotal;
      }
    } else {
      tIn = P;
    }
    let rendered = tIn;
    if (this._alternate && iteration % 2 === 1) rendered = iterTotal - tIn;
    this.currentTime = rendered;
    this.progress = iterTotal > 0 ? rendered / iterTotal : 1;
    this._lastIteration = iteration;
    this._renderAt(rendered, iteration);
  }

  _finish() {
    this._playing = false;
    deactivate(this);
    this.completed = true;
    if (this._cb.complete) this._cb.complete(this);
    this._resolveFinished(this);
  }

  _advance(t) {
    if (!this._playing) return;
    if (this._lastT == null) {
      this._lastT = t;
      if (!this._begun) {
        this._begun = true;
        if (this._cb.begin) this._cb.begin(this);
      }
      this._renderPlayhead();
      if (this._cb.update) this._cb.update(this);
      return;
    }
    const dt = t - this._lastT;
    this._lastT = t;
    if (dt <= 0) return;
    this._playhead += dt * this._dir;
    const span = this._span();
    const iterTotal = this._iterTotal();
    if (this._dir === 1) {
      if (Number.isFinite(span) && this._playhead >= span) {
        this._playhead = span;
        this._renderPlayhead();
        if (this._cb.update) this._cb.update(this);
        this._finish();
        return;
      }
      if (!Number.isFinite(span) && iterTotal > 0 && this._playhead >= iterTotal) {
        this._playhead %= iterTotal;
        if (this._cb.loop) this._cb.loop(this);
      }
    } else {
      if (this._playhead <= 0) {
        if (Number.isFinite(span)) {
          this._playhead = 0;
          this._renderPlayhead();
          if (this._cb.update) this._cb.update(this);
          this._finish();
          return;
        }
        if (iterTotal > 0) {
          this._playhead += iterTotal * Math.max(1, Math.ceil(-this._playhead / iterTotal));
          if (this._cb.loop) this._cb.loop(this);
        }
      }
    }
    const it = iterTotal > 0 ? Math.floor(this._playhead / iterTotal) : 0;
    if (it !== this._lastIteration && this._begun && this._cb.loop) this._cb.loop(this);
    this._renderPlayhead();
    if (this._cb.update) this._cb.update(this);
  }

  play() {
    if (this._cancelled || this.completed) {
      this._playhead = this._dir === 1 ? 0 : this._startBound();
      this.completed = false;
      this._cancelled = false;
      this._begun = false;
      this._newFinished();
    } else if (this._dir === -1 && !this._begun && this._playhead === 0) {
      this._playhead = this._startBound();
    }
    if (!this._playing) {
      this._playing = true;
      this._lastT = null;
      activate(this);
    }
    return this;
  }

  pause() {
    this._playing = false;
    deactivate(this);
    return this;
  }

  seek(ms) {
    let t = Math.max(0, +ms || 0);
    const s = this._span();
    if (Number.isFinite(s)) t = Math.min(t, s);
    this._playhead = t;
    this._renderPlayhead();
    if (this._cb.update) this._cb.update(this);
    return this;
  }

  restart() {
    this._playhead = this._dir === 1 ? 0 : this._startBound();
    this.completed = false;
    this._cancelled = false;
    this._begun = false;
    this._newFinished();
    this._renderPlayhead();
    return this.play();
  }

  reverse() {
    this._dir *= -1;
    if (this.completed || this._cancelled) {
      this.completed = false;
      this._cancelled = false;
      this._begun = true;
      this._newFinished();
    }
    if (!this._playing) {
      this._playing = true;
      this._lastT = null;
      activate(this);
    }
    return this;
  }

  cancel() {
    this._playing = false;
    deactivate(this);
    if (!this.completed) {
      this._cancelled = true;
      this._rejectFinished(new Error('Animation cancelled'));
    }
    return this;
  }

  revert() {
    this._playing = false;
    deactivate(this);
    if (!this.completed) {
      this._cancelled = true;
      this._rejectFinished(new Error('Animation cancelled'));
    }
    this._restoreOriginals();
    return this;
  }
}

/* ============================== Animation ============================== */

class Animation extends Playable {
  constructor(targets, params = {}) {
    super(params);
    this.targets = resolveTargets(targets);
    this._tracks = [];
    this._originals = [];
    const baseDuration = params.duration ?? 1000;
    const baseEase = params.ease ?? params.easing;
    const endDelay = params.endDelay ?? 0;
    const total = this.targets.length;
    const seenTransform = new Set();
    let maxDelay = 0;
    let maxTrack = 0;

    this.targets.forEach((target, i) => {
      let delay = params.delay ?? 0;
      if (typeof delay === 'function') delay = delay(target, i, total);
      delay = +delay || 0;
      if (delay > maxDelay) maxDelay = delay;
      for (const key of Object.keys(params)) {
        if (RESERVED.has(key)) continue;
        const restorer = makeRestorer(target, key, seenTransform);
        if (restorer) this._originals.push(restorer);
        const track = buildTrack(target, i, total, key, params[key], baseDuration, baseEase);
        track.delay = delay;
        this._tracks.push(track);
        if (track.length > maxTrack) maxTrack = track.length;
      }
    });

    this.duration = this._tracks.length ? maxTrack : baseDuration;
    this._maxDelay = maxDelay;
    this._iterDur = maxDelay + maxTrack + endDelay;
    if (params.reversed) this._playhead = this._startBound();
    this._renderPlayhead();
    if (params.autoplay !== false) this.play();
  }

  _iterTotal() {
    return this._iterDur;
  }

  _renderAt(t) {
    for (const tr of this._tracks) renderTrack(tr, t - tr.delay);
  }

  _restoreOriginals() {
    for (const restore of this._originals) restore();
  }
}

export function animate(targets, params = {}) {
  return new Animation(targets, params);
}

/* ============================== Timeline ============================== */

const TIMELINE_DEFAULT_KEYS = ['duration', 'delay', 'endDelay', 'ease', 'easing'];

class Timeline extends Playable {
  constructor(params = {}) {
    super(params);
    this._defaults = {};
    for (const k of TIMELINE_DEFAULT_KEYS) if (k in params) this._defaults[k] = params[k];
    this.children = [];
    this._labels = new Map();
    this._lastChild = null;
    this.duration = 0;
    if (params.autoplay !== false) this.play();
  }

  _iterTotal() {
    return this.duration;
  }

  _renderAt(t) {
    for (const ch of this.children) {
      const local = t - ch.offset;
      if (ch.anim._isSet && local < 0) continue; // set() belum waktunya: jangan timpa nilai
      ch.anim._renderAt(local, 0);
    }
  }

  _restoreOriginals() {
    for (const ch of this.children) ch.anim.revert();
  }

  _resolvePosition(position) {
    const lastEnd = this._lastChild ? this._lastChild.offset + this._lastChild.span : 0;
    if (position == null) return Math.max(0, lastEnd);
    if (typeof position === 'number') return Math.max(0, position);
    if (position === '<') return this._lastChild ? this._lastChild.offset : 0;
    if (typeof position === 'string') {
      const m = position.match(/^([+-])=\s*(\d*\.?\d+)$/);
      if (m) return Math.max(0, lastEnd + (m[1] === '-' ? -1 : 1) * parseFloat(m[2]));
      if (this._labels.has(position)) return this._labels.get(position);
      return Math.max(0, lastEnd);
    }
    return Math.max(0, lastEnd);
  }

  _addChild(anim, position) {
    const offset = this._resolvePosition(position);
    const span = anim._span();
    // Konstruktor anak me-render keadaan awalnya; untuk anak berdurasi 0
    // (set()) itu berarti nilai akhir — render ulang tepat sebelum posisi
    // mulainya agar nilai baru diterapkan hanya saat timeline mencapainya.
    anim._renderAt(-1, 0);
    this.children.push({ anim, offset });
    this._lastChild = { offset, span };
    const end = offset + span;
    if (end > this.duration) this.duration = end;
    return this;
  }

  add(a, b, c) {
    // Bentuk 1: add(animasiInstance, position?)
    if (a && typeof a._renderAt === 'function' && typeof a._span === 'function') {
      return this._addChild(a, b);
    }
    // Bentuk 2: add(paramsDenganTargets, position?)
    if (a && typeof a === 'object' && !isElement(a) && !Array.isArray(a) && 'targets' in a) {
      const params = { ...this._defaults, ...a, autoplay: false };
      const targets = params.targets;
      delete params.targets;
      return this._addChild(new Animation(targets, params), b);
    }
    // Bentuk 3: add(targets, params, position?)
    const params = { ...this._defaults, ...(b || {}), autoplay: false };
    return this._addChild(new Animation(a, params), c);
  }

  set(targets, values, position) {
    const params = { ...this._defaults, ...(values || {}), duration: 0, delay: 0, autoplay: false };
    const anim = new Animation(targets, params);
    anim._isSet = true;
    return this._addChild(anim, position);
  }

  label(name, position) {
    this._labels.set(name, this._resolvePosition(position));
    return this;
  }
}

export function createTimeline(params = {}) {
  return new Timeline(params);
}
