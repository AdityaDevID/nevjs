import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
});
dom.window.scrollTo = () => {};
globalThis.window = dom.window;
globalThis.document = dom.window.document;

// rAF manual: frame hanya berjalan saat dipompa dengan timestamp terkontrol.
let rafQueue = [];
globalThis.requestAnimationFrame = (cb) => {
  rafQueue.push(cb);
  return rafQueue.length;
};
globalThis.cancelAnimationFrame = () => {};
function pump(...times) {
  for (const t of times) {
    const q = rafQueue;
    rafQueue = [];
    for (const cb of q) cb(t);
  }
}

const nevf = await import('../src/index.js');
const { animate, createTimeline, stagger, easings, cubicBezier, steps, spring } = nevf;

function el() {
  const d = document.createElement('div');
  document.body.appendChild(d);
  return d;
}

describe('animate: ekspor', () => {
  test('semua ekspor tersedia dari index', () => {
    for (const name of ['animate', 'createTimeline', 'stagger', 'easings', 'cubicBezier', 'steps', 'spring'])
      assert.equal(typeof nevf[name], name === 'easings' ? 'object' : 'function', name);
  });
});

describe('animate: objek polos via seek', () => {
  test('tween angka: awal/tengah/akhir eksak + progress', () => {
    const o = { x: 0 };
    const a = animate(o, { x: 100, duration: 1000, ease: 'linear', autoplay: false });
    a.seek(0);
    assert.equal(o.x, 0);
    a.seek(500);
    assert.equal(o.x, 50);
    assert.equal(a.progress, 0.5);
    assert.equal(a.currentTime, 500);
    a.seek(1000);
    assert.equal(o.x, 100);
    assert.equal(a.duration, 1000);
    assert.equal(a.totalDuration, 1000);
  });

  test('string satuan: nilai awal angka & properti kosong', () => {
    const o = { w: 0 };
    const a = animate(o, { w: '100px', duration: 1000, ease: 'linear', autoplay: false });
    a.seek(500);
    assert.equal(o.w, '50px');
    const o2 = {};
    const a2 = animate(o2, { v: '100%', duration: 1000, ease: 'linear', autoplay: false });
    a2.seek(250);
    assert.equal(o2.v, '25%');
  });

  test('interpolasi warna per kanal (titik tengah)', () => {
    const o = { c: '#000000' };
    const a = animate(o, { c: '#ffffff', duration: 1000, ease: 'linear', autoplay: false });
    a.seek(500);
    assert.equal(o.c, 'rgb(128, 128, 128)');
    a.seek(1000);
    assert.equal(o.c, 'rgb(255, 255, 255)');
    const o2 = { c: 'rgb(255, 0, 0)' };
    const a2 = animate(o2, { c: 'rgba(0, 0, 255, 0)', duration: 1000, ease: 'linear', autoplay: false });
    a2.seek(500);
    assert.equal(o2.c, 'rgba(128, 0, 128, 0.5)');
  });

  test('[from, to] mengabaikan nilai awal target', () => {
    const o = { x: 999 };
    const a = animate(o, { x: [10, 20], duration: 1000, ease: 'linear', autoplay: false });
    a.seek(0);
    assert.equal(o.x, 10);
    a.seek(500);
    assert.equal(o.x, 15);
    a.seek(1000);
    assert.equal(o.x, 20);
  });

  test("nilai relatif '+=', '-=', '*='", () => {
    const o1 = { x: 10 };
    animate(o1, { x: '+=30', duration: 100, ease: 'linear', autoplay: false }).seek(100);
    assert.equal(o1.x, 40);
    const o2 = { x: 10 };
    animate(o2, { x: '-=5', duration: 100, ease: 'linear', autoplay: false }).seek(100);
    assert.equal(o2.x, 5);
    const o3 = { x: 10 };
    animate(o3, { x: '*=3', duration: 100, ease: 'linear', autoplay: false }).seek(100);
    assert.equal(o3.x, 30);
  });

  test('nilai fungsi per indeks target', () => {
    const o1 = { x: 0 };
    const o2 = { x: 0 };
    const a = animate([o1, o2], {
      x: (target, i) => (i + 1) * 100,
      duration: 100,
      ease: 'linear',
      autoplay: false,
    });
    a.seek(100);
    assert.equal(o1.x, 100);
    assert.equal(o2.x, 200);
  });
});

