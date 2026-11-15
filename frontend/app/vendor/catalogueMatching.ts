import type { VendorOpportunity } from '@/lib/types';

/** The catalogue fields a product is matched on. Missing fields simply add no keywords. */
export type CatalogueMatchFields = {
  name?: string | null;
  category?: string | null;
  specs?: string | null;
};

const MIN_KEYWORD_LENGTH_EXCLUSIVE = 3;

function keywordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > MIN_KEYWORD_LENGTH_EXCLUSIVE);
}

/**
 * Whether a catalogue product matches an opportunity. A product matches when one of its name,
 * category or specification keywords appears in the opportunity's title or buyer. This is a keyword
 * match. It suggests a product to review and does not confirm that the product meets the RFQ.
 */
export function productMatchesOpportunity(product: CatalogueMatchFields, opportunity: VendorOpportunity): boolean {
  const productKeywords = keywordsOf(`${product.name ?? ''} ${product.category ?? ''} ${product.specs ?? ''}`);
  if (productKeywords.length === 0) return false;
  const opportunityText = `${opportunity.title} ${opportunity.buyer}`.toLowerCase();
  return productKeywords.some((keyword) => opportunityText.includes(keyword));
}
