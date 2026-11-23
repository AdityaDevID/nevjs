import * as THREE from 'three';

/**
 * Add 3D asset types to a NevG Assets instance:
 *   assets.texture('grass', 'grass.png')           // THREE.Texture (sRGB, repeat-wrapped)
 *   assets.gltf('tree', 'tree.glb')                // needs GLTFLoader: extendAssets(assets, { GLTFLoader })
 *   await assets.load()
 * GLTFLoader lives in three's addons:  import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
 */
export function extendAssets(assets, { GLTFLoader = null, textureLoader = null } = {}) {
  if (assets._3d) return assets;
  assets._3d = true;
  const tl = textureLoader ?? new THREE.TextureLoader();
  assets.loaders.texture = (url) =>
    new Promise((res, rej) =>
      tl.load(
        url,
        (t) => {
          t.colorSpace = THREE.SRGBColorSpace;
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          res(t);
        },
        undefined,
        () => rej(new Error('texture error')),
      ),
    );
  assets.texture = (key, url) => assets._add('texture', key, url);
  if (GLTFLoader) {
    const gl = new GLTFLoader();
    assets.loaders.gltf = (url) => new Promise((res, rej) => gl.load(url, res, undefined, (e) => rej(new Error(e?.message ?? 'gltf error'))));
  } else {
    assets.loaders.gltf = () => Promise.reject(new Error('GLTFLoader missing — call extendAssets(assets, { GLTFLoader })'));
  }
  assets.gltf = (key, url) => assets._add('gltf', key, url);
  return assets;
}
