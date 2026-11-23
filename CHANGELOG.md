# Changelog

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
