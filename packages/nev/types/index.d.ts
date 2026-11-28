export * from '@adityadevid/nevb';
import type { App, Context } from '@adityadevid/nevb';

export interface NevConfig {
  title?: string; titleTemplate?: string; lang?: string;
  head?: { meta?: Record<string, any>[]; links?: Record<string, any>[]; scripts?: (string | Record<string, any>)[] };
  clientDirs?: string[]; browserPackages?: string[]; port?: number; trustProxy?: boolean; maxBodySize?: number;
  setup?: (app: App) => void | Promise<void>;
  site?: string; sitemap?: boolean; robots?: false | string | { disallow?: string[] };
  sitemapPaths?: (string | { path: string; lastmod?: string | Date; changefreq?: string; priority?: number })[] | (() => Promise<any[]> | any[]);
  sitemapExclude?: string[];
  redirects?: { source: string; destination: string; permanent?: boolean; statusCode?: number }[];
  headers?: { source: string; headers: Record<string, string> | { key: string; value: string }[] }[];
  trailingSlash?: 'never' | 'always' | 'ignore';
  /** Stream every page with a loader: send <head> first, body when the loader finishes (a page can opt out with `export const streaming = false`). */
  streaming?: boolean;
  /** Opt-in CSRF protection (NevB `csrf()`): when `true` (or an options object), cross-site unsafe requests to page actions and API mutations are blocked with 403. Default `false`. */
  csrf?: boolean | { origins?: string[]; allowMissing?: boolean; allowSameSite?: boolean };
  export?: { out?: string; paths?: string[] | (() => Promise<string[]> | string[]); crawl?: boolean; target?: 'netlify' | 'cloudflare' };
}
export function defineConfig(config: NevConfig): NevConfig;
export function loadConfig(root: string, overrides?: Partial<NevConfig>): Promise<Required<NevConfig>>;
export function redirect(location: string, status?: number): Response;
/** Throw from a loader/page → 404 page with a real 404 status. */
export function notFound(message?: string): never;
/** Return from a page `action` to re-render the page with a 4xx/5xx status; `data` becomes `props.actionData`. */
export function fail<T = unknown>(status?: number, data?: T): { status: number; data: T | null };
/** Web-standard handler for serverless/edge runtimes. */
export function createHandler(o?: { root?: string; dev?: boolean; config?: Partial<NevConfig> }): Promise<((request: Request, env?: any) => Promise<Response>) & { nev: NevInstance }>;
export function parseEnv(text: string, base?: Record<string, string | undefined>): Record<string, string>;
export function readEnvFiles(root: string, mode?: string): Record<string, string>;
export function loadEnv(root: string, o?: { dev?: boolean; mode?: string }): { mode: string; loaded: Record<string, string>; public: Record<string, string> };
export function publicEnvOf(source: Record<string, string | undefined>): Record<string, string>;

export interface PageHead {
  title?: string; lang?: string; description?: string; canonical?: string; icon?: string; author?: string; themeColor?: string;
  keywords?: string | string[];
  robots?: string | { index?: boolean; follow?: boolean; noarchive?: boolean; nosnippet?: boolean; noimageindex?: boolean };
  alternates?: Record<string, string>;
  openGraph?: { title?: string; description?: string; type?: string; url?: string; siteName?: string; locale?: string; image?: string | { url: string; width?: number; height?: number; alt?: string } };
  twitter?: { card?: 'summary' | 'summary_large_image' | string; title?: string; description?: string; image?: string; site?: string; creator?: string };
  jsonLd?: Record<string, any> | Record<string, any>[];
  meta?: Record<string, any>[]; links?: Record<string, any>[];
}
export function expandHead(head?: PageHead, ctx?: { origin?: string | null; url?: string; title?: string }): { meta: Record<string, any>[]; links: Record<string, any>[]; jsonLd: Record<string, any>[] };
export interface NevInstance { app: App; config: NevConfig; pages: any; api: any[]; importMap: Record<string, string>; root: string; dev: boolean }
export function createNev(o?: { root?: string; dev?: boolean; silent?: boolean; static?: boolean; config?: Partial<NevConfig> }): Promise<NevInstance>;
export function startServer(o?: { root?: string; dev?: boolean; port?: number; host?: string; silent?: boolean }): Promise<NevInstance & { server: import('node:http').Server; port: number }>;
export function exportSite(o?: { root?: string; out?: string; crawl?: boolean; paths?: string[]; target?: 'netlify' | 'cloudflare'; config?: Partial<NevConfig> }): Promise<{ out: string; pages: string[]; files: number; errors: { path: string; status: number; message: string }[]; warnings: string[] }>;
export function scanPages(root: string): any;
export function scanApi(root: string): any[];
export function fileToPattern(rel: string): string;

/** A loader: in pages/blog/[slug].server.js write  export const load: Loader = (c) => ({ ... }) */
export type Loader<T = unknown> = (c: Context) => T | Response | Promise<T | Response>;
/** In pages/x.server.js: export const action: PageAction = async (c) => { ... }  — handles POST/PUT/PATCH/DELETE to the page URL. */
export type PageAction<T = unknown> = (c: Context) => T | Response | { status: number; data: unknown } | Promise<T | Response | { status: number; data: unknown }>;
/** In pages/x.server.js: export const staticPaths: StaticPaths = () => [{ slug: 'a' }]  — URLs for `nev export` and sitemap.xml. */
export type StaticPaths = () => (Record<string, string | number> | string)[] | Promise<(Record<string, string | number> | string)[]>;

export function buildVercel(o?: { root?: string; out?: string; nodeVersion?: string; config?: Partial<NevConfig> }): Promise<{ out: string; static: number; appFiles: number; packages: string[]; warnings: string[] }>;

/** Netlify build: publish/ + functions/nev/ + netlify.toml (default out: .nev/netlify). */
export function buildNetlify(o?: { root?: string; out?: string; config?: Partial<NevConfig> }): Promise<{ out: string; static: number; appFiles: number; packages: string[]; warnings: string[] }>;
/** Contents of the `_redirects` / `_headers` files (Netlify and Cloudflare Pages) generated from the config. */
export function redirectsFile(config: Partial<NevConfig>): string;
export function headersFile(config: Partial<NevConfig>): string;
