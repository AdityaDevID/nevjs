# Changelog

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
