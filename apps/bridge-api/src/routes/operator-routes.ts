import { AppError } from '@frontdesk-q/contracts';
import type { DbPool } from '@frontdesk-q/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';

const requiredTables = [
  'bridge_api_tokens',
  'bridge_approvals',
  'bridge_audit_log',
  'bridge_connections',
  'bridge_customers',
  'bridge_deliveries',
  'bridge_events',
  'bridge_intakes',
  'bridge_offerings',
  'bridge_operations',
  'bridge_organizations',
  'bridge_quote_items',
  'bridge_quotes',
  'price_book_imports',
  'price_book_snapshots',
  'tenant_price_books',
  'tenant_template_bindings',
] as const;

const requiredColumns = [
  ['bridge_operations', 'lease_owner'],
  ['bridge_operations', 'lease_expires_at'],
  ['bridge_quotes', 'quote_number'],
  ['bridge_quotes', 'provider_correlation'],
  ['bridge_quotes', 'validation_json'],
] as const;

export interface OperatorRouteOptions {
  appEnv?: string;
  bridgePort?: number;
  bidwrightBaseUrl?: string;
  fetchImpl?: typeof fetch;
}

function humanTenant(request: FastifyRequest): string {
  const p = request.bridgePrincipal;
  if (!p) {
    throw new AppError(
      'AUTH_REQUIRED',
      'Operator authentication is required',
      401,
      false,
      'Authentication is required.',
    );
  }
  if (p.role === 'ai_runtime') {
    throw new AppError(
      'FORBIDDEN',
      'AI runtime credentials cannot access the human operator console',
      403,
      false,
      'This account does not have operator-console access.',
    );
  }
  return p.tenantId;
}

function limitOf(value: unknown, fallback = 50): number {
  const raw = typeof value === 'object' && value !== null ? Number((value as any).limit) : fallback;
  return Number.isInteger(raw) ? Math.max(1, Math.min(200, raw)) : fallback;
}

async function probeBidwright(
  baseUrl: string | undefined,
  fetchImpl: typeof fetch,
): Promise<{ configured: boolean; reachable: boolean | null; base_url: string | null }> {
  if (!baseUrl) return { configured: false, reachable: null, base_url: null };

  try {
    const response = await fetchImpl(baseUrl, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(1500),
    });
    // Any HTTP response proves that a process is reachable at the configured origin.
    // API/login contract verification remains the separate Bidwright contract-test gate.
    return { configured: true, reachable: response.status > 0, base_url: baseUrl };
  } catch {
    return { configured: true, reachable: false, base_url: baseUrl };
  }
}

