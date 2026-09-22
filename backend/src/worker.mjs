// Cloudflare Workers entry point for the existing Express app.
//
// Reuses src/app.js as-is (the Express app, without .listen()) via
// httpServerHandler, which bridges Workers' fetch(request) model to a real
// Node http.Server under nodejs_compat. See src/server.js for the
// Node/Render entry point this parallels — that one stays the source of
// truth for local dev and the current Render deploy; this file is additive.
import { httpServerHandler } from 'cloudflare:node';
import app from './app.js';

const PORT = 4000;
app.listen(PORT);

export default httpServerHandler({ port: PORT });
