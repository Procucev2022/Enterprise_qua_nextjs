const iconvLiteShim = require('../src/workerShims/iconvLiteShim');

describe('iconvLiteShim (Cloudflare Workers alias for iconv-lite)', () => {
  describe('getDecoder', () => {
    test('returns a StringDecoder for the requested encoding', () => {
      const decoder = iconvLiteShim.getDecoder('utf8');
      expect(decoder.write(Buffer.from('hello'))).toBe('hello');
      expect(decoder.end()).toBe('');
    });

    test('defaults to utf8 when no encoding is given', () => {
      const decoder = iconvLiteShim.getDecoder();
      expect(decoder.write(Buffer.from('hi'))).toBe('hi');
    });
  });

  describe('encodingExists', () => {
    // body-parser's read() calls this before every JSON POST/PUT body is
    // parsed — missing it broke every write request in production
    // ("iconv.encodingExists is not a function"), not just non-utf-8 ones.
    test('reports true for encodings string_decoder actually supports', () => {
      expect(iconvLiteShim.encodingExists('utf8')).toBe(true);
      expect(iconvLiteShim.encodingExists('UTF-8')).toBe(true);
      expect(iconvLiteShim.encodingExists('latin1')).toBe(true);
      expect(iconvLiteShim.encodingExists('base64')).toBe(true);
    });

    test('reports false for an encoding Buffer does not support', () => {
      expect(iconvLiteShim.encodingExists('shift-jis')).toBe(false);
    });

    test('handles a missing/undefined encoding without throwing', () => {
      expect(iconvLiteShim.encodingExists()).toBe(false);
    });
  });

  describe('decode', () => {
    test('decodes a buffer using the requested encoding', () => {
      expect(iconvLiteShim.decode(Buffer.from('hello'), 'utf8')).toBe('hello');
    });

    test('defaults to utf8 when no encoding is given', () => {
      expect(iconvLiteShim.decode(Buffer.from('hi'))).toBe('hi');
    });
  });
});
