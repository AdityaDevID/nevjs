export interface Rectangle { x: number; y: number; w: number; h: number }
export interface Point { x: number; y: number }
export class Emitter {
  on(event: string, fn: (...a: any[]) => void): () => void; once(event: string, fn: (...a: any[]) => void): () => void;
  off(event: string, fn?: (...a: any[]) => void): void; emit(event: string, ...a: any[]): void; clear(): void;
}
export interface GameOptions { canvas?: string | HTMLCanvasElement; width?: number; height?: number; fps?: number; pixelArt?: boolean; fit?: 'contain' | 'cover' | 'none' | false; maxFrameTime?: number; maxDpr?: number; input?: Input; assets?: Assets; raf?: any; caf?: any; now?: () => number }
export class Game extends Emitter {
  constructor(o?: GameOptions);
  width: number; height: number; fps: number; scene: Scene | null; input: Input; assets: Assets; sound: Sound; tweens: Tweens; running: boolean; timeScale: number;
  setScene(scene: Scene): Scene; start(scene?: Scene): this; stop(): void; destroy(): void; step(dt?: number): void; render(): void;
}
export class Scene extends Emitter {
  constructor(props?: Record<string, any>);
  game: Game; entities: Entity[]; camera: Camera; tweens: Tweens; background: string | null; tilemap: Tilemap | null; time: number; paused: boolean;
  readonly input: Input; readonly assets: Assets; readonly width: number; readonly height: number;
  init(): void; update(dt: number): void; draw(ctx: CanvasRenderingContext2D): void; drawHud(ctx: CanvasRenderingContext2D): void; exit(): void;
  add<T extends Entity>(e: T): T; add(...e: Entity[]): Entity[]; remove(e: Entity): Entity;
  withTag(tag: string): Entity[]; first(tag: string): Entity | null; query(rect: Rectangle, tag?: string): Entity[];
  after(seconds: number, fn: (s: this) => void): () => void; every(seconds: number, fn: (s: this) => void): () => void;
  tween(target: object, props: object, options?: TweenOptions): Tween;
  moveAndCollide(e: Entity, dx: number, dy: number): { x: boolean; y: boolean; left: boolean; right: boolean; top: boolean; bottom: boolean; entity: Entity | null };
}
export class Entity extends Emitter {
  constructor(props?: Record<string, any>);
  id: number; x: number; y: number; w: number; h: number; vx: number; vy: number; rotation: number; scaleX: number; scaleY: number; alpha: number;
  visible: boolean; active: boolean; z: number; tags: Set<string>; solid: boolean; collides: boolean; screenSpace: boolean; noCull?: boolean;
  scene: Scene | null; parent: Entity | null; children: Entity[]; dead: boolean;
  cx: number; cy: number; readonly right: number; readonly bottom: number; readonly worldX: number; readonly worldY: number; readonly rect: Rectangle;
  hasTag(tag: string): boolean; addTag(...t: string[]): this; removeTag(t: string): this; add<T extends Entity>(c: T): T; remove<T extends Entity>(c: T): T; destroy(): void;
  after(s: number, fn: () => void): () => void; every(s: number, fn: () => void): () => void;
  init(): void; update(dt: number): void; draw(ctx: CanvasRenderingContext2D): void; onCollide(other: Entity): void; onDestroy(): void;
  [k: string]: any;
}
export class Rect extends Entity { color: string }
export class Circle extends Entity { color: string }
export class Label extends Entity { text: string | (() => string); color: string; font: string; align: CanvasTextAlign; baseline: CanvasTextBaseline }
export class Sprite extends Entity { play(name: string, o?: { restart?: boolean }): this; frame: number; flipX: boolean; readonly currentAnimation: string | null }
export class Camera { x: number; y: number; zoom: number; follow(e: Entity, o?: { smoothing?: number; offsetX?: number; offsetY?: number }): this; shake(power?: number, duration?: number): void; worldToScreen(x: number, y: number): Point; screenToWorld(x: number, y: number): Point; view: Rectangle; [k: string]: any }
export class Input extends Emitter {
  constructor(actions?: Record<string, string | string[]>);
  pointer: { x: number; y: number; down: boolean; pressed: boolean; released: boolean; id: number | null };
  keys: Set<string>; bind(action: string, codes: string | string[]): this;
  down(a: string): boolean; pressed(a: string): boolean; released(a: string): boolean; axis(neg: string, pos: string): number; vector(l?: string, r?: string, u?: string, d?: string): Point;
  keyDown(code: string): void; keyUp(code: string): void; pointerMove(x: number, y: number): void; pointerDown(x: number, y: number, id?: number): void; pointerUp(x?: number, y?: number): void; endFrame(): void;
}
export class Tilemap {
  constructor(o?: { tileSize?: number; data?: number[][]; solid?: number[] | ((id: number) => boolean); colors?: Record<number, string>; tileset?: any; tilesetCols?: number; x?: number; y?: number });
  static fromString(text: string, legend: Record<string, number>, options?: object): Tilemap;
  tileSize: number; cols: number; rows: number; width: number; height: number; data: number[][];
  inBounds(c: number, r: number): boolean; get(c: number, r: number): number; set(c: number, r: number, id: number): void;
  toTile(x: number, y: number): { col: number; row: number }; tileRect(c: number, r: number): Rectangle; isSolid(c: number, r: number): boolean; solidAt(x: number, y: number): boolean; rectHitsSolid(r: Rectangle): boolean;
}
export class Assets { [k: string]: any }
export class Sound { [k: string]: any }
export interface TweenOptions { duration?: number; ease?: string | ((t: number) => number); delay?: number; repeat?: number; yoyo?: boolean; onUpdate?: (t: any, p: number) => void; onComplete?: (t: any) => void }
export class Tween { stop(complete?: boolean): void; done: boolean; paused: boolean; finished: Promise<boolean> }
export class Tweens { to(target: object, props: object, o?: TweenOptions): Tween; wait(s: number): Promise<void>; update(dt: number): void; killTweensOf(t: object): void; clear(): void }
export const ease: Record<string, (t: number) => number>;

