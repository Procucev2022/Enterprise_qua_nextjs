const { sanitizeTextForModel } = require('../src/services/documentTextSanitizer');

const REPLACEMENT = '\uFFFD';
const GRINNING_FACE = '\uD83D\uDE00'; // U+1F600, a valid surrogate pair

describe('sanitizeTextForModel', () => {
  test('leaves plain text, tabs, line feeds and carriage returns unchanged', () => {
    const text = 'Item\tQty\r\nBall bearing 6205\nTotal: 4';

    expect(sanitizeTextForModel(text)).toEqual({ text, controlCharactersRemoved: 0, loneSurrogatesReplaced: 0 });
  });

  test('removes C0 control characters other than tab, line feed and carriage return, and counts them', () => {
    const dirty = 'a\u0000b\u0007c\u001bd\u000Be\u000Cf\u000E\u001Fg';

    expect(sanitizeTextForModel(dirty)).toEqual({
      text: 'abcdefg',
      controlCharactersRemoved: 7,
      loneSurrogatesReplaced: 0,
    });
  });

  test('keeps a valid surrogate pair such as an emoji intact', () => {
    const text = `ok ${GRINNING_FACE} done`;

    expect(sanitizeTextForModel(text)).toEqual({ text, controlCharactersRemoved: 0, loneSurrogatesReplaced: 0 });
  });

  test('replaces an unpaired high surrogate and an unpaired low surrogate with U+FFFD', () => {
    const result = sanitizeTextForModel('x\uD83Dy\uDE00z');

    expect(result).toEqual({ text: `x${REPLACEMENT}y${REPLACEMENT}z`, controlCharactersRemoved: 0, loneSurrogatesReplaced: 2 });
  });

  test('replaces every unpaired low surrogate in a run of them', () => {
    const result = sanitizeTextForModel('a\uDC00\uDC01b');

    expect(result.text).toBe(`a${REPLACEMENT}${REPLACEMENT}b`);
    expect(result.loneSurrogatesReplaced).toBe(2);
  });

  test('returns the text unchanged when it is within the limit', () => {
    expect(sanitizeTextForModel('short', 10).text).toBe('short');
  });

  test('cuts to the limit and drops a high surrogate that would be left without its pair', () => {
    // "ab" + high surrogate of the emoji: a cut after code unit 3 would split the pair.
    const text = `ab${GRINNING_FACE}cd`;

    expect(sanitizeTextForModel(text, 3).text).toBe('ab');
    expect(sanitizeTextForModel(text, 4).text).toBe(`ab${GRINNING_FACE}`);
  });

  test('cuts to an empty string for a zero limit, and applies no limit when none is given', () => {
    expect(sanitizeTextForModel('anything', 0).text).toBe('');
    expect(sanitizeTextForModel('no limit here').text).toBe('no limit here');
  });

  test('reads null and undefined as empty and other values as their string form', () => {
    expect(sanitizeTextForModel(null).text).toBe('');
    expect(sanitizeTextForModel(undefined).text).toBe('');
    expect(sanitizeTextForModel(42).text).toBe('42');
  });
});
