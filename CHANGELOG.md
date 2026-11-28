# Changelog

## 0.7.1 — NevF 0.5.1 (dua perbaikan mesin animasi, ketahuan dari showcase)
Rilis perbaikan cepat: halaman showcase baru (`examples/animation-showcase.html`, satu file, enam lab interaktif) membongkar dua bug yang lolos dari tes unit karena keduanya hanya muncul di browser sungguhan. **425 tes lulus (3 tes regresi baru)**.

**NevF (`@adityadevid/nevf` 0.5.1)**
- **`createTimeline()` sekarang autoplay secara default**, sama seperti `animate()` dan Anime.js (sebelumnya timeline diam tidak bergerak sampai `play()` dipanggil manual — inkonsistensi API; `autoplay: false` tetap didukung).
- **Nilai angka polos tanpa satuan kini diberi satuan otomatis**: komponen `translate*`/`perspective` → `px`, `rotate*`/`skew*` → `deg`, dan properti dimensi CSS (`width`, `height`, `top`, `margin`, `fontSize`, `borderRadius`, dll.) → `px`. Sebelumnya `x: [0, 1500]` menghasilkan `translate3d(750, …)` tanpa satuan — CSS tidak valid yang diabaikan browser secara diam-diam, jadi animasi transform dari pasangan `[from, to]` tidak pernah bergerak di browser (di jsdom nilai awal kebetulan menutupi gejalanya).

**Nev (`@adityadevid/nevjs` 0.7.1)**
- Dependensi template diperbarui ke `^0.7.1`; contoh baru `examples/animation-showcase.html` ditautkan dari README.

## 0.7.0 — NevF 0.5.0 (mesin animasi premium setara Anime.js) + README extended
Fitur terbesar sejak 0.2: NevF kini punya mesin animasi lengkap tanpa dependensi. **422 tes lulus (30 baru, khusus animasi)**. README dibangun ulang menjadi dokumentasi extended (daftar isi, bagian Animasi penuh, riwayat fitur per versi, kredit). Kredit rilis ini: AdityaDevID & AunuHost (collaborator).

**NevF (`@adityadevid/nevf` 0.5.0)**
- **Baru: `animate(targets, params)`** — target elemen/selector/array/NodeList/objek polos. Nilai: angka, string satuan (px/%/deg/turn/em/rem), warna hex/rgb/rgba (interpolasi per kanal), `[from, to]`, nilai relatif `+=`/`-=`/`*=`, fungsi `(el, i, total)`, dan **keyframes** per properti (`{to|value, duration?, delay?, ease?}`, durasi dinormalisasi ke durasi animasi bila tidak semua tahap menyebut durasi).
- **Transform dikomposisi otomatis**: `x/y/z`, `translate*`, `scale*`, `rotate*`, `skew*`, `perspective` menjadi satu string `transform`; properti CSS lain ke `style`, custom property `--*` via `setProperty`.
- **Kontrol penuh**: `play/pause/seek/restart/reverse/cancel/revert`, promise `finished` (resolve saat selesai alami, reject saat cancel/revert), `progress`, `currentTime`, `duration`, `totalDuration`, callback `onBegin/onUpdate/onLoop/onComplete`; `loop` (angka/`true`), `alternate`, `reversed`, `endDelay`. `seek(ms)` deterministik tanpa rAF — mudah dites.
- **Baru: `createTimeline()`** — `.add()` dua bentuk (targets+params atau params berisi `targets`, termasuk instance animasi), posisi angka/label/`'<'`/`'+=n'`/`'-=n'`, `.set()` durasi-0, `.label()`, `defaults` diwarisi anak, kontrol playback sama seperti animasi.
- **Baru: `stagger(value, opts)`** — `from: first/last/center/indeks/random`, rentang `[a, b]`, `start`, easing distribusi, dan `grid: [baris, kolom]` + `axis`.
- **Baru: 30+ easing** (keluarga Quad/Cubic/Quart/Quint/Sine/Expo/Circ/Back/Bounce/Elastic × In/Out/InOut + `linear`) di objek `easings`, plus factory **`cubicBezier(x1, y1, x2, y2)`**, **`steps(n, mode)`**, dan **`spring({stiffness, damping, mass, velocity})`** — pegas fisika sungguhan (simulasi Euler semi-implisit 1/240): overshoot & settle, durasi efektif mengikuti waktu settle (cap 10 dtk).
- Aman SSR: modul bisa di-import di Node murni tanpa `window`/`document`; ticker bersama memakai `requestAnimationFrame` bila ada (fallback `setTimeout`) dan berhenti saat tidak ada animasi aktif. Deklarasi TypeScript lengkap untuk semua API baru.

