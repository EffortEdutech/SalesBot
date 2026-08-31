import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createPool } from '@frontdesk-q/db';
import { StaticPilotBidwrightClientFactory } from '@frontdesk-q/bidwright';
import {
  parsePriceBookCsv,
  PostgresPriceBookRepository,
  provisionTenantPriceBook,
} from '@frontdesk-q/pricing';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

const tenantId = required('BRIDGE_PILOT_TENANT_ID');
const databaseUrl = required('DATABASE_URL');
const csvPath = process.env.HVAC_PILOT_CSV ?? 'data/hvac-pilot-pricebook.csv';
const csv = await readFile(csvPath, 'utf8');
const sourceSha256 = createHash('sha256').update(csv, 'utf8').digest('hex');

const pool = createPool(databaseUrl);
try {
  const tenant = await pool.query(
    'select id from bridge_organizations where id = $1 and status = $2 limit 1',
    [tenantId, 'active'],
  );
  if (!tenant.rows[0]) throw new Error(`Active Bridge tenant not found: ${tenantId}`);

  const clients = new StaticPilotBidwrightClientFactory(tenantId, {
    baseUrl: required('BIDWRIGHT_BASE_URL'),
    email: required('BIDWRIGHT_SERVICE_EMAIL'),
    password: required('BIDWRIGHT_SERVICE_PASSWORD'),
    ...(process.env.BIDWRIGHT_ORG_SLUG ? { orgSlug: process.env.BIDWRIGHT_ORG_SLUG } : {}),
    ...(process.env.BIDWRIGHT_EXPECTED_ORG_ID
      ? { expectedOrganizationId: process.env.BIDWRIGHT_EXPECTED_ORG_ID }
      : {}),
    timeoutMs: Number(process.env.BIDWRIGHT_TIMEOUT_MS ?? 10_000),
  });

  const spec = parsePriceBookCsv(csv, {
    tenantId,
    templateId: 'hvac_my_v1',
    name: process.env.HVAC_PILOT_PRICE_BOOK_NAME ?? 'HVAC Pilot',
    currency: 'MYR',
    effectiveDate: process.env.HVAC_PILOT_EFFECTIVE_DATE ?? '2026-08-19',
    expiryDate: process.env.HVAC_PILOT_EXPIRY_DATE ?? '2027-08-18',
    sourceSha256,
  });

  const result = await provisionTenantPriceBook({
    clientFactory: clients as any,
    repository: new PostgresPriceBookRepository(pool),
    spec,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        tenant_id: tenantId,
        price_book_id: result.id,
        bidwright_catalog_id: result.bidwrightCatalogId,
        bidwright_global_rate_schedule_id: result.bidwrightGlobalRateScheduleId,
      },
      null,
      2,
    ),
  );
} finally {
  await pool.end();
}