export const clamp: (v: number, lo: number, hi: number) => number;
export const lerp: (a: number, b: number, t: number) => number;
export const inverseLerp: (a: number, b: number, v: number) => number;
export const remap: (v: number, a1: number, b1: number, a2: number, b2: number) => number;
export const sign: (v: number) => number;
export const deg2rad: (d: number) => number;
export const rad2deg: (r: number) => number;
export const dist: (x1: number, y1: number, x2: number, y2: number) => number;
export function approach(value: number, target: number, step: number): number;
export const damp: (a: number, b: number, rate: number, dt: number) => number;
export function rectsOverlap(a: Rectangle, b: Rectangle): boolean;
export function pointInRect(px: number, py: number, r: Rectangle): boolean;
export function circlesOverlap(a: { x: number; y: number; r: number }, b: { x: number; y: number; r: number }): boolean;
export interface Rng { (): number; range(lo: number, hi: number): number; int(lo: number, hi: number): number; pick<T>(a: readonly T[]): T; chance(p: number): boolean }
export function createRng(seed?: number): Rng;

// vectors
export const vec: (x?: number, y?: number) => Point;
export const vadd: (a: Point, b: Point) => Point; export const vsub: (a: Point, b: Point) => Point; export const vscale: (a: Point, s: number) => Point;
export const vdot: (a: Point, b: Point) => number; export const vcross: (a: Point, b: Point) => number; export const vlen: (a: Point) => number; export const vdist: (a: Point, b: Point) => number;
export const vnorm: (a: Point) => Point; export const vrotate: (a: Point, rad: number) => Point; export const vangle: (a: Point) => number; export const vfromAngle: (rad: number, len?: number) => Point; export const vlerp: (a: Point, b: Point, t: number) => Point;
export const angleDiff: (a: number, b: number) => number; export const turnToward: (a: number, b: number, step: number) => number;
export function segmentRect(p1: Point, p2: Point, r: Rectangle): number | null;
export function circleRectOverlap(c: { x: number; y: number; r: number }, r: Rectangle): boolean;

