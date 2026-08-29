const { TextEncoder, TextDecoder } = require('util');

if (typeof global.TextEncoder === 'undefined') {
  global.TextEncoder = TextEncoder;
}
if (typeof global.TextDecoder === 'undefined') {
  global.TextDecoder = TextDecoder;
}

if (typeof global.Request === 'undefined') {
  global.Request = globalThis.Request;
}
if (typeof global.Response === 'undefined') {
  global.Response = globalThis.Response;
}
if (typeof global.Headers === 'undefined') {
  global.Headers = globalThis.Headers;
}
if (typeof global.fetch === 'undefined') {
  global.fetch = globalThis.fetch;
}