**Nev (`@adityadevid/nevjs` 0.7.0)**
- Dependensi `@adityadevid/nevf` naik ke `^0.5.0`; template (`default`, `api`, `game`, `game3d`) diperbarui ke nevjs `^0.7.0` + nevf `^0.5.0`.

**Lainnya**
- Semua `package.json` kini mencantumkan `contributors: AunuHost` (author tetap AdityaDevID).

## 0.6.0 — Semua paket (audit keamanan & kebenaran menyeluruh + fitur baru)
Rilis hardening: seluruh kode diaudit baris demi baris; **39 temuan** diperbaiki dan dikunci dengan tes regresi. **392 tes lulus (78 baru)** — angka lama di README (290) dan catatan 0.5.0 (316) sudah tidak akurat dan ikut diperbaiki.

**Nev (`@adityadevid/nevjs` 0.6.0)**
- **Loader sekarang menerima konteks middleware juga saat navigasi client & setelah `action`**: `/__nev/data` dan render-ulang pasca-action memakai Context request yang sama, jadi `c.state`, `c.session`, `c.valid` dari `middleware.js`/`setup()`/session tidak lagi hilang (sebelumnya halaman terautentikasi diam-diam rusak setelah klik link pertama).
- **Streaming SSR mengembalikan status asli**: loader ditunggu sebelum stream dimulai, jadi `notFound()`/error menghasilkan 404/500 sungguhan, bukan soft-404 berstatus 200. Konsekuensinya TTFB streaming kini menunggu loader selesai (head dan body tetap dikirim sebagai chunk terpisah).
- **Celah symlink di `/__nev/app` ditutup**: symlink di dalam proyek yang menunjuk ke `*.server.js`, `nev.config.js`, `middleware.js`, atau file `api/` tidak lagi bisa diunduh browser — pemeriksaan file terlarang kini diterapkan pada path hasil realpath.
- **Guard `--out` diperketat**: `nev export`/`nev build` menolak `--out` yang merupakan root filesystem, root proyek, atau leluhur root proyek (sebelumnya `--out /` lolos dan bisa menghapus dari root).
- **`/__nev/data` mewajibkan header `x-nev-data: 1`** (client bawaan sudah mengirimnya) — request lintas-situs tanpa header kustom ditolak 403.
- **Cache `revalidate` tidak lagi berbagi objek**: data di-`structuredClone` saat disimpan dan disajikan, dan `Accept-Language` ikut menjadi kunci cache (sebelumnya satu pengunjung bisa meracuni/mengubah data semua pengunjung lain).
- **`nev export` tangguh**: satu link/path tidak aman (`/../`, `%2e%2e`) dilewati dengan peringatan, tidak lagi menggagalkan seluruh export. `public/.well-known/*` kini ikut ter-export/ter-build (sebelumnya hilang diam-diam).
- **Route group di akhir path diperbaiki**: `pages/(marketing).js` → `/`, `pages/blog/(seo).js` → `/blog` (sebelumnya jadi URL literal berkurung).
- **CSRF opt-in**: `csrf: true` di `nev.config.js` memasang middleware `csrf()` NevB untuk page action dan mutasi API.
- **CLI `nev create`**: `--template` yang keluar dari folder template ditolak. **`parseEnv`**: nilai dikutip dengan `\"` tidak lagi terpotong.
- **Baru: `nev check [folder]`** — validasi proyek sekali jalan: proyek bisa dimuat, hitungan route, file server-only di dalam `public/` (error — bisa diunduh siapa pun), loader yatim tanpa halaman, `site` belum diisi, dan `.env` yang belum masuk `.gitignore`. Exit code 1 bila ada error.

