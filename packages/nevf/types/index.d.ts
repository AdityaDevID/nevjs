export interface Signal<T> { (): T; set(v: T): void; update(fn: (v: T) => T): void; peek(): T }
export type Accessor<T> = () => T;
export type MaybeAccessor<T> = T | Accessor<T>;

export function signal<T>(initial: T, options?: { equals?: (a: T, b: T) => boolean }): Signal<T>;
export function computed<T>(fn: () => T): Accessor<T>;
export function createSelector<T, K>(source: Accessor<T>, equals?: (a: T, b: K) => boolean): (key: K) => boolean;
export function memo<T>(fn: () => T, equals?: (a: T, b: T) => boolean): Accessor<T>;
export function effect(fn: () => void | (() => void)): () => void;
export function batch<T>(fn: () => T): T;
export function untrack<T>(fn: () => T): T;
export function onCleanup(fn: () => void): void;
export function onMount(fn: () => void | (() => void)): void;
export function createRoot<T>(fn: (dispose: () => void) => T): T;
export function getOwner(): unknown;
export function isSignal(v: unknown): v is Signal<unknown>;
export function isServer(): boolean;
/** Read a NEV_PUBLIC_* variable (same call in SSR and in the browser). */
export function publicEnv(key: string): string | undefined;
export function publicEnv<T>(key: string, fallback: T): string | T;
export function setPublicEnv(values: Record<string, string>): void;
export function resource<T, A extends any[] = []>(fetcher: (...a: A) => Promise<T>, o?: { initial?: T }): { data: Signal<T | undefined>; loading: Signal<boolean>; error: Signal<unknown>; refetch: (...a: A) => Promise<T> };

export interface VNode { type: any; props: Record<string, any> }
export type Child = VNode | string | number | boolean | null | undefined | (() => Child) | Child[];
export type Component<P = any> = (props: P & { children?: any }) => Child;
export const Fragment: unique symbol;
export function h(type: string | Component | typeof Fragment, props?: Record<string, any> | null, ...children: any[]): VNode;
export function render(vnode: VNode, container: Element): () => void;
export const hydrate: typeof render;
export function createRef<T = Element>(): { current: T | null };
export function isVNode(v: unknown): v is VNode;
export function classNames(v: unknown): string;
export function renderToString(vnode: VNode): string;

export const Show: Component<{ when: MaybeAccessor<any>; fallback?: Child; children?: any }>;
export const For: Component<{ each: MaybeAccessor<readonly any[] | null | undefined>; children: (item: any, index: () => number) => Child }>;
export const Switch: Component<{ fallback?: Child }>;
export const Match: Component<{ when: MaybeAccessor<any> }>;
export const ErrorBoundary: Component<{ fallback: Child | ((err: unknown, reset: () => void) => Child) }>;
export const Dynamic: Component<{ component: MaybeAccessor<string | Component | null | undefined>; [k: string]: any }>;
export const Portal: Component<{ mount?: string | Element }>;
export function lazy<P>(loader: () => Promise<{ default: Component<P> } | Component<P>>): Component<P & { fallback?: Child }> & { preload(): Promise<unknown> };

export interface Context<T> { id: symbol; defaultValue: T; Provider: Component<{ value: T }> }
export function createContext<T>(defaultValue: T): Context<T>;
export function useContext<T>(ctx: Context<T>): T;

export function createStore<T extends object>(initial: T): [T, (update: Partial<T> | ((draft: T) => void | Partial<T>)) => void];
export function unwrap<T>(store: T): T;
export function snapshot<T>(store: T): T;

export function persisted<T>(key: string, initial: T, o?: { storage?: Pick<Storage, 'getItem' | 'setItem'>; sync?: boolean }): Signal<T>;
export function debounced<T>(source: MaybeAccessor<T>, ms?: number): Signal<T>;
export function throttled<T>(source: MaybeAccessor<T>, ms?: number): Signal<T>;
export function interval(fn: () => void, ms: number): () => void;
export function timeout(fn: () => void, ms: number): () => void;
export function listen(target: EventTarget | (() => EventTarget), type: string, handler: (e: any) => void, options?: AddEventListenerOptions): () => void;
export function mediaQuery(query: string): Signal<boolean>;
export function toggle(initial?: boolean): [Signal<boolean>, () => void, (v: boolean) => void];
export function previous<T>(source: MaybeAccessor<T>, initial?: T): Signal<T | undefined>;