describe('animate: keyframes', () => {
  test('durasi eksplisit per keyframe', () => {
    const o = { x: 0 };
    const a = animate(o, {
      x: [
        { to: 100, duration: 400 },
        { to: 0, duration: 600 },
      ],
      duration: 1000,
      ease: 'linear',
      autoplay: false,
    });
    a.seek(200);
    assert.equal(o.x, 50);
    a.seek(400);
    assert.equal(o.x, 100);
    a.seek(700);
    assert.equal(o.x, 50);
    a.seek(1000);
    assert.equal(o.x, 0);
  });

  test('tanpa durasi: dinormalisasi ke durasi animasi', () => {
    const o = { x: 0 };
    const a = animate(o, {
      x: [{ value: 60 }, { to: 100 }],
      duration: 1000,
      ease: 'linear',
      autoplay: false,
    });
    a.seek(250);
    assert.equal(o.x, 30);
    a.seek(500);
    assert.equal(o.x, 60);
    a.seek(750);
    assert.equal(o.x, 80);
  });
});

describe('stagger', () => {
  test('fungsi stagger: first/last/center & rentang', () => {
    const s = stagger(100);
    assert.equal(s(null, 0, 3), 0);
    assert.equal(s(null, 1, 3), 100);
    assert.equal(s(null, 2, 3), 200);
    const last = stagger(100, { from: 'last' });
    assert.equal(last(null, 0, 3), 200);
    assert.equal(last(null, 2, 3), 0);
    const center = stagger(100, { from: 'center' });
    assert.equal(center(null, 0, 3), 100);
    assert.equal(center(null, 1, 3), 0);
    assert.equal(center(null, 2, 3), 100);
    const range = stagger([0, 300]);
    assert.equal(range(null, 0, 3), 0);
    assert.equal(range(null, 1, 3), 150);
    assert.equal(range(null, 2, 3), 300);
    const started = stagger(50, { start: 20 });
    assert.equal(started(null, 1, 3), 70);
  });

  test('stagger grid & axis', () => {
    const g = stagger(10, { grid: [2, 2] });
    assert.equal(g(null, 0, 4), 0);
    assert.equal(g(null, 1, 4), 10);
    assert.equal(g(null, 2, 4), 10);
    assert.ok(Math.abs(g(null, 3, 4) - 10 * Math.SQRT2) < 0.01);
    const gx = stagger(10, { grid: [2, 2], axis: 'x' });
    assert.equal(gx(null, 2, 4), 0);
    assert.equal(gx(null, 3, 4), 10);
  });

  test('stagger sebagai delay antar target', () => {
    const objs = [{ x: 0 }, { x: 0 }, { x: 0 }];
    const a = animate(objs, { x: 100, duration: 100, delay: stagger(100), ease: 'linear', autoplay: false });
    a.seek(150);
    assert.equal(objs[0].x, 100);
    assert.equal(objs[1].x, 50);
    assert.equal(objs[2].x, 0);
    assert.equal(a.totalDuration, 300);
  });

  test('stagger rentang sebagai nilai properti', () => {
    const objs = [{ x: 0 }, { x: 0 }, { x: 0 }];
    const a = animate(objs, { x: stagger([0, 300]), duration: 100, ease: 'linear', autoplay: false });
    a.seek(50);
    assert.deepEqual(objs.map((o) => o.x), [0, 75, 150]);
    a.seek(100);
    assert.deepEqual(objs.map((o) => o.x), [0, 150, 300]);
  });
});

describe('timeline', () => {
  test("sekuens, posisi '<', '-=n', label, dan set()", () => {
    const o1 = { x: 0 };
    const o2 = { x: 0 };
    const o3 = { x: 0 };
    const o4 = { v: 0 };
    const tl = createTimeline({ autoplay: false, ease: 'linear' });
    tl.add(o1, { x: 100, duration: 500 });
    tl.add(o2, { x: 100, duration: 500 }, '<');
    tl.add(o3, { x: 100, duration: 500 }, '-=250');
    tl.label('end', 750);
    tl.set(o4, { v: 7 }, 'end');
    assert.equal(tl.duration, 750);

    tl.seek(250);
    assert.equal(o1.x, 50);
    assert.equal(o2.x, 50);
    assert.equal(o3.x, 0);

    tl.seek(500);
    assert.equal(o1.x, 100);
    assert.equal(o3.x, 50);

    tl.seek(749);
    assert.equal(o4.v, 0);
    tl.seek(750);
    assert.equal(o4.v, 7);
  });

  test('bentuk add(params) dengan targets + defaults timeline diwarisi', () => {
    const o = { x: 0 };
    const tl = createTimeline({ autoplay: false, duration: 200, ease: 'linear' });
    tl.add({ targets: o, x: 100 });
    assert.equal(tl.duration, 200);
    tl.seek(100);
    assert.equal(o.x, 50);
    tl.seek(200);
    assert.equal(o.x, 100);
  });
});

