# Nev.js

[![CI](https://github.com/AdityaDevID/nevjs/actions/workflows/ci.yml/badge.svg)](https://github.com/AdityaDevID/nevjs/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](https://nodejs.org)

Keluarga framework JavaScript **tanpa build step** — tulis file, jalankan, selesai.
Satu monorepo, lima paket yang bisa dipakai sendiri-sendiri atau bersama: UI reaktif, backend HTTP,
game 2D, game 3D, dan framework fullstack — plus **mesin animasi premium setara Anime.js** di NevF (baru di 0.7).

| Paket | Versi | Fungsi | Mirip dengan |
| --- | --- | --- | --- |
| **`@adityadevid/nevf`** (NevF.js) | 0.5.0 | UI reaktif: signals, komponen, SSR, router, **animasi** | Solid / Preact / Anime.js |
| **`@adityadevid/nevb`** (NevB.js) | 0.4.0 | Backend HTTP: router, middleware, validasi, static, SSE | Hono / Express |
| **`@adityadevid/nevg`** (NevG.js) | 0.3.0 | Game 2D: loop, scene, entity, collision, tween, tilemap, input | Phaser mini |
| **`@adityadevid/nevgthree`** (NevGThree) | 0.2.0 | Game 3D di atas three.js: scene, entity, fisika, kamera, kontrol sentuh, terrain | Phaser 3D mini |
| **`@adityadevid/nevjs`** (Nev.js) | 0.7.0 | Fullstack: routing berbasis file, SSR, loader, API routes, CLI | Next.js mini |

Semuanya ES module murni, nol dependensi (kecuali saling memakai), Node ≥ 20.

> Status: **pra-1.0 (0.7.x)** — API masih bisa berubah. Paket npm: `@adityadevid/nevf`, `@adityadevid/nevb`, `@adityadevid/nevg`, dan **`@adityadevid/nevjs`** (fullstack; perintah CLI-nya tetap `nev`).
> Pasang dari npm: `npx @adityadevid/nevjs create situs-saya` (template: `default`, `api`, `game`, `game3d`). Lihat [CHANGELOG](CHANGELOG.md).

## Daftar isi

- [Mulai cepat](#mulai-cepat)
- [Nev.js — fullstack](#nevjs--fullstack)
- [NevF.js — frontend](#nevfjs--frontend)
- [Animasi — mesin animasi NevF](#animasi--mesin-animasi-nevf)
- [NevB.js — backend](#nevbjs--backend)
- [NevG.js — game 2D](#nevgjs--game-2d)
- [NevGThree — game 3D](#nevgthree--game-3d)
- [Riwayat fitur per versi](#riwayat-fitur-per-versi)
- [Batasan yang perlu kamu tahu](#batasan-yang-perlu-kamu-tahu)
- [Pengujian](#pengujian)
- [Kredit](#kredit)
- [Lisensi](#lisensi)

## Mulai cepat

```bash
git clone https://github.com/AdityaDevID/nevjs.git
cd nevjs
npm install
npm test                    # 422 tes untuk kelima paket

# bikin proyek fullstack baru
node packages/nev/bin/nev.js create ../situs-saya
cd ../situs-saya
npm install                 # lihat catatan di bawah bila paket belum ada di npm
npm run dev                 # http://localhost:3000
```

Atau pakai satu paket saja:

```bash
npm install @adityadevid/nevf     # UI reaktif + animasi
npm install @adityadevid/nevb     # backend HTTP
npm install @adityadevid/nevg     # game 2D (nevgthree untuk 3D, butuh three)
```

---

## Nev.js — fullstack

```
situs-saya/
├─ pages/
│  ├─ _layout.js            ← membungkus semua halaman (props.children)
│  ├─ index.js              → /
│  ├─ about.js              → /about
│  ├─ blog/index.js         → /blog
│  ├─ blog/index.server.js  ← export load(c): jalan HANYA di server
│  ├─ blog/[slug].js        → /blog/:slug      (props.params.slug)
│  ├─ docs/[...path].js     → /docs/*path      (catch-all)
│  └─ _404.js, _error.js    ← halaman 404 / error kustom (opsional)
├─ api/
│  └─ guestbook.js          → /api/guestbook   (export get, post, put, patch, del, middleware)
├─ public/                  ← file statis, dilayani dari /
├─ components/, lib/, shared/   ← modul yang boleh di-import browser
├─ lib/*.server.js          ← kode khusus server (database, secret) — TIDAK pernah dikirim ke browser
└─ nev.config.js
```

**Halaman** — export default sebuah komponen; `head` opsional:

```js
// pages/blog/[slug].js
import { h, Link } from '@adityadevid/nevf';

export const head = ({ data }) => ({ title: data.post.title, meta: [{ name: 'description', content: data.post.summary }] });

export default function Post({ data, params, query, url }) {
  return h('article', null, h('h1', null, data.post.title), h(Link, { href: '/blog' }, '← Kembali'));
}
```

**Loader** — file `*.server.js` di samping halaman. Dijalankan di server untuk load pertama *dan* untuk navigasi client-side (browser meminta hasilnya sebagai JSON):

```js
// pages/blog/[slug].server.js
import { HttpError, redirect } from '@adityadevid/nevjs';
import { findPost } from '../../lib/posts.server.js';

export function load(c) {                       // c = Context NevB (c.params, c.query, c.cookies, c.setCookie, ...)
  const post = findPost(c.params.slug);
  if (!post) throw new HttpError(404);          // → halaman 404 dengan status 404 asli
  // return redirect('/login')                  // → redirect (juga bekerja pada navigasi client-side)
  return { post };                              // harus bisa di-JSON-kan
}
```

**API routes** — fungsi, atau array `[middleware..., handler]`:

```js
// api/guestbook.js
import { v, validate, rateLimit } from '@adityadevid/nevjs';

export const middleware = [rateLimit({ windowMs: 60_000, max: 60 })];
export const get  = () => ({ entries: [] });                       // object → JSON
export const post = [
  validate({ body: v.object({ name: v.string({ min: 1, max: 40 }) }) }),   // gagal → 422 + details
  (c) => c.json({ ok: true, name: c.valid.body.name }, 201),
];
```

**`nev.config.js`**

```js
import { defineConfig, cors } from '@adityadevid/nevjs';
export default defineConfig({
  title: 'Situs Saya', titleTemplate: '%s · Situs Saya', lang: 'id',
  head: { meta: [], links: [{ rel: 'stylesheet', href: '/style.css' }], scripts: [] },
  clientDirs: ['pages', 'components', 'lib', 'shared'],   // folder yang boleh diunduh browser
  browserPackages: ['@adityadevid/nevg'],                              // paket tambahan yang bisa di-import di browser
  setup(app) { app.use(cors({ origin: ['https://contoh.com'] })); },   // middleware/route sendiri (jalan duluan)
});
```

**CLI**

```
nev create <folder> [--template default|api|game|game3d]   proyek baru dari template
nev dev [folder] [--port N]    restart otomatis + live reload browser saat file berubah
nev start [folder] [--port N]  mode produksi (PORT env juga dibaca)
nev routes [folder]            tampilkan semua route
nev info [folder]              ringkasan proyek (versi, route, .env, config) untuk laporan bug
nev export [folder] [--out D] [--target netlify|cloudflare]  HTML statis (+ _redirects/_headers bila --target)
nev build [folder] --target vercel|netlify                    build untuk Vercel / Netlify
nev check [folder]             validasi proyek: config, route, dan kesalahan keamanan umum (exit 1 bila error)
```

**Cara kerjanya.** Server me-render halaman ke HTML (SSR), menyisipkan import map + data JSON, lalu `client.js`
mengambil alih: link `Link` berpindah halaman tanpa reload (mengambil data loader via `/__nev/data`), tombol back/forward
bekerja, `<title>` ikut berubah. Tidak ada bundler — browser meng-import modul `pages/…` langsung.

**Aturan keamanan yang diterapkan** (semuanya ada tesnya)

- `*.server.js`, `api/`, `nev.config.js`, `package.json`, dotfile → **ditolak** bila diminta browser; hanya folder di `clientDirs` yang dilayani.
- Path traversal (`..`, `%2e%2e`) dan symlink keluar folder ditolak.
- Data loader disisipkan ke HTML dengan escape (`</script>` tidak bisa menutup tag).
- Error tak terduga di produksi hanya menampilkan "Internal Server Error"; detail/stack hanya di mode dev.
- `/__nev/data` menolak path absolut / `//host` (bukan open proxy / SSRF) dan mewajibkan header `x-nev-data: 1`.
- `session` (cookie bertanda tangan / store server), `jwtAuth`, `csrf`, `hashPassword` (PBKDF2), `compress`, `basicAuth`, `keyAuth` tersedia dari `@adityadevid/nevjs`.
- Header aman default (`nosniff`, `X-Frame-Options`, `Referrer-Policy`, …). Tambah CSP/HSTS lewat `secureHeaders({...})` di `setup`.

Detail lengkap Nev.js ada di [packages/nev](packages/nev/README.md).

---

## NevF.js — frontend

Komponen dijalankan **sekali**; yang berubah hanyalah fungsi/signal yang kamu pasang di tempatnya.

```js
import { h, signal, computed, effect, render, Show, For } from '@adityadevid/nevf';

function Todo() {
  const items = signal([]);
  const text = signal('');
  const left = computed(() => items().filter((t) => !t.done).length);
  const add = () => { items.update((l) => [...l, { text: text(), done: false }]); text.set(''); };

  return h('div', null,
    h('input', { value: text, onInput: (e) => text.set(e.target.value) }),
    h('button', { onClick: add }, 'Tambah'),
    h('p', null, () => `${left()} tersisa`),
    h(For, { each: items }, (t) => h('li', null, t.text)),
  );
}
render(h(Todo), document.body);
```

| API | Keterangan |
| --- | --- |
| `signal(v)` · `.set` `.update` `.peek` | nilai reaktif |
| `computed(fn)` · `memo(fn, eq)` | turunan (lazy) · turunan dengan pemotongan kesamaan |
| `createSelector(source, eq?)` | pemilih per-kunci: observer hanya jalan ulang bila kunci miliknya mulai/berhenti cocok |
| `effect(fn)` · `batch` · `untrack` | efek samping, gabung update, baca tanpa berlangganan |
| `onMount` · `onCleanup` · `createRoot` | siklus hidup (onMount tidak jalan di server) |
| `resource(fetcher)` | `{ data, loading, error, refetch }` |
| `h(type, props, ...children)` · `Fragment` | node; tipe = tag atau komponen. JSX: `jsxImportSource: "@adityadevid/nevf"` (perlu transpiler sendiri) |
| `Show` · `For` · `Switch/Match` · `ErrorBoundary` | alur kontrol; `For` mencocokkan item per identitas |
| `renderToString(vnode)` | SSR sinkron |
| `Router` · `Link` · `navigate` · `location` · `useQuery` | router SPA (`:param`, `*wildcard`) |
| `animate` · `createTimeline` · `stagger` · `easings` · `cubicBezier` · `steps` · `spring` | mesin animasi — lihat [bagian Animasi](#animasi--mesin-animasi-nevf) |

Prop: `class` (string/array/object), `style` (object), `onClick` dst., `value`/`checked` dua arah lewat signal, `ref`, `innerHTML`.
Nilai fungsi/signal pada prop atau anak otomatis reaktif.

---

## Animasi — mesin animasi NevF

Baru di NevF 0.5 / Nev 0.7: mesin animasi lengkap setara **Anime.js** — tanpa dependensi, tanpa build step,
jalan di browser maupun objek polos (dan aman di-import di server untuk SSR). Semua diekspor dari `@adityadevid/nevf`:
`animate`, `createTimeline`, `stagger`, `easings`, `cubicBezier`, `steps`, `spring`.

### Dasar

```js
import { animate } from '@adityadevid/nevf';

animate('.kotak', {
  x: 250,                 // transform: translateX (px)
  rotate: '1turn',        // satuan bebas: px, %, deg, turn, em, rem, …
  opacity: 0.5,
  backgroundColor: '#6ee7b7',   // warna diinterpolasi per kanal (hex/rgb/rgba)
  duration: 1200,
  ease: 'easeOutExpo',
});
```

Target bisa berupa elemen, selector CSS, array/NodeList, atau **objek polos** (propertinya di-tween sebagai angka —
cocok untuk state game, canvas, atau angka di UI):

```js
const skor = { nilai: 0 };
animate(skor, { nilai: 1000, duration: 2000, ease: 'easeOutQuart',
  onUpdate: () => { el.textContent = Math.round(skor.nilai); } });
```

### Nilai: from/to, relatif, fungsi, keyframes

```js
animate(el, {
  x: [0, 200],                       // [dari, ke]
  y: '+=40',                         // relatif: +=, -=, *=
  scale: (el, i) => 1 + i * 0.1,     // fungsi per target: (el, index, total)
  opacity: [                       // keyframes: tiap tahap boleh punya duration/ease sendiri
    { to: 1, duration: 300 },
    { to: 0.2, duration: 200 },
    { to: 1, duration: 500, ease: 'easeOutBack' },
  ],
});
```

Properti transform — `x y z translateX translateY translateZ scale scaleX scaleY scaleZ rotate rotateX rotateY rotateZ skewX skewY perspective` —
dikomposisi otomatis menjadi satu string `transform`. Properti CSS lain ditulis ke `style`, dan custom property (`--nama`) lewat `setProperty`.

### Parameter

| Parameter | Default | Keterangan |
| --- | --- | --- |
| `duration` | `1000` | durasi satu iterasi (ms) |
| `delay` | `0` | angka, fungsi `(el, i)`, atau hasil `stagger()` |
| `endDelay` | `0` | jeda setelah iterasi sebelum loop berikutnya |
| `ease` / `easing` | `easeOutQuad` | nama easing, fungsi, array bezier, atau hasil `cubicBezier()` / `steps()` / `spring()` |
| `loop` | `false` | `true` = selamanya, atau angka jumlah iterasi |
| `alternate` | `false` | arah bergantian tiap iterasi |
| `reversed` | `false` | mulai dari arah terbalik |
| `autoplay` | `true` | `false` = kendalikan manual lewat `play()` / `seek()` |
| `onBegin` `onUpdate` `onLoop` `onComplete` | — | callback, menerima instance animasi |

### Kontrol playback

```js
const anim = animate('.kartu', { y: [40, 0], opacity: [0, 1], autoplay: false });
anim.play();  anim.pause();  anim.seek(450);  anim.restart();  anim.reverse();
anim.cancel();               // berhenti di tempat; promise `finished` ditolak
anim.revert();               // kembalikan semua properti ke nilai awal
await anim.finished;         // resolve saat selesai alami
anim.progress;               // 0..1 iterasi berjalan · anim.currentTime · anim.duration · anim.totalDuration
```

### Easing

30+ easing bawaan (objek `easings`): `linear`, dan keluarga `Quad Cubic Quart Quint Sine Expo Circ Back Bounce Elastic`
masing-masing dalam varian `easeIn…`, `easeOut…`, `easeInOut…` — contoh: `easeOutExpo`, `easeInOutQuart`, `easeOutBack`, `easeOutBounce`, `easeOutElastic`.

```js
import { cubicBezier, steps, spring } from '@adityadevid/nevf';

animate(el, { x: 100, ease: cubicBezier(0.25, 0.1, 0.25, 1) });  // kurva CSS cubic-bezier
animate(el, { x: 100, ease: steps(12) });                          // gerak bertahap (sprite/clock)
animate(el, { x: 100, ease: spring({ stiffness: 120, damping: 12, mass: 1 }) });
```

**`spring()`** adalah fisika pegas sungguhan (simulasi Euler semi-implisit), bukan kurva: nilai melampaui target
lalu menetap (*overshoot & settle*), dan durasi efektif animasi mengikuti waktu menetapnya pegas.

### Stagger

```js
import { stagger } from '@adityadevid/nevf';

animate('.item', {
  y: [24, 0], opacity: [0, 1],
  delay: stagger(60),                                   // 0, 60, 120, …
});
// opsi: { from: 'first'|'last'|'center'|indeks|'random', start, ease, grid: [baris, kolom], axis: 'x'|'y' }
// rentang nilai juga bisa: delay: stagger([0, 300]) — tersebar merata dari 0 s.d. 300
```

### Timeline

```js
import { createTimeline } from '@adityadevid/nevf';

const tl = createTimeline({ defaults: { ease: 'easeOutQuad', duration: 600 } });
tl.add('.judul', { y: [30, 0], opacity: [0, 1] })
  .add('.kartu', { scale: [0.9, 1], opacity: [0, 1] }, '-=250')   // mulai 250ms sebelum anak sebelumnya selesai
  .label('aksi')
  .add('.tombol', { scale: [0, 1], ease: 'easeOutBack' }, 'aksi') // pada label
  .set('.badge', { opacity: 1 });                                 // set nilai seketika di posisi ini
tl.play();
```

Posisi anak: angka (ms absolut), nama label, `'<'` (bersamaan dengan awal anak sebelumnya), `'+=n'` / `'-=n'`
(relatif dari akhir anak sebelumnya), atau kosong (lanjutan). Timeline mendukung kontrol yang sama seperti animasi
(`play/pause/seek/restart/reverse/cancel/revert/finished`), plus `loop` dan `alternate`.

---

## NevB.js — backend

```js
import { App, logger, cors, validate, v, serveStatic, abort } from '@adityadevid/nevb';

const app = new App();
app.use(logger(), cors());
app.get('/users/:id', (c) => ({ id: c.params.id, q: c.query }));
app.post('/users', validate({ body: v.object({ name: v.string({ min: 2 }) }) }), (c) => c.json(c.valid.body, 201));
app.get('/stream', (c) => c.sse(async ({ send }) => { send({ hello: 1 }); }));
app.use(serveStatic({ root: 'public' }));
await app.listen(3000);
```

- Handler `(c, next)`; return `Response` / object (→ JSON) / string / `undefined` (→ 204). Middleware boleh `await next()` untuk memproses respons.
- `app.fetch(request)` berstandar Web — bisa dipasang di runtime lain; `app.request('/path')` untuk tes.
- `c`: `params query cookies body() json() text() html() redirect() header() setCookie() sse() ip state valid`.
- Bawaan: `logger cors rateLimit secureHeaders serveStatic keyAuth` (ETag, Range, anti-traversal), `HttpError/abort`, batas ukuran body (413, termasuk body streaming), cookie aman.
- Auth & sesi: `session` `MemoryStore` `jwtAuth` `signJWT/verifyJWT` `hashPassword/verifyPassword` `compress` `csrf` `requestId` `basicAuth` `bearerAuth` `keyAuth` `timeout` `cacheControl` `etag` `health`.
- Validasi `v`: `string number boolean object array union literal record tuple date url uuid` + `.nullable() .refine() .transform()`; `safeParse` tidak pernah melempar.
- `rateLimit` bersifat in-memory per proses; pakai store bersama (Redis) bila memakai banyak instance.

---

## NevG.js — game 2D

```js
import { Game, Scene, Rect } from '@adityadevid/nevg';

class Play extends Scene {
  init() {
    this.background = '#10131a';
    this.me = this.add(new Rect({ x: 20, y: 20, w: 16, h: 16, color: '#6ee7b7' }));
    this.camera.follow(this.me, { smoothing: 6 });
  }
  update(dt) {
    const v = this.input.vector();                   // WASD / panah
    this.moveAndCollide(this.me, v.x * 120 * dt, v.y * 120 * dt);   // berhenti di tile/entity solid
  }
}
new Game({ canvas: '#game', width: 320, height: 180, pixelArt: true }).start(new Play());
```

`Game` (loop *fixed timestep*, DPR, fit ke parent, jeda saat tab disembunyikan) · `Scene` · `Entity/Rect/Circle/Label/Sprite` ·
`Camera` (follow, bounds, zoom, shake) · `Input` (aksi bernama, pressed/down/released, pointer) · `Tilemap` (`fromString`, collision) ·
`Tweens/ease` · `Assets` · `Sound` · helper matematika & RNG ber-seed.
Lengkapnya: `ParticleEmitter`, `findPath` (A*), `Body` (fisika arcade), `StateMachine`, `Cooldown`, `Timer`, `Pool`, `SaveData`, `Button`, `ProgressBar`, `transition`, `Gamepads`, helper vektor.
Headless: tanpa `canvas`, jalankan `game.step()` — dipakai untuk tes.

> Entity yang bergerak lewat `moveAndCollide` sebaiknya menyimpan kecepatannya sendiri; `vx/vy` bawaan dipakai untuk gerak sederhana tanpa tabrakan.

Untuk animasi UI di dalam game (menu, HUD), pakai mesin animasi NevF di atas — NevG dan NevF bisa di-import bersamaan di browser.

---

## NevGThree — game 3D

Lapisan 3D untuk NevG (butuh `three`). Loop, scene, entity, input, tween, dan timer sama persis dengan NevG; dunianya 3D.

```js
import { Game3D, Scene3D, Mesh3D, Body3D, Terrain, OrbitRig, Controls3D } from '@adityadevid/nevgthree';

class Play extends Scene3D {
  init() {
    this.lights();                                   // matahari + cahaya langit + bayangan
    this.add(new Terrain({ seed: 7 }));              // pulau low-poly, jadi scene.ground
    this.me = this.add(new Mesh3D({ shape: 'capsule', size: [0.8, 1.8, 0.8], position: [0, 5, 0] }));
    new Body3D(this.me);                             // gravitasi, lompat, lereng
    this.controls = new Controls3D(this.game);       // WASD + mouse + joystick sentuh di HP
    this.rig = new OrbitRig(this.camera, { target: this.me, scene: this });
  }
}
new Game3D({ canvas: '#game', shadows: true }).start(new Play());
```

Coba langsung: `nev create game-saya --template game3d` (Crystal Run 3D: kumpulkan kristal, combo, dash, HUD NevF). Detail API ada di [packages/nevgthree](packages/nevgthree/README.md).

---

## Riwayat fitur per versi

Detail lengkap selalu di [CHANGELOG](CHANGELOG.md).

**Baru di 0.7** — **mesin animasi premium di NevF** (lihat [bagian Animasi](#animasi--mesin-animasi-nevf)): `animate()` dengan keyframes, warna, satuan & nilai relatif, fungsi per-target; `createTimeline()` dengan label dan posisi relatif; `stagger()` termasuk grid; 30+ easing plus `cubicBezier()`, `steps()`, dan `spring()` berbasis fisika; kontrol penuh `play/pause/seek/restart/reverse/cancel/revert` + promise `finished`. NevF naik ke 0.5.0, Nev.js ke 0.7.0. README ini juga dibangun ulang menjadi dokumentasi yang lebih lengkap.

**Baru di 0.6** — rilis hardening hasil audit menyeluruh (39 temuan diperbaiki, semuanya dikunci tes regresi):

- Loader kini menerima konteks middleware (`c.state`/`c.session`) juga saat navigasi client-side dan setelah `action`; streaming SSR mengembalikan status 404/500 asli; celah symlink ke file server di `/__nev/app` ditutup; guard `--out` menolak root filesystem; `/__nev/data` mewajibkan header `x-nev-data: 1`; cache `revalidate` tidak lagi berbagi objek antar-pengunjung.
- **`nev check [folder]`** — validasi proyek sekali jalan: file server-only di `public/` (error), loader yatim, `site` belum diisi, `.env` belum masuk `.gitignore`.
- **CSRF opt-in**: `csrf: true` di `nev.config.js` untuk page action + mutasi API.
- NevB: `maxBodySize` ditegakkan di semua runtime, injeksi SSE ditutup, `verifyJWT`/`verifyPassword`/`safeParse` diperbaiki, **baru: middleware `keyAuth`** (API key statis, constant-time).
- NevF: **baru: `createSelector()`**; loop tulis antar-tab `persisted()` dihentikan; `computed()` tidak lagi bocor.
- NevG: A* kembali optimal untuk tile berbiaya < 1, **baru: `Timer`**; NevGThree: kolisi memperhitungkan skala & entitas anak.

**Baru di 0.5**

- **Streaming SSR (opt-in)** — di `pages/x.server.js` tulis `export const streaming = true` (atau `streaming: true` di `nev.config.js` untuk semua halaman; halaman bisa menolak dengan `streaming = false`). `<head>` (title, meta, CSS, `modulepreload`) dikirim **sebelum** `load` selesai, body menyusul begitu data siap — browser sudah bisa mengunduh CSS/JS selama loader lambat. Diuji lewat koneksi HTTP nyata.
  Konsekuensinya: status HTTP sudah terkirim `200` sebelum loader selesai, jadi `redirect()` dari loader menjadi redirect sisi-browser (`location.replace`), sedangkan `notFound()`/error me-render halaman 404/500 **dengan status 200**. Pakai streaming untuk halaman yang jarang 404; halaman dengan `head` berupa fungsi (butuh data) otomatis kembali ke mode biasa, begitu juga `nev export` dan permintaan `HEAD`. Ini streaming *dokumen*, bukan streaming per-komponen (belum ada Suspense/`defer`).
- **`<link rel="modulepreload">`** untuk client, NevF, halaman, dan layout otomatis di semua halaman (setelah import map).
- **Netlify** — `nev build --target netlify` membuat `.nev/netlify` (`publish/` statis + satu Netlify Function v2 + `netlify.toml`); deploy: `cd .nev/netlify && npx netlify deploy --prod`. Dites dengan menjalankan function hasil build dari folder di luar repo; **belum dicoba di akun Netlify sungguhan**.
- **Cloudflare Pages / Netlify statis** — `nev export --target netlify|cloudflare` juga menulis `_redirects` dan `_headers` dari `redirects`/`headers` di config.
- **Cloudflare Workers belum didukung**: Workers tidak punya file system, sedangkan Nev membaca folder `pages/` dan `api/` saat start. `nev build --target cloudflare` menjelaskan ini dan mengarahkan ke `nev export --target cloudflare` (hosting statis).

**Baru di 0.4** — tiga fitur untuk halaman dinamis:

- **`action` (form tanpa API route)** — di `pages/x.server.js` tulis `export async function action(c) { ... }`. `POST/PUT/PATCH/DELETE` ke URL halaman itu menjalankan `action`; loader dijalankan ulang lalu halaman dirender dengan `props.actionData` (form HTML biasa jalan tanpa JS). Return `Response` (mis. `redirect('/terima-kasih', 303)`) untuk redirect, atau `fail(400, { error: '…' })` untuk menampilkan ulang halaman dengan status 4xx. Halaman tanpa `action` tetap menjawab 404 untuk POST seperti sebelumnya.
- **`export const revalidate = 60`** di `*.server.js` — hasil `load` di-cache 60 detik per URL (hanya mode produksi, hanya permintaan **tanpa** cookie/Authorization, maks. 500 entri, dikosongkan setelah `action` berhasil). Cache ada di memori satu proses.
- **`export const staticPaths = () => [{ slug: 'a' }, { slug: 'b' }]`** di `*.server.js` halaman dinamis — daftar URL untuk `nev export` dan `sitemap.xml` (boleh juga mengembalikan string path jadi). Entri yang parameternya kurang dilewati dengan peringatan.

```js
// pages/kontak.server.js
import { redirect, fail } from '@adityadevid/nevjs';
export async function action(c) {
  const { email } = await c.body();
  if (!email?.includes('@')) return fail(400, { error: 'Email tidak valid' });
  await simpan(email);
  return redirect('/terima-kasih', 303);
}
```

**Baru di 0.3**

```js
// .env / .env.local / .env.production … → process.env (variabel asli selalu menang). Hanya NEV_PUBLIC_* yang sampai ke browser.
import { publicEnv } from '@adityadevid/nevf';
publicEnv('NEV_PUBLIC_API_URL', 'http://localhost:3000');   // sama di SSR dan di browser

// pages/(toko)/keranjang.js → /keranjang   — folder "(grup)" tidak masuk URL, tapi _layout.js-nya tetap membungkus

// nev.config.js
export default defineConfig({
  site: 'https://situsmu.com',
  trailingSlash: 'never',                                                   // satu URL kanonik per halaman (308)
  redirects: [{ source: '/lama/:slug', destination: '/blog/:slug', permanent: true }],
  headers: [{ source: '/api/*', headers: { 'cache-control': 'no-store' } }],
});

// SEO: export head dari halaman — meta description, canonical (absolut lewat `site`), robots, Open Graph, Twitter, JSON-LD.
// Tag-nya ikut berganti saat navigasi client-side.
export const head = ({ data }) => ({
  title: data.post.title, description: data.post.summary, canonical: `/blog/${data.post.slug}`,
  openGraph: { image: '/og.png', type: 'article' }, twitter: {},
  jsonLd: { '@context': 'https://schema.org', '@type': 'Article', headline: data.post.title },
});

// loader: notFound() → halaman 404 dengan status 404 asli
import { notFound } from '@adityadevid/nevjs';
```

**Baru di 0.2** — `middleware.js` di root proyek (jalan sebelum semua route; `export const matcher = ['/admin/*']` untuk membatasi),
`/sitemap.xml` + `/robots.txt` otomatis bila `site: 'https://situsmu.com'` diisi di `nev.config.js` (`sitemapPaths` untuk halaman dinamis),
`nev export` (loader dijalankan saat export; halaman ber-loader berpindah dengan page load penuh di situs statis; taruh di root domain),
template `api` dan `game`, serta Dockerfile di semua template. Juga: NevF `createStore`, `createContext/useContext`, `createForm`, hooks lengkap; NevG `ParticleEmitter`, A*, `Body`, `StateMachine`, `Pool`, `SaveData`.
Semua paket menyertakan deklarasi TypeScript (`types/index.d.ts`).

`nev build --target vercel` membuat `.vercel/output` (deploy: `vercel deploy --prebuilt`; belum dicoba di akun Vercel sungguhan). `createHandler()` mengembalikan handler Web-standar
`(request) => Response` untuk runtime serverless/edge (lihat [packages/nev](packages/nev/README.md)). NevB: `trailingSlash('never' | 'always')`. NevF: `publicEnv`.

---

## Batasan yang perlu kamu tahu

- **Tanpa bundler/minifier**: tiap modul diminta terpisah (HTTP/2 membantu). Cocok untuk app kecil–menengah; belum ada code-splitting otomatis atau TypeScript/JSX bawaan.
- **Hydration** saat ini membangun ulang DOM (bukan memakai ulang node SSR) — hasilnya sama, tapi fokus/scroll input bisa reset bila JS lambat dimuat.
- Layout dibuat ulang saat berpindah halaman (state di dalam layout tidak dipertahankan).
- SSR sinkron: ambil data di `load`, bukan di dalam komponen. Streaming hanya level dokumen (lihat 0.5); belum ada Suspense/`defer`.
- `nev dev` me-restart seluruh proses saat file berubah (state memori hilang) — penyederhanaan yang disengaja.
- Nev adalah server Node: jalankan di VPS/Railway/Render/Fly/Docker (ada Dockerfile di template). Untuk hosting statis pakai `nev export`. Untuk serverless ada adapter Vercel dan Netlify (`nev build --target …`) serta `createHandler()` (handler Web-standar); semuanya **belum diuji di platform nyata**. Cloudflare Workers belum didukung.
- Contoh template memakai penyimpanan in-memory (guestbook) — ganti dengan database sungguhan (mis. Supabase) di `lib/*.server.js`.
- Mesin animasi menganimasikan properti CSS/transform/objek; morphing path SVG dan animasi teks per-huruf belum termasuk.

## Pengujian

`npm test` menjalankan semua tes (**422 tes**, 117 suite): unit, HTTP nyata, dan Chromium via Playwright bila terpasang — jika tidak, tes browser dilewati.
Per paket: `npm run test:f` (NevF), `test:b` (NevB), `test:g` (NevG), `test:g3` (NevGThree), `test:fullstack` (Nev).

## Kredit

Nev.js dibuat oleh **AdityaDevID** ([@AdityaDevID](https://github.com/AdityaDevID)) dan dikembangkan bersama
**AunuHost** — **Dwi Aunu Santoso** ([@AunuHost](https://github.com/AunuHost), AunuCore), collaborator:
audit keamanan & correctness menyeluruh + fitur `nev check`, `keyAuth`, `createSelector`, `Timer` (0.6),
dan mesin animasi premium NevF (0.7).

## Lisensi

MIT © AdityaDevID & kontributor. Lihat [LICENSE](LICENSE).
