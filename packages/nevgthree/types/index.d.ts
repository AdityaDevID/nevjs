import * as THREE from 'three';
import { Game, GameOptions, Scene, Entity, Assets, Input, Emitter } from '@adityadevid/nevg';

export { THREE };

export interface Game3DOptions extends Omit<GameOptions, 'canvas' | 'fit' | 'pixelArt'> {
  canvas?: string | HTMLCanvasElement;
  /** Inject a renderer (tests / custom WebGLRenderer). */
  renderer?: any;
  antialias?: boolean; shadows?: boolean; toneMapping?: boolean; adaptive?: boolean; rendererOptions?: object;
}
export class Game3D extends Game {
  constructor(o?: Game3DOptions);
  renderer: THREE.WebGLRenderer | any; shadows: boolean; quality: 'low' | 'medium' | 'high';
  setQuality(level: 'low' | 'medium' | 'high'): this;
}

export interface RaycastHit { entity: Entity3D | null; object: THREE.Object3D; point: THREE.Vector3; distance: number }
export interface Hit3 { x: boolean; y: boolean; z: boolean; bottom: boolean; top: boolean; ground: boolean; entity: Entity3D | null }
export interface LightOptions { sun?: string; sky?: string; ground?: string; intensity?: number; ambient?: number; direction?: [number, number, number]; shadows?: boolean; shadowSize?: number; shadowMap?: number }

export class Scene3D extends Scene {
  constructor(props?: Record<string, any>);
  three: THREE.Scene; camera: any /* THREE.PerspectiveCamera */; rig: { update(dt: number): void } | null;
  ground: { heightAt(x: number, z: number): number } | null; groundY: number; sky: THREE.Object3D | null; sun: THREE.DirectionalLight | null;
  background: THREE.ColorRepresentation | THREE.Texture | null;
  fog: THREE.Fog | THREE.FogExp2 | [THREE.ColorRepresentation, number, number] | { color: THREE.ColorRepresentation; density?: number } | null;
  add<T extends Entity3D | THREE.Object3D>(e: T): T; add(...e: Array<Entity3D | THREE.Object3D>): Array<Entity3D | THREE.Object3D>;
  lights(o?: LightOptions): { sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight };
  shadowFollow(target: Entity3D | THREE.Object3D | THREE.Vector3): void;
  groundHeight(x: number, z: number): number;
  raycast(origin: THREE.Vector3, direction: THREE.Vector3, o?: { far?: number; filter?: (e: Entity3D | null, o: THREE.Object3D) => boolean }): RaycastHit[];
  pick(x?: number, y?: number, o?: { far?: number; filter?: (e: Entity3D | null, o: THREE.Object3D) => boolean }): RaycastHit | null;
  queryBox(box: THREE.Box3, tag?: string): Entity3D[];
  moveAndCollide3(e: Entity3D, dx: number, dy: number, dz: number, o?: { stepHeight?: number; snapDown?: number }): Hit3;
  shake(power?: number, duration?: number): void;
  onResize(w: number, h: number): void;
}
export function disposeObject(root: THREE.Object3D): void;

export interface Entity3DOptions {
  object?: THREE.Object3D; position?: [number, number, number] | THREE.Vector3; rotation?: [number, number, number]; scale?: number | [number, number, number];
  size?: [number, number, number] | THREE.Vector3; anchor?: number; castShadow?: boolean; receiveShadow?: boolean;
  spin?: [number, number, number]; bob?: { amp: number; speed: number };
  tags?: string | string[]; solid?: boolean; collides?: boolean; update?(dt: number): void; [k: string]: any;
}
export class Entity3D extends Entity {
  constructor(o?: Entity3DOptions);
  object: THREE.Object3D; size: THREE.Vector3; anchor: number; body: Body3D | null;
  readonly position: THREE.Vector3; readonly rot: THREE.Euler; readonly scale3: THREE.Vector3; readonly box: THREE.Box3; readonly center: THREE.Vector3;
  distanceTo(other: Entity3D | THREE.Object3D): number; lookAtXZ(x: number, z: number, turn?: number): this;
  onCollide(other: Entity3D): void;
}
export interface Mesh3DOptions extends Entity3DOptions {
  shape?: 'box' | 'sphere' | 'cylinder' | 'cone' | 'capsule' | 'plane' | 'octahedron';
  color?: THREE.ColorRepresentation; material?: THREE.Material; geometry?: THREE.BufferGeometry; flat?: boolean; emissive?: THREE.ColorRepresentation; roughness?: number; metalness?: number; opacity?: number;
}
export class Mesh3D extends Entity3D { constructor(o?: Mesh3DOptions); mesh: THREE.Mesh; material: THREE.Material; color: string }
export class Model3D extends Entity3D { constructor(o: Entity3DOptions & { model: THREE.Object3D; clone?: boolean }); model: THREE.Object3D }