export function registerOperatorRoutes(
  app: FastifyInstance,
  pool: DbPool,
  options: OperatorRouteOptions = {},
): void {
  app.get('/v1/operator/overview', async (request) => {
    const tenantId = humanTenant(request);
    const result = await pool.query(
      `select
        (select count(*)::int from bridge_intakes where tenant_id=$1 and created_at>=now()-interval '24 hours') new_intakes_24h,
        (select count(*)::int from bridge_quotes where tenant_id=$1 and status='pending_approval') pending_approval,
        (select count(*)::int from bridge_quotes where tenant_id=$1 and status='needs_review') needs_review,
        (select count(*)::int from bridge_quotes where tenant_id=$1 and status='sent' and updated_at>=now()-interval '24 hours') sent_24h,
        (select coalesce(sum(grand_total),0)::float8 from bridge_quotes where tenant_id=$1 and status='pending_approval') pending_approval_value,
        (select count(*)::int from bridge_operations where tenant_id=$1 and status='upstream_unknown') upstream_unknown`,
      [tenantId],
    );
    return result.rows[0];
  });

  app.get('/v1/operator/intakes', async (request) => {
    const tenantId = humanTenant(request);
    const limit = limitOf(request.query, 100);
    const result = await pool.query(
      `select i.id,c.name customer_name,c.phone,i.source_channel,i.service_intent,
              i.status,i.created_at
         from bridge_intakes i
         left join bridge_customers c on c.id=i.customer_id and c.tenant_id=i.tenant_id
        where i.tenant_id=$1
        order by i.created_at desc
        limit $2`,
      [tenantId, limit],
    );
    return { items: result.rows };
  });

  app.get('/v1/operator/quotes', async (request) => {
    const tenantId = humanTenant(request);
    const limit = limitOf(request.query, 100);
    const result = await pool.query(
      `select q.id,c.name customer_name,q.status,q.revision_number,q.currency,
              q.grand_total::float8 grand_total,q.bidwright_revision_id,q.updated_at
         from bridge_quotes q
         left join bridge_intakes i on i.id=q.intake_id and i.tenant_id=q.tenant_id
         left join bridge_customers c on c.id=i.customer_id and c.tenant_id=q.tenant_id
        where q.tenant_id=$1
        order by q.updated_at desc
        limit $2`,
      [tenantId, limit],
    );
    return { items: result.rows };
  });

  app.get('/v1/operator/quotes/:quoteId', async (request) => {
    const tenantId = humanTenant(request);
    const { quoteId } = request.params as { quoteId: string };
    const [quote, items, approvals, deliveries, audit] = await Promise.all([
      pool.query(
        `select q.*,c.name customer_name,c.phone customer_phone,c.email customer_email,
                i.service_intent,i.requirements_json,i.location_json,i.notes intake_notes
           from bridge_quotes q
           left join bridge_intakes i on i.id=q.intake_id and i.tenant_id=q.tenant_id
           left join bridge_customers c on c.id=i.customer_id and c.tenant_id=q.tenant_id
          where q.tenant_id=$1 and q.id=$2
          limit 1`,
        [tenantId, quoteId],
      ),
      pool.query(
        `select id,offering_ref,item_type,description,quantity::float8 quantity,uom,
                unit_price::float8 unit_price,extended_price::float8 extended_price,
                bidwright_item_id,bidwright_rate_schedule_item_id,source,created_at,updated_at
           from bridge_quote_items
          where tenant_id=$1 and quote_id=$2
          order by created_at asc`,
        [tenantId, quoteId],
      ),
      pool.query(
        `select id,bidwright_revision_id,status,requested_by,approved_by,rejected_by,
                change_request,calculation_hash,requested_at,approved_at,rejected_at,created_at
           from bridge_approvals
          where tenant_id=$1 and quote_id=$2
          order by created_at desc`,
        [tenantId, quoteId],
      ),
      pool.query(
        `select id,bidwright_revision_id,channel,recipient,pdf_sha256,status,
                provider_message_id,attempt_count,last_error,sent_at,created_at,updated_at
           from bridge_deliveries
          where tenant_id=$1 and quote_id=$2
          order by created_at desc`,
        [tenantId, quoteId],
      ),
      pool.query(
        `select actor_type,actor_id,action,resource_type,resource_id,metadata_json,created_at
           from bridge_audit_log
          where tenant_id=$1 and resource_type='quote' and resource_id=$2
          order by created_at desc
          limit 50`,
        [tenantId, quoteId],
      ),
    ]);
    const row = quote.rows[0];
    if (!row) {
      throw new AppError('QUOTE_NOT_FOUND', 'Quote was not found for this tenant', 404, false, 'The quotation could not be found.');
    }
    return {
      ok: true,
      quote: {
        id: row.id,
        quote_number: row.quote_number,
        customer_name: row.customer_name,
        customer_phone: row.customer_phone,
        customer_email: row.customer_email,
        title: row.title,
        scope: row.scope,
        status: row.status,
        approval_status: row.approval_status,
        revision_number: row.revision_number,
        currency: row.currency,
        subtotal: row.subtotal === null ? null : Number(row.subtotal),
        markup: row.markup === null ? null : Number(row.markup),
        tax: row.tax === null ? null : Number(row.tax),
        grand_total: row.grand_total === null ? null : Number(row.grand_total),
        bidwright_project_id: row.bidwright_project_id,
        bidwright_quote_id: row.bidwright_quote_id,
        bidwright_revision_id: row.bidwright_revision_id,
        bidwright_worksheet_id: row.bidwright_worksheet_id,
        bidwright_rate_schedule_snapshot_id: row.bidwright_rate_schedule_snapshot_id,
        calculation_hash: row.calculation_hash,
        validation: row.validation_json ?? {},
        service_intent: row.service_intent,
        requirements: row.requirements_json ?? {},
        location: row.location_json ?? {},
        intake_notes: row.intake_notes,
        created_at: row.created_at,
        updated_at: row.updated_at,
      },
      items: items.rows,
      approvals: approvals.rows,
      deliveries: deliveries.rows,
      audit: audit.rows,
    };
  });
  app.get('/v1/operator/operations', async (request) => {
    const tenantId = humanTenant(request);
    const limit = limitOf(request.query, 100);
    const result = await pool.query(
      `select id,operation_type,idempotency_key,status,current_step,last_error_code,
              attempt_count,updated_at
         from bridge_operations
        where tenant_id=$1
        order by updated_at desc
        limit $2`,
      [tenantId, limit],
    );
    return { items: result.rows };
  });

  app.get('/v1/operator/system', async (request) => {
    const tenantId = humanTenant(request);
    const principal = request.bridgePrincipal!;

    const [identity, priceBook, dograh, migrationTables, migrationColumns, bidwright] =
      await Promise.all([
        pool.query(
          `select
             o.id tenant_id,o.name tenant_name,o.industry,o.currency,o.timezone,o.status tenant_status,
             t.id token_id,t.name operator_name,t.role
           from bridge_organizations o
           join bridge_api_tokens t on t.tenant_id=o.id
          where o.id=$1 and t.id=$2
          limit 1`,
          [tenantId, principal.tokenId],
        ),
        pool.query(
          `select id,name,currency,status,effective_date,expiry_date,
                  (status='active' and effective_date<=current_date
                   and (expiry_date is null or expiry_date>=current_date)) is_current
             from tenant_price_books
            where tenant_id=$1
            order by
              case when status='active' and effective_date<=current_date
                     and (expiry_date is null or expiry_date>=current_date) then 0 else 1 end,
              updated_at desc
            limit 1`,
          [tenantId],
        ),
        pool.query(
          `select provider,status,last_verified_at
             from bridge_connections
            where tenant_id=$1 and provider='dograh'
            limit 1`,
          [tenantId],
        ),
        pool.query(
          `select table_name
             from information_schema.tables
            where table_schema='public'
              and table_name = any($1::text[])`,
          [requiredTables],
        ),
        pool.query(
          `select table_name,column_name
             from information_schema.columns
            where table_schema='public'
              and (table_name,column_name) in (
                ('bridge_operations','lease_owner'),
                ('bridge_operations','lease_expires_at'),
                ('bridge_quotes','quote_number'),
                ('bridge_quotes','provider_correlation'),
                ('bridge_quotes','validation_json')
              )`,
        ),
        probeBidwright(options.bidwrightBaseUrl, options.fetchImpl ?? fetch),
      ]);

    const id = identity.rows[0];
    if (!id) {
      throw new AppError(
        'OPERATOR_IDENTITY_NOT_FOUND',
        'Authenticated operator identity could not be resolved',
        500,
        false,
        'The operator session could not be resolved.',
      );
    }

    const presentTables = new Set(migrationTables.rows.map((row: any) => String(row.table_name)));
    const missingTables = requiredTables.filter((name) => !presentTables.has(name));
    const presentColumns = new Set(
      migrationColumns.rows.map((row: any) => `${row.table_name}.${row.column_name}`),
    );
    const missingColumns = requiredColumns
      .map(([table, column]) => `${table}.${column}`)
      .filter((name) => !presentColumns.has(name));
    const migrationsReady = missingTables.length === 0 && missingColumns.length === 0;

    const pb = priceBook.rows[0] ?? null;
    const priceBookActive = Boolean(pb?.is_current);

    const dograhRow = dograh.rows[0] ?? null;

    return {
      bridge: {
        status: 'connected',
        app_env: options.appEnv ?? 'development',
        port: options.bridgePort ?? 4170,
      },
      database: {
        status: 'connected',
      },
      migrations: {
        status: migrationsReady ? 'ready' : 'incomplete',
        expected_tables: requiredTables.length,
        present_tables: presentTables.size,
        missing_tables: missingTables,
        missing_columns: missingColumns,
      },
      tenant: {
        status: id.tenant_status,
        id: id.tenant_id,
        name: id.tenant_name,
        industry: id.industry,
        currency: id.currency,
        timezone: id.timezone,
      },
      operator: {
        status: 'authenticated',
        token_id: id.token_id,
        name: id.operator_name,
        role: id.role,
      },
      bidwright: {
        status: !bidwright.configured
          ? 'not_configured'
          : bidwright.reachable
            ? 'reachable'
            : 'unreachable',
        ...bidwright,
      },
      price_book: pb
        ? {
            status: priceBookActive ? 'active' : pb.status,
            id: pb.id,
            name: pb.name,
            currency: pb.currency,
            effective_date: pb.effective_date,
            expiry_date: pb.expiry_date,
          }
        : { status: 'missing' },
      dograh: dograhRow
        ? {
            status: dograhRow.status === 'active' ? 'configured' : dograhRow.status,
            last_verified_at: dograhRow.last_verified_at,
          }
        : { status: 'not_configured', last_verified_at: null },
    };
  });
}