**NevB (`@adityadevid/nevb` 0.4.0)**
- **`maxBodySize` kini ditegakkan di `Context.body()`** untuk semua runtime (header `content-length` + byte aktual saat streaming, 413) — sebelumnya hanya di adapter Node, jadi deployment Workers/Bun menerima body tanpa batas.
- **Injeksi SSE ditutup**: field `event`/`id` yang mengandung CR/LF dibuang, `retry` hanya diterima sebagai angka valid — `send()` tidak bisa lagi memalsukan event.
- **Middleware yang lupa `await next()` tidak lagi menjatuhkan proses**: promise downstream selalu ditunggu/diobservasi; error downstream diteruskan, tidak ada lagi `unhandledRejection` yang mengambang.
- **`verifyPassword` tidak pernah melempar**: hash tersimpan yang rusak mengembalikan `false` (sebelumnya 500 di endpoint login).
- **`verifyJWT`**: `clockTolerance` kini melonggarkan `exp` DAN `nbf` dengan arah yang benar (mengikuti RFC 7519, termasuk batas tepat di `exp`), dan klaim `exp`/`nbf` non-numerik ditolak.
- **`safeParse` benar-benar aman**: pengecualian dari `.refine()`/`.transform()` menjadi `{ ok: false, errors }`, bukan throw.
- **Validasi `v.string({ pattern })`**: regex `/g`/`/y` tidak lagi berganti-ganti hasil antar-request (`lastIndex` direset).
- **Session**: data yang tidak bisa di-serialisasi (BigInt/sirkular) tidak lagi mengubah respons sukses menjadi 500; `regenerate()` pada session cookie kini mencabut cookie lama (id sesi dirotasi + daftar cabut in-memory — hilang saat proses restart, didokumentasikan di kode).
- **CORS**: fungsi `origin` yang mengembalikan `true` kini memantulkan origin request (bukan string `"true"` yang invalid), dan opsi `headers` diterima sebagai alias `allowedHeaders`. Tipe TypeScript diselaraskan.
- **Baru: middleware `keyAuth`** — autentikasi API key statis (header `x-api-key` atau skema `Authorization: ApiKey …`), perbandingan constant-time, dukungan fungsi lookup async yang bisa menamai klien lewat `c.state.apiKeyId`.

**NevF (`@adityadevid/nevf` 0.4.0)**
- **`persisted()`**: loop tulis tak berujung antar-tab untuk nilai objek dihentikan (penanda suppress + perbandingan serialisasi).
- **`computed()` kini dimiliki owner**: dispose owner melepaskan computed dari sumbernya — tidak ada lagi kebocoran reaktivitas yang menumpuk.
- **`Router`**: prop `fallback` (sesuai tipe) kini benar-benar dipakai sebagai halaman not-found (`notFound` tetap jadi alias), dan `routes` yang kosong tidak lagi crash.
- **`useQuery`**: perbandingan query tidak lagi menabrakkan `'a,b'` dengan `['a','b']` — navigasi antar keduanya tidak lagi menyajikan query basi.
- **`snapshot()`**: `Date`/`Map`/`Set` kini disalin dalam, bukan berbagi referensi dengan store.
- **`navigate()`**: hash URL yang rusak tidak lagi melempar `URIError` setelah navigasi terjadi.
- **`hydrate()`** didokumentasikan apa adanya (client takeover yang membuang DOM SSR) dan memberi peringatan di mode dev.
- **Baru: `createSelector(source, equals?)`** — primitif reaktif ala Solid: `isActive(id)` di dalam effect hanya menjalankan ulang observer yang status cocoknya berubah.

