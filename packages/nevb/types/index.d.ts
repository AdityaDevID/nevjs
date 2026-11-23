export type Handler = (c: Context, next: () => Promise<Response>) => unknown;
export type Middleware = Handler;

export interface AppOptions { trustProxy?: boolean; maxBodySize?: number; exposeErrors?: boolean; silent?: boolean }

export class HttpError extends Error {
  constructor(status?: number, message?: string, details?: unknown);
  status: number; details: unknown; expose: boolean;
}
export function abort(status: number, message?: string, details?: unknown): never;

export interface CookieOptions { maxAge?: number; expires?: Date; path?: string; domain?: string; secure?: boolean; httpOnly?: boolean; sameSite?: 'lax' | 'strict' | 'none' }

export interface SessionData { [key: string]: any; destroy(): void; regenerate(): Promise<void> }

export class Context {
  req: Request; env: any; app: App; url: URL; method: string; path: string;
  params: Record<string, string>; query: Record<string, string | string[]>; cookies: Record<string, string>;
  headers: Headers; ip: string;
  state: Record<string, any>; valid: { body?: any; query?: any; params?: any; [k: string]: any };
  session: SessionData;
  body<T = any>(): Promise<T>;
  header(name: string, value: string, options?: { append?: boolean }): this;
  status(code: number): this;
  setCookie(name: string, value: string, options?: CookieOptions): this;
  deleteCookie(name: string, options?: CookieOptions): this;
  json(data: unknown, status?: number, headers?: HeadersInit): Response;
  text(text: unknown, status?: number, headers?: HeadersInit): Response;
  html(html: unknown, status?: number, headers?: HeadersInit): Response;
  redirect(location: string, status?: number): Response;
  notFound(message?: string): Response;
  send(value: unknown, status?: number, headers?: HeadersInit): Response;
  sse(handler: (s: { send(data: unknown, event?: string, id?: string | number): void; close(): void; onClose(fn: () => void): void; signal?: AbortSignal }) => unknown, headers?: HeadersInit): Response;
}

export class App {
  constructor(options?: AppOptions);
  options: Required<AppOptions>;
  use(...mw: Handler[]): this;
  use(path: string, ...mw: Handler[]): this;
  on(method: string, path: string, ...handlers: Handler[]): this;
  all(path: string, ...handlers: Handler[]): this;
  get(path: string, ...handlers: Handler[]): this;
  post(path: string, ...handlers: Handler[]): this;
  put(path: string, ...handlers: Handler[]): this;
  patch(path: string, ...handlers: Handler[]): this;
  delete(path: string, ...handlers: Handler[]): this;
  options(path: string, ...handlers: Handler[]): this;
  head(path: string, ...handlers: Handler[]): this;
  route(prefix: string, sub: App): this;
  onError(fn: (err: unknown, c: Context) => unknown): this;
  notFound(fn: (c: Context) => unknown): this;
  fetch(request: Request, env?: any): Promise<Response>;
  request(pathOrUrl: string, init?: RequestInit): Promise<Response>;
  listen(port?: number, hostname?: string, callback?: (server: import('node:http').Server) => void): Promise<import('node:http').Server>;
}
export function createApp(options?: AppOptions): App;
export function createNodeHandler(app: App): (req: any, res: any) => void;
export function listen(app: App, port?: number, hostname?: string): Promise<import('node:http').Server>;

export function parseCookies(header: string | null | undefined): Record<string, string>;
export function serializeCookie(name: string, value: string, options?: CookieOptions): string;
export function mimeFor(file: string): string;
export function compile(path: string): unknown[];
export function matchSegs(segs: unknown[], parts: string[], prefix?: boolean): Record<string, string> | null;
export function splitPath(path: string): string[];