describe('animate: loop & alternate', () => {
  test('loop 2x + alternate: keadaan di waktu terpilih', () => {
    const o = { x: 0 };
    const a = animate(o, {
      x: 100,
      duration: 1000,
      ease: 'linear',
      loop: 2,
      alternate: true,
      autoplay: false,
    });
    assert.equal(a.totalDuration, 2000);
    a.seek(500);
    assert.equal(o.x, 50);
    a.seek(1250); // iterasi 1 (mundur): posisi visual 750
    assert.equal(o.x, 75);
    assert.equal(a.progress, 0.75);
    a.seek(1750);
    assert.equal(o.x, 25);
    a.seek(2000); // akhir iterasi ganjil → kembali ke awal
    assert.equal(o.x, 0);
  });
});

describe('animate: playback via rAF (stub)', () => {
  test('play/pause/resume dengan timestamp terkontrol', () => {
    const o = { x: 0 };
    const a = animate(o, { x: 100, duration: 1000, ease: 'linear' });
    pump(0);
    assert.equal(o.x, 0);
    pump(500);
    assert.equal(o.x, 50);
    a.pause();
    pump(900);
    assert.equal(o.x, 50);
    a.play();
    pump(1000); // frame pertama setelah resume: dt = 0
    assert.equal(o.x, 50);
    pump(1250);
    assert.equal(o.x, 75);
    a.cancel();
  });

  test('onComplete terpanggil & finished resolve saat selesai alami', async () => {
    const o = { x: 0 };
    let completes = 0;
    let updates = 0;
    const a = animate(o, {
      x: 100,
      duration: 1000,
      ease: 'linear',
      onComplete: () => completes++,
      onUpdate: () => updates++,
    });
    pump(0, 1000);
    assert.equal(o.x, 100);
    assert.equal(a.completed, true);
    assert.equal(completes, 1);
    assert.ok(updates >= 1);
    await a.finished;
  });

  test('onLoop terpanggil saat iterasi berganti', () => {
    const o = { x: 0 };
    let loops = 0;
    const a = animate(o, {
      x: 100,
      duration: 100,
      ease: 'linear',
      loop: 2,
      onLoop: () => loops++,
    });
    pump(0, 150);
    assert.equal(loops, 1);
    assert.equal(o.x, 50);
    pump(250);
    assert.equal(a.completed, true);
    assert.equal(o.x, 100);
  });

  test('cancel() menolak finished', async () => {
    const a = animate({ x: 0 }, { x: 1, autoplay: false });
    const rejection = assert.rejects(a.finished, /cancelled/);
    a.cancel();
    await rejection;
  });
});

describe('animate: revert', () => {
  test('objek: nilai asli dipulihkan, properti baru dihapus', () => {
    const o = { x: 5 };
    const a = animate(o, { x: 105, y: 10, duration: 100, ease: 'linear', autoplay: false });
    a.seek(100);
    assert.equal(o.x, 105);
    assert.equal(o.y, 10);
    a.revert();
    assert.equal(o.x, 5);
    assert.equal('y' in o, false);
  });

  test('DOM: style & transform dipulihkan', () => {
    const d = el();
    d.style.opacity = '0.2';
    const a = animate(d, { opacity: 1, x: 100, duration: 1000, ease: 'linear', autoplay: false });
    a.seek(500);
    assert.equal(d.style.opacity, '0.6');
    a.revert();
    assert.equal(d.style.opacity, '0.2');
    assert.equal(d.style.transform, '');
  });
});

