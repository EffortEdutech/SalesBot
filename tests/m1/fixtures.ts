import { AppError } from '@frontdesk-q/contracts';
import {
  InMemoryPriceBookRepository,
  PriceResolutionService,
  type PricingProviderClientFactory,
} from '@frontdesk-q/pricing';
import { OfferingSearchService } from '@frontdesk-q/offerings';
import {
  InMemoryQuoteRepository,
  QuotePreparationService,
  type QuoteProviderClientFactory,
} from '@frontdesk-q/quotes';
import { IdempotencyCoordinator, InMemoryOperationStore } from '@frontdesk-q/idempotency';

export class FakeBidwright {
  createProjectCount = 0;
  createWorksheetCount = 0;
  createLineCount = 0;
  project: any = null;
  worksheets: any[] = [];
  snapshot: any = null;
  behavior: 'normal' | 'create_then_timeout' = 'normal';
  masterRateMissing = false;

  catalogItems = [
    {
      id: 'ci-ac20',
      code: 'HVAC-AC-20',
      name: 'DemoAir Inverter Split AC 2.0HP',
      unit: 'EA',
      unitCost: 1650,
      unitPrice: 2150,
    },
    {
      id: 'ci-install20',
      code: 'HVAC-INSTALL-20',
      name: 'Standard AC Installation - 2.0HP',
      unit: 'EA',
      unitCost: 320,
      unitPrice: 0,
    },
  ];

  masterSchedule() {
    return {
      id: 'rs-master',
      name: 'HVAC Pilot - Service Rates',
      category: 'HVACService',
      scope: 'global',
      effectiveDate: '2026-01-01',
      expiryDate: '2027-12-31',
      tiers: [{ id: 'tier-ea', name: 'Each', multiplier: 1, sortOrder: 0, uom: 'EA' }],
      items: [
        {
          id: 'rsi-install-master',
          catalogItemId: 'ci-install20',
          code: 'HVAC-INSTALL-20',
          name: 'Standard AC Installation - 2.0HP',
          unit: 'EA',
          rates: this.masterRateMissing ? {} : { 'tier-ea': 450 },
          metadata: { canonical_code: 'HVAC-INSTALL-20' },
        },
      ],
    };
  }

  async listCatalogItems(_catalogId: string) {
    return structuredClone(this.catalogItems);
  }

  async getRateSchedule(id: string) {
    if (id === 'rs-master') return structuredClone(this.masterSchedule());
    if (id === 'rs-snapshot' && this.snapshot) return structuredClone(this.snapshot);
    throw new Error(`UNKNOWN_SCHEDULE:${id}`);
  }

  async listRevisionRateSchedules(_projectId: string) {
    return this.snapshot
      ? [
          {
            id: 'rs-snapshot',
            name: 'Snapshot',
            category: 'HVACService',
            scope: 'revision',
            sourceScheduleId: 'rs-master',
            revisionId: 'rev-1',
          },
        ]
      : [];
  }

  async importRateScheduleToRevision(_projectId: string, _scheduleId: string) {
    this.snapshot = {
      id: 'rs-snapshot',
      name: 'Snapshot',
      category: 'HVACService',
      scope: 'revision',
      sourceScheduleId: 'rs-master',
      revisionId: 'rev-1',
      tiers: [{ id: 'tier-ea-snap', name: 'Each', multiplier: 1, sortOrder: 0, uom: 'EA' }],
      items: [
        {
          id: 'rsi-install-snap',
          catalogItemId: 'ci-install20',
          code: 'HVAC-INSTALL-20',
          name: 'Standard AC Installation - 2.0HP',
          unit: 'EA',
          rates: { 'tier-ea-snap': 450 },
          metadata: { canonical_code: 'HVAC-INSTALL-20' },
        },
      ],
    };
    return { ok: true };
  }

  async createProject(input: any) {
    this.createProjectCount += 1;
    this.project = {
      id: 'project-1',
      name: input.name,
      quote: {
        id: 'quote-upstream-1',
        quoteNumber: 'Q-M1-001',
        currentRevisionId: 'rev-1',
      },
      latestRevision: { id: 'rev-1' },
    };
    if (this.behavior === 'create_then_timeout' && this.createProjectCount === 1) {
      throw new AppError(
        'BIDWRIGHT_TIMEOUT',
        'Simulated timeout after project commit',
        504,
        true,
        'Temporary provider issue.',
      );
    }
    return {
      project: { id: 'project-1', name: input.name },
      quote: {
        id: 'quote-upstream-1',
        quoteNumber: 'Q-M1-001',
        currentRevisionId: 'rev-1',
      },
      revision: { id: 'rev-1', revisionNumber: 0 },
    };
  }

