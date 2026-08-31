import { describe, expect, it } from 'vitest';
import { BidwrightClient } from '@frontdesk-q/bidwright';
const enabled =
  process.env.BIDWRIGHT_CONTRACT === '1' && process.env.BIDWRIGHT_CONTRACT_MUTATION === '1';
const suite = enabled ? describe : describe.skip;
function required(name: string) {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing contract-test env: ${name}`);
  return v;
}
function client() {
  return new BidwrightClient({
    baseUrl: required('BIDWRIGHT_BASE_URL'),
    email: required('BIDWRIGHT_SERVICE_EMAIL'),
    password: required('BIDWRIGHT_SERVICE_PASSWORD'),
    ...(process.env.BIDWRIGHT_ORG_SLUG ? { orgSlug: process.env.BIDWRIGHT_ORG_SLUG } : {}),
    ...(process.env.BIDWRIGHT_EXPECTED_ORG_ID
      ? { expectedOrganizationId: process.env.BIDWRIGHT_EXPECTED_ORG_ID }
      : {}),
  });
}
suite('Bidwright pinned mutation contracts', () => {
  it('exercises project/catalog/category/rate snapshot/worksheet/recalc/revision/pdf', async () => {
    const bw = client();
    await bw.authenticate();
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const categories = await bw.listEntityCategories();
    let category = categories.find(
      (c) =>
        c.enabled !== false &&
        c.itemSource === 'rate_schedule' &&
        (c.validUoms ?? []).includes('EA'),
    );
    if (!category) {
      category = await bw.createEntityCategory({
        name: `Contract HVAC Service ${suffix}`,
        entityType: `ContractHVACService${suffix.replace(/[^A-Za-z0-9]/g, '')}`,
        defaultUom: 'EA',
        validUoms: ['EA'],
        calculationType: 'tiered_rate',
        itemSource: 'rate_schedule',
        enabled: true,
      });
    }
    const catalog = await bw.createCatalog({
      name: `Contract Catalog ${suffix}`,
      kind: category.entityType,
      description: 'Disposable contract-test catalog',
    });
    const catalogItem = await bw.createCatalogItem(catalog.id, {
      code: `CONTRACT-${suffix}`,
      name: `Contract HVAC Item ${suffix}`,
      unit: 'EA',
      unitCost: 100,
      unitPrice: 0,
      category: category.name,
      metadata: { contract_test: true },
    });
    const schedule = await bw.createRateSchedule({
      name: `Contract Rate Book ${suffix}`,
      category: category.entityType,
      defaultMarkup: 0,
      autoCalculate: false,
      effectiveDate: '2026-01-01',
      expiryDate: '2027-12-31',
      metadata: { contract_test: true },
    });
    const tier = await bw.createRateScheduleTier(schedule.id, {
      name: 'Each',
      multiplier: 1,
      sortOrder: 0,
      uom: 'EA',
    });
    await bw.createRateScheduleItem(schedule.id, {
      catalogItemId: catalogItem.id,
      rates: { [tier.id]: 150 },
      costRates: {},
      metadata: { canonical_code: `CONTRACT-${suffix}` },
    });
    const created = await bw.createProject({
      name: `Contract Project ${suffix}`,
      clientName: 'Contract Test Client',
      location: 'Integration Test',
      scope: 'Disposable provider contract verification',
      creationMode: 'intake',
      isStandalone: true,
    });
    const projectId = String(created.project?.id ?? '');
    const initialRevisionId = String(created.revision?.id ?? '');
    expect(projectId).toBeTruthy();
    expect(initialRevisionId).toBeTruthy();
    await expect(bw.getProject(projectId)).resolves.toBeTruthy();
    await bw.importRateScheduleToRevision(projectId, schedule.id);
    const books = await bw.listRevisionRateSchedules(projectId);
    const summary = books.find(
      (s) => s.sourceScheduleId === schedule.id && s.revisionId === initialRevisionId,
    );
    expect(summary?.id).toBeTruthy();
    const snapshot = await bw.getRateSchedule(summary!.id);
    const snapshotItem = (snapshot.items ?? []).find(
      (i) =>
        i.metadata?.canonical_code === `CONTRACT-${suffix}` || i.catalogItemId === catalogItem.id,
    );
    const snapshotTier = (snapshot.tiers ?? []).find((t) => t.uom === 'EA') ?? snapshot.tiers?.[0];
    expect(snapshotItem?.id).toBeTruthy();
    expect(snapshotTier?.id).toBeTruthy();
    const worksheet = await bw.createWorksheet(projectId, { name: 'Contract Worksheet', order: 0 });
    const worksheetId = String((worksheet as any).id ?? (worksheet as any).worksheet?.id ?? '');
    expect(worksheetId).toBeTruthy();
    await expect(
      bw.createWorksheetItem(projectId, worksheetId, {
        categoryId: category.id,
        category: category.name,
        entityType: category.entityType,
        entityName: catalogItem.name,
        description: 'Provider contract test',
        quantity: 1,
        uom: 'EA',
        rateScheduleItemId: snapshotItem!.id,
        itemId: catalogItem.id,
        ...(snapshotTier ? { tierUnits: { [snapshotTier.id]: 1 } } : {}),
      }),
    ).resolves.toBeTruthy();
    await expect(bw.recalculateProject(projectId)).resolves.toBeTruthy();
    await expect(bw.createRevision(projectId)).resolves.toBeTruthy();
    const pdf = await bw.getMainPdf(projectId);
    expect(pdf.byteLength).toBeGreaterThan(100);
  });
});
