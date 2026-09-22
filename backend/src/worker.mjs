// Cloudflare Workers entry point for the existing Express app.
//
// Reuses src/app.js as-is (the Express app, without .listen()) via
// httpServerHandler, which bridges Workers' fetch(request) model to a real
// Node http.Server under nodejs_compat. See src/server.js for the
// Node/Render entry point this parallels — that one stays the source of
// truth for local dev and the current Render deploy; this file is additive.
import { httpServerHandler } from 'cloudflare:node';
import { env } from 'cloudflare:workers';
import app from './app.js';

// d1Bridge.js (required by the CommonJS backend, deep under app.js) cannot
// reach `env` itself: `require('cloudflare:workers')` at call time throws
// "Dynamic require of 'cloudflare:workers' is not supported" — the bundler
// only resolves cloudflare: specifiers through a static ESM import, and this
// is the only file in the backend that's real ESM. Every D1-ported query
// silently fell back to the pg pool because of this (queryD1 never ran; only
// the try/catch in getD1Binding swallowing the throw). Stashing the binding
// on globalThis here, once, lets d1Bridge.js read it synchronously without
// its own require/import of the virtual module.
globalThis.__CF_ENV__ = env;

const PORT = 4000;
app.listen(PORT);

export default httpServerHandler({ port: PORT });
