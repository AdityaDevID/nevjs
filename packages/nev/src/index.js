// Nev.js — fullstack framework (server side).
//
// Use these in *.server.js files, api/ files, nev.config.js and scripts.
// Do NOT import "nev" from files under pages/ or components/ — those also run in the
// browser; import from "nevf" there.
export { createNev, startServer, redirect } from './server.js';
export { defineConfig, loadConfig } from './config.js';
export { scanPages, scanApi, fileToPattern } from './routes.js';

// Everything you need to write API handlers, re-exported from NevB.
export {
  App,
  HttpError,
  abort,
  v,
  validate,
  cors,
  logger,
  rateLimit,
  secureHeaders,
  serveStatic,
  parseCookies,
  serializeCookie,
} from 'nevb';
