import type { PricingProviderClientFactory } from './provider.js';
import { AppError } from '@frontdesk-q/contracts';
import type { RateSchedule } from '@frontdesk-q/bidwright';
import type { PriceBookRepository } from './repository.js';

export interface SnapshotResult {
  snapshotScheduleId: string;
  serviceRateItemIdsByCode: Record<string, string>;
  serviceTierIdsByCode: Record<string, string>;
}

export async function snapshotServiceRateBook(input: {
  tenantId: string;
  bridgeQuoteId: string;
  projectId: string;
  revisionId: string;
  priceBookId: string;
  requiredServiceCodes: string[];
  repository: PriceBookRepository;
  clients: PricingProviderClientFactory;
}): Promise<SnapshotResult> {
  const priceBook = await input.repository.findPriceBookById(input.tenantId, input.priceBookId);
  if (!priceBook) {
    throw new AppError('PRICE_BOOK_NOT_FOUND', 'Price book disappeared before snapshot', 422);
  }

  const client = await input.clients.forTenant(input.tenantId);
  let summaries: RateSchedule[] = await client.listRevisionRateSchedules(input.projectId);
  let candidates = summaries.filter(
    (x) =>
      x.scope === 'revision' &&
      x.sourceScheduleId === priceBook.bidwrightGlobalRateScheduleId &&
      x.revisionId === input.revisionId,
  );

  if (candidates.length === 0) {
    await client.importRateScheduleToRevision(
      input.projectId,
      priceBook.bidwrightGlobalRateScheduleId,
    );
    summaries = await client.listRevisionRateSchedules(input.projectId);
    candidates = summaries.filter(
      (x) =>
        x.scope === 'revision' &&
        x.sourceScheduleId === priceBook.bidwrightGlobalRateScheduleId &&
        x.revisionId === input.revisionId,
    );
  }

  if (candidates.length !== 1) {
    throw new AppError(
      'RATE_SNAPSHOT_FAILED',
      `Expected one revision rate snapshot, found ${candidates.length}`,
      502,
      false,
      'The current rate book could not be safely attached to the quotation.',
    );
  }

  const snapshot: RateSchedule = await client.getRateSchedule(candidates[0]!.id);
  const mapping: Record<string, string> = {};
  const tierMapping: Record<string, string> = {};
  for (const code of input.requiredServiceCodes) {
    const item = (snapshot.items ?? []).find(
      (x: any) => x.code === code || x.metadata?.canonical_code === code,
    );
    if (!item) {
      throw new AppError(
        'RATE_ITEM_NOT_FOUND',
        `Revision snapshot item not found for ${code}`,
        422,
        false,
        'A required service rate could not be found.',
      );
    }
    mapping[code] = item.id;
    const matchingTiers = (snapshot.tiers ?? []).filter(
      (tier: any) =>
        String(tier.uom ?? '')
          .trim()
          .toUpperCase() ===
        String(item.unit ?? '')
          .trim()
          .toUpperCase(),
    );
    if (matchingTiers.length !== 1) {
      throw new AppError(
        'RATE_ITEM_NOT_FOUND',
        `Expected one revision tier for ${code} (${item.unit ?? 'unknown uom'}), found ${matchingTiers.length}`,
        422,
        false,
        'A required service rate tier could not be found.',
      );
    }
    tierMapping[code] = String(matchingTiers[0]!.id);
  }

  await input.repository.saveSnapshot({
    tenantId: input.tenantId,
    priceBookId: priceBook.id,
    bridgeQuoteId: input.bridgeQuoteId,
    bidwrightProjectId: input.projectId,
    bidwrightRevisionId: input.revisionId,
    bidwrightSnapshotScheduleId: snapshot.id,
    snapshotMapping: mapping,
  });

  return {
    snapshotScheduleId: snapshot.id,
    serviceRateItemIdsByCode: mapping,
    serviceTierIdsByCode: tierMapping,
  };
}