export interface Body3DOptions { gravity?: number; maxFall?: number; accel?: number; friction?: number; airControl?: number; stepHeight?: number; coyote?: number; jumpBuffer?: number }
export class Body3D {
  constructor(entity: Entity3D, o?: Body3DOptions);
  vel: THREE.Vector3; onGround: boolean; hit: Hit3 | null;
  walk(dx: number, dz: number, speed: number): void; stop(): void; jump(power: number): boolean; cutJump(factor?: number): void; impulse(x: number, y: number, z: number): void; step(dt: number): Hit3;
}

export interface OrbitRigOptions { target?: Entity3D | THREE.Object3D | null; distance?: number; height?: number; yaw?: number; pitch?: number; minPitch?: number; maxPitch?: number; minDistance?: number; maxDistance?: number; smoothing?: number; scene?: Scene3D | null }
export class OrbitRig {
  constructor(camera: THREE.Camera, o?: OrbitRigOptions);
  yaw: number; pitch: number; distance: number; target: Entity3D | THREE.Object3D | null; readonly forward: { x: number; z: number };
  rotate(dyaw: number, dpitch: number): void; zoom(delta: number): void; relative(mx: number, my: number): { x: number; z: number }; update(dt: number): void;
}
export class TopDownRig extends OrbitRig {}
export class FirstPersonRig {
  constructor(camera: THREE.Camera, o?: { target?: Entity3D | THREE.Object3D | null; eye?: number; yaw?: number; pitch?: number; limit?: number });
  yaw: number; pitch: number; readonly forward: { x: number; z: number };
  rotate(dyaw: number, dpitch: number): void; relative(mx: number, my: number): { x: number; z: number }; update(): void;
}

export interface Controls3DOptions { mount?: HTMLElement | null; touch?: 'auto' | boolean; joystick?: boolean; buttons?: Array<{ code: string; label?: string; size?: number }>; sensitivity?: number; touchSensitivity?: number; pointerLock?: boolean; invertY?: boolean; deadzone?: number }
export class Controls3D {
  constructor(game: Game, o?: Controls3DOptions);
  /** x = right, y = forward, -1..1 (keyboard + joystick). */
  readonly move: { x: number; y: number }; stick: { x: number; y: number };
  consumeLook(): { x: number; y: number }; addLook(dx: number, dy: number): void; setStick(x: number, y: number): void; destroy(): void;
}

export interface TerrainOptions { size?: number; segments?: number; height?: number; seed?: number; scale?: number; flatRadius?: number; island?: boolean; waterLevel?: number; colors?: Partial<Record<'sand' | 'grass' | 'grass2' | 'rock' | 'snow', string>> }
export class Terrain extends THREE.Mesh {
  constructor(o?: TerrainOptions);
  size: number; waterLevel: number;
  heightAt(x: number, z: number): number; isLand(x: number, z: number, margin?: number): boolean;
  scatter(count: number, o?: { rng?: any; minHeight?: number; maxHeight?: number; avoid?: Array<{ x: number; z: number; r: number }>; radius?: number }): Array<{ x: number; y: number; z: number }>;
}
export function createWater(o?: { size?: number; level?: number; color?: string; opacity?: number }): THREE.Mesh;
export function createSky(o?: { top?: string; horizon?: string; radius?: number }): THREE.Mesh;
export const props: {
  tree(o?: { rng?: () => number; height?: number }): THREE.Group; rock(o?: { rng?: () => number; size?: number }): THREE.Group;
  crystal(o?: { color?: string; size?: number }): THREE.Group; cloud(o?: { rng?: () => number }): THREE.Group;
  character(o?: { body?: string; skin?: string; accent?: string }): THREE.Group & { userData: { parts: { animate(t: number, speed?: number): void } } };
};

export class Particles3D extends Entity3D {
  constructor(o?: { max?: number; size?: number; gravity?: number; texture?: THREE.Texture | null });
  burst(at: THREE.Vector3 | Entity3D, o?: { count?: number; color?: string; colors?: string[]; speed?: number; spread?: number; up?: number; life?: number; gravity?: number | null }): void;
}
export function extendAssets(assets: Assets, o?: { GLTFLoader?: any; textureLoader?: any }): Assets & { texture(key: string, url: string): Assets; gltf(key: string, url: string): Assets };