**NevG (`@adityadevid/nevg` 0.3.0)**
- **A\* kembali optimal**: heuristik diskalakan dengan biaya tile minimum, jadi tile berbiaya < 1 (jalan, rel) benar-benar dipakai (sebelumnya jalur lurus yang lebih mahal bisa menang).
- **`Assets.load()`**: aset yang gagal tidak lagi hilang dari antrean — `load()` berikutnya mengulang yang gagal saja.
- **Kolisi & query kini mencakup entitas anak** (`Scene._collide`/`query`), konsisten dengan `withTag` dan rect dunia.
- **Tilemap kosong tidak lagi crash** saat render; **`Sprite.play()`** mereset status selesai sehingga `animationend` terbit untuk animasi non-loop berikutnya; **`transition()`** tidak lagi menggantung pada scene yang di-pause; **input**: tombol untuk action yang di-`bind()` setelah `attach()` kini juga di-`preventDefault`.
- Tipe TypeScript diselaraskan dengan runtime (`Tween.finished`/`paused`, field `Body`, `GameOptions.fit: 'none'`, `Camera.follow` mengembalikan `this`).
- **Baru: `Timer`** — timer one-shot/looping berbasis `update(dt)` dengan event `complete`/`tick`, `pause`/`resume`/`restart`.

**NevGThree (`@adityadevid/nevgthree` 0.2.0)**
- Kolisi & `queryBox` kini mencakup entitas anak; cabang `snapDown` mengisi `hit.y` dengan benar (kecepatan jatuh tidak lagi menumpuk diam-diam saat menuruni lereng); kotak kolisi `Entity3D` kini memperhitungkan `object.scale`; `Particles3D({ max: 0 })` dan `Terrain({ segments: 0 })` tidak lagi crash/NaN. Tipe `Entity3DOptions.size` menerima `THREE.Vector3`.

## 0.5.0 — Nev (`@adityadevid/nevjs`)
- **Streaming SSR (opt-in)**: `export const streaming = true` di `*.server.js` (atau `streaming: true` di config). `<head>` dikirim lebih dulu, body menyusul setelah `load` selesai. `redirect()` setelah head terkirim jadi redirect sisi-browser; `notFound()`/error merender halaman 404/500 dengan status 200. Halaman dengan `head()` berupa fungsi, `nev export`, dan `HEAD` tetap mode biasa.
- **`modulepreload`** otomatis untuk client, NevF, halaman, dan layout.
- **`nev build --target netlify`** / `buildNetlify()`: `.nev/netlify` berisi `publish/`, Netlify Function v2, dan `netlify.toml`. Dites dengan menjalankan hasil build dari folder lain; belum dicoba di akun Netlify sungguhan.
- **`nev export --target netlify|cloudflare`**: menulis `_redirects` dan `_headers` dari config (`redirectsFile()`, `headersFile()`).
- `nev build --target cloudflare` menolak dengan penjelasan (Workers tanpa file system) dan menunjuk ke `nev export --target cloudflare`.
- Refactor internal: pembentukan dokumen dipecah (`renderDocumentParts`), build Vercel/Netlify berbagi satu tahap staging.
- Tipe TypeScript: `streaming`, `export.target`, `buildNetlify`, `redirectsFile`, `headersFile`.
316 tes lulus (12 baru). NevB/NevF/NevG/NevGThree tidak berubah.

## 0.4.0 — Nev (`@adityadevid/nevjs`)
- **Page `action`**: `export async function action(c)` di `*.server.js` menangani POST/PUT/PATCH/DELETE ke URL halaman; hasilnya masuk ke `props.actionData` (juga ikut hydration). `fail(status, data)` untuk error validasi, `Response` untuk redirect. Tanpa `action`, perilaku lama (404) tidak berubah.
- **`revalidate`**: `export const revalidate = <detik>` meng-cache hasil `load` per URL (produksi saja, dilewati bila ada cookie/Authorization, dikosongkan setelah `action`).
- **`staticPaths`**: halaman dinamis bisa mendaftarkan URL-nya untuk `nev export` dan `sitemap.xml`.
- Tipe TypeScript: `fail`, `PageAction`, `StaticPaths`.
304 tes lulus (14 baru). NevB/NevF/NevG/NevGThree tidak berubah.