  async searchProjects(search: string) {
    if (!this.project || !String(this.project.name).includes(search)) return { projects: [] };
    return { projects: [structuredClone(this.project)] };
  }

  async getProject(_projectId: string) {
    return structuredClone(this.project);
  }

  async createWorksheet(_projectId: string, input: any) {
    this.createWorksheetCount += 1;
    const worksheet = { id: 'ws-1', name: input.name, items: [] };
    this.worksheets.push(worksheet);
    return structuredClone(worksheet);
  }

  async getWorkspace(_projectId: string) {
    return {
      project: structuredClone(this.project),
      worksheets: structuredClone(this.worksheets),
      revision: { id: 'rev-1', revisionNumber: 0 },
    };
  }

  async createWorksheetItem(_projectId: string, worksheetId: string, input: any) {
    this.createLineCount += 1;
    const worksheet = this.worksheets.find((x) => x.id === worksheetId);
    if (!worksheet) throw new Error('WORKSHEET_NOT_FOUND');
    const item = { id: `wi-${this.createLineCount}`, ...structuredClone(input) };
    worksheet.items.push(item);
    return structuredClone(item);
  }

  async recalculateProject(_projectId: string) {
    let total = 0;
    for (const worksheet of this.worksheets) {
      for (const item of worksheet.items) {
        if (item.rateScheduleItemId === 'rsi-install-snap') {
          total += item.quantity * 450;
        } else if (item.itemId === 'ci-ac20') {
          total += item.quantity * item.cost * (1 + item.markup);
        }
      }
    }
    total = Math.round((total + Number.EPSILON) * 100) / 100;
    return {
      revision: {
        id: 'rev-1',
        quoteId: 'quote-upstream-1',
        revisionNumber: 0,
        subtotal: total,
        grandTotal: total,
      },
      worksheets: structuredClone(this.worksheets),
    };
  }

  // Provisioning methods not used by M1 but included so the same fake can satisfy pricing interfaces.
  async listEntityCategories() {
    return [];
  }
  async createEntityCategory(input: any) {
    return { id: 'category-new', ...input };
  }
  async listCatalogs() {
    return [];
  }
  async createCatalog(input: any) {
    return { id: 'catalog-new', ...input };
  }
  async createCatalogItem(_id: string, input: any) {
    return { id: 'catalog-item-new', ...input };
  }
  async updateCatalogItem(_c: string, id: string, input: any) {
    return { id, ...input };
  }
  async listRateSchedules() {
    return [this.masterSchedule()];
  }
  async createRateSchedule(input: any) {
    return { id: 'rate-new', scope: 'global', ...input };
  }
  async updateRateSchedule(id: string, input: any) {
    return { id, scope: 'global', ...input };
  }
  async createRateScheduleTier(_id: string, input: any) {
    return { id: 'tier-new', ...input };
  }
  async createRateScheduleItem(_id: string, input: any) {
    return { id: 'rate-item-new', ...input };
  }
  async updateRateScheduleItem(_s: string, id: string, input: any) {
    return { id, ...input };
  }
}

