import { StaticPilotBidwrightClientFactory } from '@frontdesk-q/bidwright';
import { createPool, isDatabaseReady } from '@frontdesk-q/db';
import { IdempotencyCoordinator, PostgresOperationStore } from '@frontdesk-q/idempotency';
import { OfferingSearchService } from '@frontdesk-q/offerings';
import { PostgresPriceBookRepository, PriceResolutionService } from '@frontdesk-q/pricing';
import { PostgresQuoteRepository, QuotePreparationService } from '@frontdesk-q/quotes';
import { PostgresTenantRepository } from '@frontdesk-q/tenant';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { registerOperatorRoutes } from './routes/operator-routes.js';
import { registerPricingRoutes } from './routes/pricing-routes.js';
import { registerQuoteRoutes } from './routes/quote-routes.js';
import { registerDograhRoutes } from './routes/dograh-routes.js';

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const tenantRepository = new PostgresTenantRepository(pool);
const priceBooks = new PostgresPriceBookRepository(pool);
const quotes = new PostgresQuoteRepository(pool);
const idempotency = new IdempotencyCoordinator(new PostgresOperationStore(pool));

const bidwright = new StaticPilotBidwrightClientFactory(config.BRIDGE_PILOT_TENANT_ID, {
  ...(config.BIDWRIGHT_BASE_URL ? { baseUrl: config.BIDWRIGHT_BASE_URL } : {}),
  ...(config.BIDWRIGHT_SERVICE_EMAIL ? { email: config.BIDWRIGHT_SERVICE_EMAIL } : {}),
  ...(config.BIDWRIGHT_SERVICE_PASSWORD ? { password: config.BIDWRIGHT_SERVICE_PASSWORD } : {}),
  ...(config.BIDWRIGHT_ORG_SLUG ? { orgSlug: config.BIDWRIGHT_ORG_SLUG } : {}),
  ...(config.BIDWRIGHT_EXPECTED_ORG_ID
    ? { expectedOrganizationId: config.BIDWRIGHT_EXPECTED_ORG_ID }
    : {}),
  timeoutMs: config.BIDWRIGHT_TIMEOUT_MS,
});

const offerings = new OfferingSearchService(priceBooks);
const prices = new PriceResolutionService(priceBooks, bidwright as any);
const prepare = new QuotePreparationService(
  quotes,
  priceBooks,
  prices,
  bidwright as any,
  bidwright as any,
  idempotency,
);

const app = buildApp({
  tenantRepository,
  bridgeTokenPepper: config.BRIDGE_TOKEN_PEPPER,
  requireTenantHeader: config.BRIDGE_REQUIRE_TENANT_HEADER,
  readinessCheck: () => isDatabaseReady(pool),
});

registerPricingRoutes(app, { offerings, prices });
registerQuoteRoutes(app, { repository: quotes, prepare, idempotency, provider: bidwright as any });
registerDograhRoutes(app, { repository: quotes, prepare, offerings, prices, idempotency });
registerOperatorRoutes(app, pool, {
  appEnv: config.APP_ENV,
  bridgePort: config.PORT,
  ...(config.BIDWRIGHT_BASE_URL ? { bidwrightBaseUrl: config.BIDWRIGHT_BASE_URL } : {}),
});

let closing = false;

async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, 'Graceful shutdown started');
  try {
    await app.close();
    await pool.end();
    process.exit(0);
  } catch (error) {
    app.log.error({ err: error }, 'Graceful shutdown failed');
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  app.log.error({ err: error }, 'Bridge startup failed');
  await pool.end().catch(() => undefined);
  process.exit(1);
}

