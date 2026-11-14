/**
 * Makes extracted text safe to place in a model request.
 *
 * Gemini rejects a request whose text is not valid Unicode with a bare
 * `400 INVALID_ARGUMENT`, which the extractor then reports as a failed document. Two
 * things in email and document text cause that: control characters other than tab,
 * line feed and carriage return, and unpaired UTF-16 surrogates. Cutting text to a
 * length limit by code units can also split a surrogate pair, and that leaves an
 * unpaired surrogate at the end. This module removes or replaces both cases, and it
 * only cuts at a code point boundary.
 */

// C0 control characters except tab (U+0009), line feed (U+000A) and carriage return (U+000D).
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;
// A high surrogate that is not followed by a low surrogate.
const LONE_HIGH_SURROGATE_PATTERN = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g;
// A low surrogate that is not preceded by a high surrogate.
const LONE_LOW_SURROGATE_PATTERN = /(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const REPLACEMENT_CHARACTER = '\uFFFD';
const HIGH_SURROGATE_MIN = 0xd800;
const HIGH_SURROGATE_MAX = 0xdbff;

/**
 * @param {unknown} value Text to clean. Anything that is not a string is read as its string form, and null or undefined as empty.
 * @param {number} [maxChars] Longest result allowed, in UTF-16 code units. Unlimited when omitted.
 * @returns {{ text: string, controlCharactersRemoved: number, loneSurrogatesReplaced: number }}
 */
function sanitizeTextForModel(value, maxChars = Infinity) {
  const original = value === null || value === undefined ? '' : String(value);
  const withoutControls = original.replace(CONTROL_CHARACTER_PATTERN, '');
  const controlCharactersRemoved = original.length - withoutControls.length;

  let loneSurrogatesReplaced = 0;
  const repaired = withoutControls
    .replace(LONE_HIGH_SURROGATE_PATTERN, () => {
      loneSurrogatesReplaced += 1;
      return REPLACEMENT_CHARACTER;
    })
    .replace(LONE_LOW_SURROGATE_PATTERN, () => {
      loneSurrogatesReplaced += 1;
      return REPLACEMENT_CHARACTER;
    });

  let text = repaired;
  if (Number.isFinite(maxChars) && maxChars >= 0 && text.length > maxChars) {
    text = text.slice(0, maxChars);
    const lastCodeUnit = text.charCodeAt(text.length - 1);
    if (lastCodeUnit >= HIGH_SURROGATE_MIN && lastCodeUnit <= HIGH_SURROGATE_MAX) {
      text = text.slice(0, -1);
    }
  }

  return { text, controlCharactersRemoved, loneSurrogatesReplaced };
}

module.exports = { sanitizeTextForModel };
