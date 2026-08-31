import type { PricingProviderClientFactory } from './provider.js';
import type { CatalogItem, RateSchedule } from '@frontdesk-q/bidwright';
import type { PriceBookRepository } from './repository.js';
import type { InternalResolvedPrice, RuntimePriceResult } from './types.js';
import { assertCompatibleUom, normalizeUom } from './uom.js';
import { extendedMoney } from './money.js';
import { pricingError } from './errors.js';
import { isActiveWindow } from './date-window.js';

export class PriceResolutionService {
  constructor(
    private readonly repository: PriceBookRepository,
    private readonly clients: PricingProviderClientFactory,
  ) {}

  async resolveInternal(input: {
    tenantId: string;
    offeringRef: string;
    quantity: number;
    requestedUom?: string;
    at?: Date;
  }): Promise<InternalResolvedPrice> {
    if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
      throw pricingError('PRICE_NOT_FOUND', 'Quantity must be greater than zero');
    }

    const offering = await this.repository.findOfferingByRef(input.tenantId, input.offeringRef);
    if (!offering) throw pricingError('OFFERING_NOT_FOUND');

    const priceBook = await this.repository.findActivePriceBook(input.tenantId, input.at);
    if (!priceBook) throw pricingError('PRICE_BOOK_NOT_FOUND');
    if (offering.priceBookId !== priceBook.id) {
      throw pricingError('PRICE_BOOK_NOT_ACTIVE', 'Offering belongs to a non-active price book');
    }

    const uom = input.requestedUom
      ? assertCompatibleUom(offering.uom, input.requestedUom)
      : normalizeUom(offering.uom);

    const client = await this.clients.forTenant(input.tenantId);
    const catalogItems = await client.listCatalogItems(priceBook.bidwrightCatalogId);
    const catalogItem = catalogItems.find(
      (x: CatalogItem) => x.id === offering.bidwrightCatalogItemId,
    );
    if (!catalogItem) throw pricingError('PRICE_NOT_FOUND', 'Backing catalog item is missing');

    let unitPrice: number;
    let source: 'catalog' | 'rate_schedule';

    if (offering.offeringType === 'product') {
      unitPrice = Number(catalogItem.unitPrice);
      source = 'catalog';
    } else {
      const schedule: RateSchedule = await client.getRateSchedule(
        priceBook.bidwrightGlobalRateScheduleId,
      );
      if (schedule.scope !== 'global') {
        throw pricingError('PRICE_BOOK_NOT_ACTIVE', 'Configured service schedule is not global');
      }
      if (
        schedule.effectiveDate &&
        !isActiveWindow(schedule.effectiveDate, schedule.expiryDate ?? null, input.at ?? new Date())
      ) {
        throw pricingError(
          schedule.expiryDate ? 'PRICE_BOOK_EXPIRED' : 'PRICE_BOOK_NOT_ACTIVE',
          'Bidwright service rate schedule is outside its active window',
        );
      }

      const rateItem = (schedule.items ?? []).find(
        (x: any) =>
          x.id === offering.bidwrightMasterRateScheduleItemId ||
          x.metadata?.canonical_code === offering.canonicalCode ||
          x.catalogItemId === offering.bidwrightCatalogItemId,
      );
      if (!rateItem) throw pricingError('PRICE_NOT_FOUND', 'Service rate item is missing');

      const matchingTiers = (schedule.tiers ?? []).filter(
        (tier: any) => normalizeUom(tier.uom ?? '') === uom,
      );
      if (matchingTiers.length !== 1) {
        throw pricingError(
          matchingTiers.length ? 'UNIT_MISMATCH' : 'PRICE_NOT_FOUND',
          `Expected exactly one ${uom} tier`,
        );
      }

      const rates = rateItem.rates ?? {};
      const numericRates = Object.values(rates).filter((value) => Number.isFinite(value));
      const rawRate =
        rates[matchingTiers[0]!.id] ??
        rates[schedule.id] ??
        (numericRates.length === 1 ? numericRates[0] : undefined);
      if (!Number.isFinite(rawRate)) throw pricingError('PRICE_NOT_FOUND', 'Sell rate is missing');
      unitPrice = Number(rawRate);
      source = 'rate_schedule';
    }

    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw pricingError('PRICE_NOT_FOUND', 'Resolved price is invalid');
    }

    return {
      offering,
      priceBook,
      currency: priceBook.currency,
      unitPrice,
      unitCost: Number(catalogItem.unitCost),
      quantity: input.quantity,
      extendedPrice: extendedMoney(unitPrice, input.quantity),
      uom,
      providerSource: source,
      masterRateScheduleItemId: offering.bidwrightMasterRateScheduleItemId,
    };
  }

  async resolveForRuntime(input: {
    tenantId: string;
    offeringRef: string;
    quantity: number;
    requestedUom?: string;
    at?: Date;
  }): Promise<RuntimePriceResult> {
    const resolved = await this.resolveInternal(input);
    const disclosure = resolved.offering.priceDisclosure;

    if (disclosure === 'allowed') {
      return {
        pricing_status: 'resolved',
        disclosure,
        currency: resolved.currency,
        unit_price: resolved.unitPrice,
        quantity: resolved.quantity,
        extended_price: resolved.extendedPrice,
        warnings: [],
      };
    }

    if (disclosure === 'human_only') {
      return {
        pricing_status: 'resolved',
        disclosure,
        user_safe_message: 'Our team will confirm the price for that item.',
        warnings: [],
      };
    }

    if (disclosure === 'range_only') {
      return {
        pricing_status: 'resolved',
        disclosure,
        user_safe_message: 'I can include the approved price in a formal quotation.',
        warnings: ['RANGE_NOT_CONFIGURED'],
      };
    }

    return {
      pricing_status: 'resolved',
      disclosure: 'quote_only',
      user_safe_message: 'I can include that in a formal quotation for you.',
      warnings: [],
    };
  }
}
