import { describe, expect, it } from 'vitest';
import { BidwrightClient } from '@frontdesk-q/bidwright';
const enabled = process.env.BIDWRIGHT_CONTRACT === '1';
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
suite('Bidwright pinned read contracts', () => {
  it('auth login returns token/org', async () => {
    const x = await client().authenticate();
    expect(x.token.length).toBeGreaterThan(1);
    if (process.env.BIDWRIGHT_EXPECTED_ORG_ID)
      expect(x.organization?.id).toBe(process.env.BIDWRIGHT_EXPECTED_ORG_ID);
  });
  it('GET /catalogs', async () => expect(await client().listCatalogs()).toBeInstanceOf(Array));
  it('GET /entity-categories', async () =>
    expect(await client().listEntityCategories()).toBeInstanceOf(Array));
  it('GET /api/rate-schedules', async () =>
    expect(await client().listRateSchedules('global')).toBeInstanceOf(Array));
});