describe('animate: DOM', () => {
  test('komposisi transform: translate + scale + rotate', () => {
    const d = el();
    const a = animate(d, {
      x: 100,
      y: 50,
      scale: 2,
      rotate: 90,
      duration: 1000,
      ease: 'linear',
      autoplay: false,
    });
    a.seek(1000);
    assert.equal(d.style.transform, 'translate3d(100px, 50px, 0px) scale3d(2, 2, 1) rotate(90deg)');
    a.seek(500);
    assert.equal(d.style.transform, 'translate3d(50px, 25px, 0px) scale3d(1.5, 1.5, 1) rotate(45deg)');
  });

  test('CSS custom property & opacity', () => {
    const d = el();
    const a = animate(d, {
      '--size': '20px',
      opacity: 0,
      duration: 1000,
      ease: 'linear',
      autoplay: false,
    });
    a.seek(500);
    assert.equal(d.style.getPropertyValue('--size'), '10px');
    assert.equal(d.style.opacity, '0.5');
    a.seek(1000);
    assert.equal(d.style.getPropertyValue('--size'), '20px');
    assert.equal(d.style.opacity, '0');
  });

  test('target berupa selector string', () => {
    const d1 = el();
    d1.className = 'box-anim';
    const d2 = el();
    d2.className = 'box-anim';
    const a = animate('.box-anim', { opacity: 0, duration: 100, ease: 'linear', autoplay: false });
    assert.equal(a.targets.length, 2);
    a.seek(50);
    assert.equal(d1.style.opacity, '0.5');
    assert.equal(d2.style.opacity, '0.5');
  });
});

describe('easing: spring, bezier, steps', () => {
  test('spring: overshoot di tengah, settle eksak di target, durasi dari fisika', () => {
    const o = { x: 0 };
    const a = animate(o, {
      x: 100,
      ease: spring({ stiffness: 100, damping: 10, mass: 1 }),
      autoplay: false,
    });
    assert.ok(a.duration > 1000, `durasi spring ${a.duration} harus > 1000`);
    let max = -Infinity;
    for (let t = 0; t <= a.duration; t += 10) {
      a.seek(t);
      if (o.x > max) max = o.x;
    }
    assert.ok(max > 100, `harus overshoot, max=${max}`);
    a.seek(a.duration);
    assert.equal(o.x, 100);
  });

  test('cubicBezier(0,0,1,1) ≈ linear & bezier simetris', () => {
    const lin = cubicBezier(0, 0, 1, 1);
    assert.ok(Math.abs(lin(0.5) - 0.5) < 0.001);
    assert.ok(Math.abs(lin(0.25) - 0.25) < 0.001);
    assert.equal(lin(0), 0);
    assert.equal(lin(1), 1);
    const sym = cubicBezier(0.42, 0, 0.58, 1);
    assert.ok(Math.abs(sym(0.5) - 0.5) < 0.001);
  });

  test('steps(): kuantisasi easing & via animate', () => {
    const s4 = steps(4);
    assert.equal(s4(0), 0);
    assert.equal(s4(0.26), 0.25);
    assert.equal(s4(0.99), 0.75);
    assert.equal(s4(1), 1);
    const o = { x: 0 };
    const a = animate(o, { x: 100, duration: 1000, ease: steps(4), autoplay: false });
    a.seek(260);
    assert.equal(o.x, 25);
    a.seek(999);
    assert.equal(o.x, 75);
  });

  test('easings bawaan: titik ujung & nilai acuan', () => {
    assert.equal(easings.easeInQuad(0.5), 0.25);
    assert.equal(easings.easeOutQuad(0.5), 0.75);
    assert.ok(Math.abs(easings.easeInOutSine(0.5) - 0.5) < 1e-9);
    assert.ok(Math.abs(easings.easeOutBounce(1) - 1) < 1e-9);
    assert.equal(easings.easeOutElastic(0), 0);
    assert.equal(easings.easeOutElastic(1), 1);
    assert.equal(easings.easeInExpo(0), 0);
    assert.equal(easings.easeOutExpo(1), 1);
    for (const [name, fn] of Object.entries(easings)) {
      assert.ok(Math.abs(fn(0)) < 1e-9, `${name}(0)`);
      assert.ok(Math.abs(fn(1) - 1) < 1e-9, `${name}(1)`);
    }
  });
});

describe('animate: keamanan SSR', () => {
  test('import animate.js di Node murni (tanpa window/document) tidak throw & bisa seek', () => {
    const url = new URL('../src/animate.js', import.meta.url).href;
    const script = `
      if (typeof window !== 'undefined' || typeof document !== 'undefined') throw new Error('env bocor');
      const m = await import(${JSON.stringify(url)});
      const o = { x: 0 };
      const a = m.animate(o, { x: 10, duration: 100, ease: 'linear', autoplay: false });
      a.seek(50);
      if (o.x !== 5) throw new Error('nilai salah: ' + o.x);
      const b = m.animate('.tidak-ada', { x: 1, autoplay: false });
      if (b.targets.length !== 0) throw new Error('selector harus kosong di server');
      console.log('ssr-ok');
    `;
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
    assert.ok(out.includes('ssr-ok'));
  });
});