## 0.3.0 — Nev (`@adityadevid/nevjs`), NevB, NevF
**Nev**
- **`.env`**: `.env`, `.env.local`, `.env.<mode>`, `.env.<mode>.local` dimuat ke `process.env` (variabel asli menang; `.env.local` dilewati saat `test`). Hanya `NEV_PUBLIC_*` yang dikirim ke browser, dibaca lewat `publicEnv()`.
- **Route groups**: folder `(nama)` tidak masuk URL tetapi `_layout.js`-nya tetap berlaku.
- **Config `redirects`, `headers`, `trailingSlash`** (divalidasi saat start; tujuan redirect tidak bisa jadi `//host`).
- **SEO `head`**: `description`, `canonical`, `robots`, `openGraph`, `twitter`, `jsonLd`, `alternates`, `themeColor`, dll.; URL relatif jadi absolut lewat `site`; JSON-LD aman dari `</script>`; `head` boleh berupa objek biasa; tag diganti saat navigasi client-side.
- `notFound()`, `createHandler()` (handler Web-standar untuk serverless/edge — belum diuji di platform nyata), `nev info`, `.env.example` di template, ekspor `loadEnv/parseEnv/expandHead`.
- **`nev build --target vercel`** / `buildVercel()`: menghasilkan `.vercel/output` (Build Output API v3): aset statis di CDN + satu fungsi Node berisi proyek dan dependensi produksi. Dites dengan menjalankan hasil build dari folder di luar repo (halaman, API, env platform). Deploy: `vercel deploy --prebuilt`. Belum dicoba di akun Vercel sungguhan; Netlify/Cloudflare belum ada.
**NevB** — middleware `trailingSlash('never' | 'always')`.
**NevF** — `publicEnv`, `setPublicEnv`.
290 tes lulus (18 baru); fitur sisi-browser diverifikasi manual di Chromium.

## 0.2.3 — Nev (`@adityadevid/nevjs`)
CLI: perintah salah ketik sekarang disarankan (`nev strat` → `Did you mean "nev start"?`). Termasuk pembaruan tooling di bawah (jsdom 29) dan rilis NevGThree/NevG 0.2.2 yang belum dirilis.

## Tooling (tanpa perubahan versi paket)
`jsdom` (devDependency) 25 → 29.1.1; `three` 0.187.0 sudah terbaru. 271 tes lulus, `npm audit` 0 kerentanan. jsdom 30+ butuh Node ≥ 22.22, jadi sengaja tidak dipakai agar CI Node 20 tetap jalan.

## 0.2.2 — NevGThree 0.1.0 (belum dirilis)
**NevGThree** (`@adityadevid/nevgthree` 0.1.0) — game 3D di atas three.js: `Game3D` (resolusi adaptif, `setQuality`), `Scene3D` (lights, fog, pick/raycast, `moveAndCollide3`, shake), `Entity3D/Mesh3D/Model3D`, `Body3D`, `OrbitRig/TopDownRig/FirstPersonRig`, `Controls3D` (joystick sentuh), `Terrain` (heightAt presisi), `Particles3D`, `props`, `extendAssets`.
**Nev** — template `game3d` (Crystal Run 3D); `three` dan `three/addons/` dilayani lewat import map (juga ikut `nev export`, build WebGPU/TSL dilewati).
**NevG** 0.2.2 — opsi `maxDpr`, hook `_createContext`, `Scene` menerima kamera non-2D.

## 0.2.1
Paket fullstack diganti nama menjadi `@adityadevid/nevjs` (nama `nevjs` ditolak npm karena terlalu mirip `nev-js`). Perintah CLI tetap `nev`.

## 0.2.0
**NevB** — `session` (+ `MemoryStore`), `jwtAuth`, `signJWT/verifyJWT`, `hashPassword/verifyPassword`, `sign/unsign`, `compress`, `csrf`, `requestId`, `basicAuth`, `bearerAuth`, `timeout`, `cacheControl`, `etag`, `health`; validation: `union literal record tuple date url uuid`, `.nullable() .refine() .transform()`.
**NevF** — `createStore`, `createContext/useContext`, `createForm`, `lazy`, `Portal`, `Dynamic`, hooks (`persisted debounced throttled interval timeout listen mediaQuery toggle previous`).
**NevG** — `ParticleEmitter`, A* pathfinding, `Body` physics, `StateMachine`, `Cooldown`, `Pool`, `SaveData`, `Button`, `ProgressBar`, `transition`, `Gamepads`, vector helpers.
**Nev** — `nev export` (static sites), `middleware.js`, sitemap/robots, `api` and `game` templates, Dockerfile in templates, TypeScript declarations for every package.

## 0.1.0
First release: NevF, NevB, NevG and the Nev fullstack framework.
