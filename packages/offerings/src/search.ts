import type { OfferingRecord, OfferingType, PriceBookRepository } from '@frontdesk-q/pricing';
import { extractHp, normalizeSearchText, searchTokens } from './normalize.js';

export interface OfferingSearchCandidate {
  offering_ref: string;
  type: OfferingType;
  name: string;
  code: string;
  uom: string;
  match_confidence: number;
  price_disclosure: string;
}

export interface OfferingSearchResult {
  ok: true;
  query: string;
  ambiguous: boolean;
  requires_confirmation: boolean;
  items: OfferingSearchCandidate[];
}

function overlapScore(query: string, offering: OfferingRecord): number {
  const q = normalizeSearchText(query);
  const qTokens = searchTokens(query);
  const texts = [offering.name, offering.canonicalCode, ...offering.aliases].map(
    normalizeSearchText,
  );
  const allTokens = new Set(texts.flatMap(searchTokens));

  let score = 0;
  if (texts.some((text) => text === q)) score = Math.max(score, 0.98);
  if (texts.some((text) => text.includes(q) || q.includes(text))) score = Math.max(score, 0.9);

  if (qTokens.length) {
    const matched = qTokens.filter((token) => allTokens.has(token)).length;
    const recall = matched / qTokens.length;
    const precision = matched / Math.max(1, allTokens.size);
    score = Math.max(score, 0.72 * recall + 0.18 * precision);
  }

  const queryHp = extractHp(query);
  const offeringHp = extractHp(texts.join(' '));
  if (queryHp !== null && offeringHp !== null) {
    if (Math.abs(queryHp - offeringHp) < 0.001) score += 0.14;
    else score -= 0.5;
  }

  if (qTokens.includes('install')) {
    if (offering.offeringType === 'service' && allTokens.has('install')) score += 0.08;
    if (offering.offeringType === 'product') score -= 0.05;
  }

  return Math.max(0, Math.min(1, Math.round(score * 1000) / 1000));
}

export class OfferingSearchService {
  constructor(private readonly repository: PriceBookRepository) {}

  async search(input: {
    tenantId: string;
    query: string;
    types?: OfferingType[];
    limit?: number;
    at?: Date;
  }): Promise<OfferingSearchResult> {
    const activeBook = await this.repository.findActivePriceBook(input.tenantId, input.at);
    if (!activeBook) {
      return {
        ok: true,
        query: input.query,
        ambiguous: false,
        requires_confirmation: false,
        items: [],
      };
    }

    const offerings = (await this.repository.listOfferings(input.tenantId, input.types)).filter(
      (x: OfferingRecord) => x.priceBookId === activeBook.id,
    );

    const items = offerings
      .map((offering: OfferingRecord) => ({ offering, score: overlapScore(input.query, offering) }))
      .filter((x: { offering: OfferingRecord; score: number }) => x.score >= 0.28)
      .sort(
        (
          a: { offering: OfferingRecord; score: number },
          b: { offering: OfferingRecord; score: number },
        ) => b.score - a.score || a.offering.canonicalCode.localeCompare(b.offering.canonicalCode),
      )
      .slice(0, Math.min(Math.max(input.limit ?? 5, 1), 20))
      .map(({ offering, score }: { offering: OfferingRecord; score: number }) => ({
        offering_ref: offering.publicRef,
        type: offering.offeringType,
        name: offering.name,
        code: offering.canonicalCode,
        uom: offering.uom,
        match_confidence: score,
        price_disclosure: offering.priceDisclosure,
      }));

    const first = items[0]?.match_confidence ?? 0;
    const second = items[1]?.match_confidence ?? -1;
    const ambiguous = items.length > 1 && second >= 0.45 && first - second <= 0.08;

    return {
      ok: true,
      query: input.query,
      ambiguous,
      requires_confirmation: ambiguous || (items.length > 0 && first < 0.72),
      items,
    };
  }
}