export class ParticleEmitter extends Entity {
  constructor(props?: { rate?: number; life?: [number, number]; speed?: [number, number]; angle?: [number, number]; gravity?: number; drag?: number; size?: [number, number]; alpha?: [number, number]; colors?: string[] | ((rng: Rng) => string); shape?: 'rect' | 'circle'; max?: number; once?: boolean; emitting?: boolean; rng?: Rng; spread?: number } & Record<string, any>);
  readonly count: number; burst(n?: number, overrides?: object): this; clearParticles(): this;
}
export interface Grid { cols: number; rows: number; blocked(col: number, row: number): boolean }
export interface Cell { col: number; row: number }
export function gridFromTilemap(t: Tilemap, o?: { solidOutside?: boolean }): Grid;
export function findPath(grid: Grid, start: Cell, goal: Cell, o?: { diagonal?: boolean; cost?: (c: number, r: number) => number; maxNodes?: number; allowGoalBlocked?: boolean }): Cell[] | null;
export function pathToWorld(t: Tilemap, path: Cell[]): Point[];
export function simplifyPath(path: Cell[]): Cell[];
export function lineOfSight(grid: Grid, a: Cell, b: Cell): boolean;
export function reachable(grid: Grid, start: Cell, maxSteps?: number, o?: { diagonal?: boolean }): (Cell & { steps: number })[];
export class StateMachine<C = any> extends Emitter {
  constructor(states: Record<string, { enter?(from: string | null, ...a: any[]): void; exit?(to: string, ...a: any[]): void; update?(dt: number, time: number): void; can?(from: string | null, ...a: any[]): boolean | void }>, initial?: string, context?: C);
  current: string | null; previous: string | null; time: number; history: string[]; is(name: string): boolean; go(name: string, ...a: any[]): boolean; back(): boolean; update(dt: number): void;
}
export class Cooldown { constructor(duration?: number, o?: { ready?: boolean }); duration: number; left: number; readonly ready: boolean; readonly progress: number; update(dt: number): this; use(): boolean; reset(): void }
export class Timer extends Emitter { constructor(duration?: number, o?: { loop?: boolean; autostart?: boolean }); duration: number; loop: boolean; elapsed: number; running: boolean; done: boolean; readonly left: number; readonly progress: number; start(): this; pause(): this; reset(): this; restart(): this; update(dt: number): this }
export class Pool<T> { constructor(create: () => T, reset?: (o: T) => void, o?: { max?: number; prewarm?: number }); readonly size: number; readonly active: number; get(): T | null; release(o: T): boolean; releaseAll(): void }
export class SaveData<T extends Record<string, any> = Record<string, any>> {
  constructor(key: string, defaults?: T, o?: { storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null; version?: number; migrate?: Record<number, (old: any) => any> });
  data: T; load(): boolean; save(): boolean; get<K extends keyof T>(key: K, fallback?: T[K]): T[K]; set<K extends keyof T>(key: K, value: T[K]): boolean; reset(): void;
}
export class Button extends Entity { constructor(props?: Record<string, any>); text: string | (() => string); disabled: boolean; onClick: ((b: Button) => void) | null; hover: boolean; pressed: boolean; click(): void }
export class ProgressBar extends Entity { value: number | (() => number); max: number; readonly ratio: number }
export class Body {
  constructor(entity: Entity, o?: { gravity?: number; drag?: number; airDrag?: number; maxSpeed?: number; maxFall?: number; bounce?: number; coyote?: number; jumpBuffer?: number });
  entity: Entity; vx: number; vy: number; gravity: number; drag: number; airDrag: number; maxSpeed: number; maxFall: number; bounce: number; coyote: number; jumpBuffer: number;
  onGround: boolean; hit: { x: boolean; y: boolean; left?: boolean; right?: boolean; top?: boolean; bottom?: boolean; entity: Entity | null } | null;
  jump(power: number): boolean; cutJump(factor?: number): void; step(dt: number): { x: boolean; y: boolean; left?: boolean; right?: boolean; top?: boolean; bottom?: boolean; entity: Entity | null };
}
export function transition(game: Game, next: Scene, o?: { duration?: number; color?: string }): Promise<void>;
export class Gamepads { constructor(input: Input, o?: { deadzone?: number; getGamepads?: () => any }); poll(): this; axis(i: number): number; release(): void; rumble(duration?: number, strong?: number, weak?: number): void }
