export * from 'nevb';
import type { App, Context } from 'nevb';

export interface NevConfig {
  title?: string; titleTemplate?: string; lang?: string;
  head?: { meta?: Record<string, any>[]; links?: Record<string, any>[]; scripts?: (string | Record<string, any>)[] };
  clientDirs?: string[]; browserPackages?: string[]; port?: number; trustProxy?: boolean; maxBodySize?: number;
  setup?: (app: App) => void | Promise<void>;
  site?: string; sitemap?: boolean; robots?: false | string | { disallow?: string[] };
  sitemapPaths?: (string | { path: string; lastmod?: string | Date; changefreq?: string; priority?: number })[] | (() => Promise<any[]> | any[]);
  sitemapExclude?: string[];
  export?: { out?: string; paths?: string[] | (() => Promise<string[]> | string[]); crawl?: boolean };
}
export function defineConfig(config: NevConfig): NevConfig;
export function loadConfig(root: string, overrides?: Partial<NevConfig>): Promise<Required<NevConfig>>;
export function redirect(location: string, status?: number): Response;
export interface NevInstance { app: App; config: NevConfig; pages: any; api: any[]; importMap: Record<string, string>; root: string; dev: boolean }
export function createNev(o?: { root?: string; dev?: boolean; silent?: boolean; static?: boolean; config?: Partial<NevConfig> }): Promise<NevInstance>;
export function startServer(o?: { root?: string; dev?: boolean; port?: number; host?: string; silent?: boolean }): Promise<NevInstance & { server: import('node:http').Server; port: number }>;
export function exportSite(o?: { root?: string; out?: string; crawl?: boolean; paths?: string[]; config?: Partial<NevConfig> }): Promise<{ out: string; pages: string[]; files: number; errors: { path: string; status: number; message: string }[]; warnings: string[] }>;
export function scanPages(root: string): any;
export function scanApi(root: string): any[];
export function fileToPattern(rel: string): string;

/** A loader: in pages/blog/[slug].server.js write  export const load: Loader = (c) => ({ ... }) */
export type Loader<T = unknown> = (c: Context) => T | Response | Promise<T | Response>;
