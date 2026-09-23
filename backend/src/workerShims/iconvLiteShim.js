// Cloudflare Workers alias replacement for `iconv-lite`.
//
// `iconv-lite` (a transitive dep of Express's body-parser -> raw-body) breaks
// the Workers bundle: it lazily requires('stream'), and esbuild's bundling of
// that under nodejs_compat produces "require_streams(...) is not a function"
// at Worker boot. raw-body only ever calls iconv.getDecoder(encoding) for two
// methods, decoder.write(buf) and decoder.end() — exactly the shape of Node's
// built-in string_decoder module, which nodejs_compat supports natively. This
// app's HTTP APIs are JSON-only over utf-8, so the narrower charset support
// (utf-8/utf-16le/latin1/base64/hex/ascii — everything string_decoder covers)
// is not a real functional loss, just a smaller encoding list than iconv-lite
// ships for the raw Node/Render deploy.
const { StringDecoder } = require('string_decoder');

function getDecoder(encoding) {
  return new StringDecoder(encoding || 'utf8');
}

// body-parser's `read()` (via raw-body/content-type charset handling) checks
// `iconv.encodingExists(charset)` before ever calling getDecoder, to decide
// whether it can even attempt the request — a missing export here throws
// "iconv.encodingExists is not a function" on every POST/PUT with a body,
// not just non-utf-8 ones. Buffer.isEncoding() is the right proxy: it's the
// exact same encoding set string_decoder (used above) actually supports.
function encodingExists(encoding) {
  return Buffer.isEncoding(String(encoding || '').toLowerCase());
}

// body-parser's read() falls back to iconv.decode(body, encoding) once a
// whole buffer has already been read (the non-streaming path) — same
// encoding set as encodingExists/getDecoder above, via Buffer's own decoder.
function decode(buffer, encoding) {
  return buffer.toString(String(encoding || 'utf8').toLowerCase());
}

module.exports = { getDecoder, encodingExists, decode };