// validation
export interface Issue { path: string; message: string }
export interface Schema<T = any> {
  optional(): Schema<T | undefined>; nullable(): Schema<T | null>; default(value: T | (() => T)): Schema<T>;
  refine(fn: (value: T) => boolean | string | void, message?: string): Schema<T>;
  transform<U>(fn: (value: T) => U): Schema<U>;
  safeParse(value: unknown, options?: { coerce?: boolean }): { ok: boolean; value: T; errors: Issue[] };
  parse(value: unknown, options?: { coerce?: boolean }): T;
}
export const v: {
  string(o?: { min?: number; max?: number; pattern?: RegExp; email?: boolean; trim?: boolean }): Schema<string>;
  number(o?: { min?: number; max?: number; int?: boolean }): Schema<number>;
  boolean(): Schema<boolean>;
  enum<T extends string | number>(values: readonly T[]): Schema<T>;
  array<T>(item: Schema<T>, o?: { min?: number; max?: number }): Schema<T[]>;
  object<S extends Record<string, Schema>>(shape: S, o?: { strict?: boolean }): Schema<{ [K in keyof S]: S[K] extends Schema<infer T> ? T : never }>;
  any(): Schema<any>;
  literal<T extends string | number | boolean | null>(value: T): Schema<T>;
  union<T extends Schema[]>(options: T): Schema<T[number] extends Schema<infer U> ? U : never>;
  record<T>(item: Schema<T>): Schema<Record<string, T>>;
  tuple<T extends Schema[]>(items: [...T]): Schema<{ [K in keyof T]: T[K] extends Schema<infer U> ? U : never }>;
  date(o?: { min?: Date | string | number; max?: Date | string | number }): Schema<Date>;
  url(o?: { protocols?: string[] }): Schema<string>;
  uuid(): Schema<string>;
};
export function validate(schemas: { body?: Schema; query?: Schema; params?: Schema }): Handler;

// middleware
export function logger(options?: any): Handler;
export function cors(options?: { origin?: string | string[] | ((o: string) => boolean); methods?: string[]; headers?: string[]; credentials?: boolean; maxAge?: number }): Handler;
export function rateLimit(options?: { windowMs?: number; max?: number; keyGenerator?: (c: Context) => string; message?: string }): Handler;
export function secureHeaders(options?: Record<string, any>): Handler;
export function serveStatic(options: { root: string; prefix?: string; index?: string | false; maxAge?: number; filter?: (rel: string) => boolean }): Handler;
export function compress(options?: { threshold?: number; encodings?: ('gzip' | 'deflate')[] }): Handler;
export function csrf(options?: { origins?: string[]; allowMissing?: boolean; allowSameSite?: boolean }): Handler;
export function requestId(options?: { header?: string }): Handler;
export function basicAuth(options: { users?: Record<string, string>; verify?: (user: string, pass: string, c: Context) => boolean | Promise<boolean>; realm?: string }): Handler;
export function bearerAuth(options: { token?: string; tokens?: string[]; verify?: (token: string, c: Context) => boolean | Promise<boolean> }): Handler;
export function timeout(ms: number, message?: string): Handler;
export function cacheControl(o: { maxAge?: number; sMaxAge?: number; public?: boolean; private?: boolean; noStore?: boolean; noCache?: boolean; immutable?: boolean; staleWhileRevalidate?: number }): Handler;
export function etag(): Handler;
export function health(o?: { path?: string; check?: () => boolean | Promise<boolean> }): Handler;
export interface SessionStore { get(id: string): any; set(id: string, data: any): any; delete(id: string): any }
export class MemoryStore implements SessionStore { constructor(o?: { ttl?: number }); get(id: string): any; set(id: string, data: any): void; delete(id: string): void; readonly size: number }
export function session(options: { secret: string | string[]; name?: string; maxAge?: number; secure?: boolean; sameSite?: 'lax' | 'strict' | 'none'; path?: string; domain?: string; rolling?: boolean; store?: SessionStore }): Handler;
export function jwtAuth(options: { secret: string | string[]; key?: string; required?: boolean; cookie?: string; issuer?: string; audience?: string; getToken?: (c: Context) => string | undefined }): Handler;

// crypto
export function sign(value: string, secret: string): Promise<string>;
export function unsign(signed: string, secret: string | string[]): Promise<string | null>;
export function hmac(secret: string, data: string): Promise<string>;
export function signJWT(payload: Record<string, any>, secret: string, o?: { expiresIn?: number | string; notBefore?: number | string; issuer?: string; audience?: string; subject?: string }): Promise<string>;
export function verifyJWT<T = Record<string, any>>(token: string, secret: string | string[], o?: { issuer?: string; audience?: string; clockTolerance?: number }): Promise<T | null>;
export function hashPassword(password: string, o?: { iterations?: number }): Promise<string>;
export function verifyPassword(password: string, stored: string): Promise<boolean>;
export function randomId(bytes?: number): string;
export function safeEqual(a: string | Uint8Array, b: string | Uint8Array): boolean;
