import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createPool } from '@frontdesk-q/db';

const tenantId = 'tenant_hvac_pilot';
const bridgeUrl = process.env.BRIDGE_URL ?? 'http://127.0.0.1:4170';
const runId = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function call(pathname, { method = 'GET', token, idempotencyKey, body, expectFailure = false } = {}) {
  const response = await fetch(`${bridgeUrl}${pathname}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'x-tenant-id': tenantId,
      ...(idempotencyKey ? { 'x-idempotency-key': idempotencyKey } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!expectFailure && (!response.ok || payload.ok === false)) {
    throw new Error(`${method} ${pathname} failed ${response.status}: ${JSON.stringify(payload)}`);
  }
  return { status: response.status, payload };
}

async function main() {
  const pepper = requireEnv('BRIDGE_TOKEN_PEPPER');
  const databaseUrl = requireEnv('DATABASE_URL');
  const token = `brg.dev.${randomBytes(24).toString('hex')}`;
  const tokenHash = createHash('sha256').update(`${pepper}:${token}`, 'utf8').digest('hex');
  const tokenId = randomUUID();
  const pool = createPool(databaseUrl);

  try {
    await pool.query(
      `insert into bridge_api_tokens
       (id, tenant_id, name, token_hash, role, scopes, expires_at)
       values ($1,$2,$3,$4,$5,$6::jsonb,now()+interval '2 hours')`,
      [
        tokenId,
        tenantId,
        `S5 Dograh voice UAT runtime ${runId}`,
        tokenHash,
        'ai_runtime',
        JSON.stringify(['intake.write', 'offering.read', 'price.read', 'quote.read', 'quote.prepare']),
      ],
    );

    await pool.query(
      `insert into bridge_connections
       (tenant_id, provider, base_url, credential_reference, service_user_reference, provider_version, status, last_verified_at)
       values ($1,'dograh',$2,$3,$4,$5,'active',now())
       on conflict (tenant_id, provider) do update set
         base_url=excluded.base_url,
         credential_reference=excluded.credential_reference,
         service_user_reference=excluded.service_user_reference,
         provider_version=excluded.provider_version,
         status='active',
         last_verified_at=now(),
         updated_at=now()`,
      [tenantId, bridgeUrl, `bridge_api_tokens:${tokenId}`, 'ai_runtime', 's5-bridge-http-tools-v1'],
    );

    const session = (await call('/v1/dograh/session', { token })).payload;
    const tools = (await call('/v1/dograh/tools', { token })).payload;

    const productSearch = (await call('/v1/dograh/tools/search-offerings', {
      method: 'POST',
      token,
      body: { query: '2HP inverter air conditioner', types: ['product'], limit: 5 },
    })).payload;
    const serviceSearch = (await call('/v1/dograh/tools/search-offerings', {
      method: 'POST',
      token,
      body: { query: 'install 2HP air conditioner', types: ['service'], limit: 5 },
    })).payload;

    const ac20 = productSearch.items.find((item) => item.code === 'HVAC-AC-20') ?? productSearch.items[0];
    const install20 = serviceSearch.items.find((item) => item.code === 'HVAC-INSTALL-20') ?? serviceSearch.items[0];
    if (!ac20 || !install20) throw new Error(`Dograh offering search failed: ${JSON.stringify({ productSearch, serviceSearch })}`);

    const intake = (await call('/v1/dograh/tools/capture-hvac-intake', {
      method: 'POST',
      token,
      idempotencyKey: `s5-dograh-${runId}-intake`,
      body: {
        workflow_id: 'dograh_hvac_quote_v1',
        workflow_run_id: `dograh-run-${runId}`,
        customer: { name: `Ahmad S5 Dograh UAT ${runId}`, phone: '+60123456789' },
        service_intent: 'air_conditioner_installation',
        location: { city: 'Ipoh', state: 'Perak', building_type: 'office' },
        requirements: { equipment_type: 'air_conditioner', capacity: '2HP', quantity: 3, install_required: true },
        notes: 'S5 Dograh voice UAT: caller asks for supply and installation of 3 x 2HP AC units.',
      },
    })).payload;

    const intakeReplay = (await call('/v1/dograh/tools/capture-hvac-intake', {
      method: 'POST',
      token,
      idempotencyKey: `s5-dograh-${runId}-intake`,
      body: {
        workflow_id: 'dograh_hvac_quote_v1',
        workflow_run_id: `dograh-run-${runId}`,
        customer: { name: `Ahmad S5 Dograh UAT ${runId}`, phone: '+60123456789' },
        service_intent: 'air_conditioner_installation',
        location: { city: 'Ipoh', state: 'Perak', building_type: 'office' },
        requirements: { equipment_type: 'air_conditioner', capacity: '2HP', quantity: 3, install_required: true },
        notes: 'S5 Dograh voice UAT: caller asks for supply and installation of 3 x 2HP AC units.',
      },
    })).payload;
    if (intakeReplay.intake_id !== intake.intake_id) {
      throw new Error(`Dograh intake replay created a duplicate: ${JSON.stringify({ intake, intakeReplay })}`);
    }

    const prepared = (await call('/v1/dograh/tools/prepare-quote', {
      method: 'POST',
      token,
      idempotencyKey: `s5-dograh-${runId}-prepare`,
      body: {
        intake_id: intake.intake_id,
        title: `S5 Dograh Voice UAT - 3 x 2HP AC units - ${runId}`,
        scope: 'Supply and install 3 x 2HP inverter air conditioners at an office in Ipoh.',
        line_proposals: [
          { offering_ref: ac20.offering_ref, quantity: 3, uom: ac20.uom },
          { offering_ref: install20.offering_ref, quantity: 3, uom: install20.uom },
        ],
      },
    })).payload;

    const forbiddenApproval = await call(`/v1/quotes/${prepared.quote_id}/approve`, {
      method: 'POST',
      token,
      idempotencyKey: `s5-dograh-${runId}-forbidden-approve`,
      body: { note: 'AI runtime must not approve this quotation.' },
      expectFailure: true,
    });
    if (forbiddenApproval.status !== 403 || forbiddenApproval.payload?.error?.code !== 'FORBIDDEN') {
      throw new Error(`AI approval guard failed: ${JSON.stringify(forbiddenApproval)}`);
    }

    const after = await pool.query(
      `select q.id,q.quote_number,q.status,q.approval_status,q.currency,q.grand_total,
              q.bidwright_project_id,q.bidwright_revision_id,q.calculation_hash,
              i.source_channel,i.dograh_workflow_id,i.dograh_workflow_run_id
       from bridge_quotes q
       join bridge_intakes i on i.id=q.intake_id and i.tenant_id=q.tenant_id
       where q.tenant_id=$1 and q.id=$2`,
      [tenantId, prepared.quote_id],
    );
    const quote = after.rows[0];
    if (prepared.state !== 'pending_approval' || quote.status !== 'pending_approval') {
      throw new Error(`Voice quote did not stop at pending approval: ${JSON.stringify({ prepared, quote })}`);
    }

    console.log(JSON.stringify({
      ok: true,
      runId,
      bridgeUrl,
      tokenId,
      dograh_connection: 'active',
      session: {
        status: session.status,
        pinned_version: session.pinned_version,
        authority: session.authority,
      },
      tools: {
        tool_names: tools.tools.map((tool) => tool.name),
        forbidden_tools: tools.forbidden_tools,
      },
      offering_refs: {
        'HVAC-AC-20': ac20.offering_ref,
        'HVAC-INSTALL-20': install20.offering_ref,
      },
      intake,
      intake_replay: { intake_id: intakeReplay.intake_id, duplicate_prevented: intakeReplay.intake_id === intake.intake_id },
      prepared,
      forbidden_approval: {
        status: forbiddenApproval.status,
        code: forbiddenApproval.payload.error.code,
      },
      after: quote,
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});