export interface Form<V extends Record<string, any>> {
  values: Signal<V>; errors: Signal<Partial<Record<keyof V, string>>>; touched: Signal<Partial<Record<keyof V, boolean>>>;
  submitting: Signal<boolean>; submitError: Signal<unknown>; submitCount: Signal<number>;
  set<K extends keyof V>(name: K, value: V[K]): void; validateAll(): boolean; valid(): boolean; dirty(): boolean; reset(): void;
  field(name: keyof V, o?: { type?: 'checkbox' }): Record<string, any>;
  submit(event?: Event): Promise<boolean>;
}
export function createForm<V extends Record<string, any>>(o: {
  initial?: V; validate?: ((v: V) => Partial<Record<keyof V, string>> | void) | { safeParse(v: unknown, o?: any): { ok: boolean; errors: { path: string; message: string }[] } };
  validateOnChange?: boolean; onSubmit?: (v: V) => unknown;
}): Form<V>;

/** Router: `routes` defaults to [] (renders the fallback). `fallback` is the canonical not-found content/component; `notFound` is a legacy alias — when both are given, `fallback` wins. */
export const Router: Component<{ routes?: { path: string; component: Component }[]; fallback?: Child | Component; notFound?: Child | Component }>;
export const Link: Component<{ href: string; replace?: boolean; [k: string]: any }>;
export function navigate(to: string, o?: { replace?: boolean }): void;
export const location: Signal<{ pathname: string; search: string; hash: string }>;
export function useLocation(): Signal<{ pathname: string; search: string; hash: string }>;
export function useQuery(): Accessor<Record<string, string | string[]>>;
export function matchPath(pattern: string, pathname: string): Record<string, string> | null;
export function parseQuery(search: string): Record<string, string | string[]>;
export function setLocation(url: string): void;
export function sortRoutes<T extends { path: string }>(routes: T[]): T[];

/* ---------- Animate: mesin animasi (setara Anime.js) ---------- */
export type EasingFunction = (t: number) => number;
export type Easing = EasingFunction | string | [number, number, number, number];
export type AnimationTarget = Element | string | Record<string, any> | Array<Element | Record<string, any>> | NodeListOf<Element>;
export type AnimatableValue =
  | number
  | string
  | [number | string, number | string]
  | AnimationKeyframe[]
  | ((el: any, index: number, total: number) => number | string | [number | string, number | string]);
export interface AnimationKeyframe {
  to?: number | string;
  value?: number | string;
  duration?: number;
  delay?: number;
  ease?: Easing;
}
export interface AnimationParams {
  duration?: number;
  delay?: number | ((el: any, index: number, total: number) => number);
  endDelay?: number;
  ease?: Easing;
  easing?: Easing;
  loop?: boolean | number;
  alternate?: boolean;
  reversed?: boolean;
  autoplay?: boolean;
  onBegin?: (anim: Animation) => void;
  onUpdate?: (anim: Animation) => void;
  onLoop?: (anim: Animation) => void;
  onComplete?: (anim: Animation) => void;
  [prop: string]: any;
}
export interface Animation {
  targets: any[];
  /** Durasi satu iterasi (tween terpanjang, tanpa delay & loop). */
  duration: number;
  /** Durasi total termasuk delay, endDelay, dan semua loop (Infinity bila loop: true). */
  totalDuration: number;
  currentTime: number;
  progress: number;
  completed: boolean;
  finished: Promise<Animation>;
  play(): Animation;
  pause(): Animation;
  seek(ms: number): Animation;
  restart(): Animation;
  reverse(): Animation;
  cancel(): Animation;
  revert(): Animation;
}
export function animate(targets: AnimationTarget, params: AnimationParams): Animation;
export interface TimelineParams extends AnimationParams {
  targets?: never;
}
export interface Timeline {
  duration: number;
  totalDuration: number;
  currentTime: number;
  progress: number;
  completed: boolean;
  finished: Promise<Timeline>;
  add(targets: AnimationTarget, params?: AnimationParams, position?: number | string): Timeline;
  add(params: AnimationParams & { targets: AnimationTarget }, position?: number | string): Timeline;
  add(child: Animation | Timeline, position?: number | string): Timeline;
  set(targets: AnimationTarget, values: Record<string, number | string>, position?: number | string): Timeline;
  label(name: string, position?: number | string): Timeline;
  play(): Timeline;
  pause(): Timeline;
  seek(ms: number): Timeline;
  restart(): Timeline;
  reverse(): Timeline;
  cancel(): Timeline;
  revert(): Timeline;
}
export function createTimeline(params?: AnimationParams): Timeline;
export interface StaggerOptions {
  from?: 'first' | 'last' | 'center' | 'random' | number;
  start?: number;
  ease?: Easing;
  grid?: [number, number];
  axis?: 'x' | 'y';
}
export function stagger(
  value: number | [number, number],
  opts?: StaggerOptions,
): (el: any, index: number, total: number) => number;
export const easings: Record<string, EasingFunction>;
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): EasingFunction;
export function steps(n: number, mode?: 'end' | 'start'): EasingFunction;
export interface SpringParams {
  stiffness?: number;
  damping?: number;
  mass?: number;
  velocity?: number;
}
export function spring(params?: SpringParams): EasingFunction;
