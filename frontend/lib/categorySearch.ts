import { CATEGORY_SEARCH_RESULT_LIMIT } from './constants';
import type { CategorySearchResult } from './types';

/**
 * Finds the categories that match a search, in display order.
 *
 * Every word of the query must appear in a category, ignoring case, so "pump cent" finds
 * "Centrifugal Pumps". A category that starts with the whole query is listed first. An empty
 * query matches every category. At most `limit` categories come back in `shown`, and `total`
 * counts every match.
 */
export function searchCategoryOptions(
  options: readonly string[],
  query: string,
  limit = CATEGORY_SEARCH_RESULT_LIMIT
): CategorySearchResult {
  const phrase = query.trim().toLowerCase().split(/\s+/).filter(Boolean).join(' ');
  const words = phrase === '' ? [] : phrase.split(' ');

  const matches = options
    .map((option, index) => {
      const text = option.toLowerCase();
      return {
        option,
        index,
        matched: words.every((word) => text.includes(word)),
        startsWithPhrase: phrase !== '' && text.startsWith(phrase),
      };
    })
    .filter((entry) => entry.matched)
    .sort((a, b) => Number(b.startsWithPhrase) - Number(a.startsWithPhrase) || a.index - b.index)
    .map((entry) => entry.option);

  return { shown: matches.slice(0, limit), total: matches.length };
}