export async function buildM1Fixture(
  options: {
    expired?: boolean;
    duplicate2HpProduct?: boolean;
    providerBehavior?: 'normal' | 'create_then_timeout';
    masterRateMissing?: boolean;
    operationStore?: InMemoryOperationStore;
    quoteRepository?: InMemoryQuoteRepository;
    priceBookRepository?: InMemoryPriceBookRepository;
    provider?: FakeBidwright;
    leaseMs?: number;
  } = {},
) {
  const priceBooks = options.priceBookRepository ?? new InMemoryPriceBookRepository();
  if (!priceBooks.priceBooks.length) {
    await priceBooks.savePriceBook({
      id: 'pb-1',
      tenantId: 'tenant-hvac',
      templateId: 'hvac_my_v1',
      name: 'HVAC Pilot',
      currency: 'MYR',
      status: 'active',
      effectiveDate: '2026-01-01',
      expiryDate: options.expired ? '2026-02-01' : '2027-12-31',
      bidwrightCatalogId: 'catalog-1',
      bidwrightGlobalRateScheduleId: 'rs-master',
      productCategoryId: 'cat-product',
      serviceCategoryId: 'cat-service',
    });
    await priceBooks.saveOffering({
      publicRef: 'off-ac20',
      tenantId: 'tenant-hvac',
      priceBookId: 'pb-1',
      canonicalCode: 'HVAC-AC-20',
      offeringType: 'product',
      name: 'DemoAir Inverter Split AC 2.0HP',
      aliases: ['2HP aircond', '2HP AC'],
      uom: 'EA',
      bidwrightCatalogItemId: 'ci-ac20',
      bidwrightMasterRateScheduleItemId: null,
      categoryBindingKey: 'hvac_product',
      priceDisclosure: 'quote_only',
      active: true,
    });
    await priceBooks.saveOffering({
      publicRef: 'off-install20',
      tenantId: 'tenant-hvac',
      priceBookId: 'pb-1',
      canonicalCode: 'HVAC-INSTALL-20',
      offeringType: 'service',
      name: 'Standard AC Installation - 2.0HP',
      aliases: ['install 2HP aircond', '2HP AC installation'],
      uom: 'EA',
      bidwrightCatalogItemId: 'ci-install20',
      bidwrightMasterRateScheduleItemId: 'rsi-install-master',
      categoryBindingKey: 'hvac_service',
      priceDisclosure: 'quote_only',
      active: true,
    });
    if (options.duplicate2HpProduct) {
      await priceBooks.saveOffering({
        publicRef: 'off-ac20-other',
        tenantId: 'tenant-hvac',
        priceBookId: 'pb-1',
        canonicalCode: 'HVAC-AC-20-OTHER',
        offeringType: 'product',
        name: 'OtherBrand Inverter Split AC 2.0HP',
        aliases: ['2HP aircond', '2HP AC'],
        uom: 'EA',
        bidwrightCatalogItemId: 'ci-ac20-other',
        bidwrightMasterRateScheduleItemId: null,
        categoryBindingKey: 'hvac_product',
        priceDisclosure: 'quote_only',
        active: true,
      });
    }
  }

  const quotes = options.quoteRepository ?? new InMemoryQuoteRepository();
  const intake =
    quotes.intakes[0] ??
    (await quotes.createIntake({
      tenantId: 'tenant-hvac',
      customer: { name: 'Ahmad', phone: '+60123456789' },
      sourceChannel: 'test',
      serviceIntent: 'air_conditioner_installation',
      location: { city: 'Ipoh', state: 'Perak', country: 'MY' },
      requirements: { quantity: 3, capacity: '2HP', building_type: 'office' },
    }));

  const provider = options.provider ?? new FakeBidwright();
  provider.behavior = options.providerBehavior ?? provider.behavior;
  provider.masterRateMissing = options.masterRateMissing ?? provider.masterRateMissing;

  const factory = {
    forTenant: async (_tenantId: string) => provider,
  } as PricingProviderClientFactory & QuoteProviderClientFactory;

  const operations = options.operationStore ?? new InMemoryOperationStore();
  const coordinator = new IdempotencyCoordinator(operations, options.leaseMs ?? 30_000);
  const prices = new PriceResolutionService(priceBooks, factory);
  const search = new OfferingSearchService(priceBooks);
  const prepare = new QuotePreparationService(
    quotes,
    priceBooks,
    prices,
    factory,
    factory,
    coordinator,
  );

  return {
    priceBooks,
    quotes,
    intake,
    provider,
    factory,
    operations,
    coordinator,
    prices,
    search,
    prepare,
  };
}

export function canonicalM1Request(intakeId: string) {
  return {
    intake_id: intakeId,
    title: 'Supply and installation of 3 x 2HP AC units',
    scope: 'Supply and install 3 x 2HP inverter air conditioners at an office in Ipoh.',
    line_proposals: [
      { offering_ref: 'off-ac20', quantity: 3, uom: 'EA' },
      { offering_ref: 'off-install20', quantity: 3, uom: 'EA' },
    ],
  };
}
