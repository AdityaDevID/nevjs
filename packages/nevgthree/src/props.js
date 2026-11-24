import * as THREE from 'three';
import { createRng } from '@adityadevid/nevg';

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, ...extra });

export function createSky({ top = '#4aa3ff', horizon = '#d6efff', radius = 300 } = {}) {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 24, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { top: { value: new THREE.Color(top) }, horizon: { value: new THREE.Color(horizon) } },
      vertexShader: 'varying float h; void main(){ h = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 horizon; varying float h; void main(){ gl_FragColor = vec4(mix(horizon, top, pow(clamp(h,0.0,1.0), 0.6)), 1.0); }',
    }),
  );
  m.frustumCulled = false;
  m.renderOrder = -1;
  return m;
}

export const props = {
  tree({ rng = Math.random, height = 3.4 } = {}) {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, height * 0.38, 6), mat('#7a5230'));
    trunk.position.y = height * 0.19;
    g.add(trunk);
    const green = new THREE.Color('#2f8f4e').offsetHSL((rng() - 0.5) * 0.05, 0, (rng() - 0.5) * 0.08);
    for (let i = 0; i < 3; i++) {
      const r = 1.15 - i * 0.28;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(r, height * 0.45, 7), mat(green));
      cone.position.y = height * (0.42 + i * 0.22);
      g.add(cone);
    }
    g.rotation.y = rng() * Math.PI * 2;
    g.scale.setScalar(0.8 + rng() * 0.5);
    g.traverse((o) => o.isMesh && ((o.castShadow = true), (o.receiveShadow = false)));
    return g;
  },
  rock({ rng = Math.random, size = 1 } = {}) {
    const geo = new THREE.DodecahedronGeometry(0.6 * size, 0);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * (0.85 + rng() * 0.3), p.getY(i) * (0.6 + rng() * 0.3), p.getZ(i) * (0.85 + rng() * 0.3));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat('#8b9098'));
    m.position.y = 0.3 * size;
    m.rotation.y = rng() * 6;
    m.castShadow = true;
    const g = new THREE.Group();
    g.add(m);
    return g;
  },
  crystal({ color = '#7df9ff', size = 1 } = {}) {
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.4 * size), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.7, flatShading: true, roughness: 0.2, metalness: 0.3 }));
    m.scale.y = 1.5;
    m.position.y = 0.6 * size;
    m.castShadow = true;
    g.add(m);
    return g;
  },
  character({ body = '#6ee7b7', skin = '#ffd9b3', accent = '#2b3a67' } = {}) {
    const g = new THREE.Group();
    const part = (geo, color, x, y, z) => {
      const m = new THREE.Mesh(geo, mat(color));
      m.position.set(x, y, z);
      m.castShadow = true;
      return m;
    };
    const torso = part(new THREE.BoxGeometry(0.7, 0.8, 0.4), body, 0, 1.1, 0);
    const head = part(new THREE.BoxGeometry(0.55, 0.55, 0.55), skin, 0, 1.78, 0);
    const eyeL = part(new THREE.BoxGeometry(0.08, 0.1, 0.05), '#222', -0.13, 1.82, 0.28);
    const eyeR = part(new THREE.BoxGeometry(0.08, 0.1, 0.05), '#222', 0.13, 1.82, 0.28);
    const legGeo = new THREE.BoxGeometry(0.28, 0.7, 0.3).translate(0, -0.35, 0);
    const armGeo = new THREE.BoxGeometry(0.22, 0.7, 0.24).translate(0, -0.3, 0);
    const legL = part(legGeo, accent, -0.18, 0.7, 0);
    const legR = part(legGeo, accent, 0.18, 0.7, 0);
    const armL = part(armGeo, body, -0.47, 1.45, 0);
    const armR = part(armGeo, body, 0.47, 1.45, 0);
    g.add(torso, head, eyeL, eyeR, legL, legR, armL, armR);
    g.userData.parts = {
      head, torso,
      animate(t, speed = 0) {
        const s = Math.sin(t * 10) * Math.min(1, speed / 4) * 0.9;
        legL.rotation.x = s;
        legR.rotation.x = -s;
        armL.rotation.x = -s * 0.8;
        armR.rotation.x = s * 0.8;
        torso.position.y = 1.1 + Math.abs(Math.sin(t * 10)) * 0.04 * Math.min(1, speed / 4);
      },
    };
    return g;
  },
  cloud({ rng = createRng(3) } = {}) {
    const g = new THREE.Group();
    const m = new THREE.MeshStandardMaterial({ color: '#ffffff', flatShading: true, roughness: 1, transparent: true, opacity: 0.92 });
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Mesh(new THREE.IcosahedronGeometry(1.4 + rng() * 1.2, 0), m);
      s.position.set(i * 1.8 - 2.7 + rng(), rng() * 0.6, rng() * 1.2);
      g.add(s);
    }
    return g;
  },
};
