import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createPool } from '@frontdesk-q/db';

const tenantId = process.env.TENANT_ID ?? 'tenant_hvac_pilot';
const outageBridgePort = Number(process.env.S5_OUTAGE_BRIDGE_PORT ?? 4179);
const deadBidwrightUrl = process.env.S5_DEAD_BIDWRIGHT_URL ?? 'http://127.0.0.1:4199';
const outageBridgeUrl = `http://127.0.0.1:${outageBridgePort}`;
const runId = `s5-outage-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
const evidenceDir = resolve('artifacts', 's5-dograh-hardening');

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function call(pathname, { method = 'GET', token, idempotencyKey, body } = {}) {
  const response = await fetch(`${outageBridgeUrl}${pathname}`, {
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
  const payload = text ? JSON.parse(text) : null;
  return { status: response.status, ok: response.ok, payload };
}

async function waitForBridge(child, logs) {
  const deadline = Date.now() + 60_000;
  let lastError = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Outage Bridge exited early with code ${child.exitCode}. Logs: ${logs.slice(-20).join('\n')}`);
    }
    try {
      const response = await fetch(`${outageBridgeUrl}/health`);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for outage Bridge on ${outageBridgeUrl}: ${lastError?.message ?? 'unknown'}. Logs: ${logs.slice(-30).join(' | ')}`);
}

function expect(condition, message, details) {
  if (!condition) {
    throw new Error(`${message}${details ? `: ${JSON.stringify(details)}` : ''}`);
  }
}

async function main() {
  const pepper = requireEnv('BRIDGE_TOKEN_PEPPER');
  const databaseUrl = requireEnv('DATABASE_URL');
  const token = `brg.dev.${randomBytes(24).toString('hex')}`;
  const tokenHash = createHash('sha256').update(`${pepper}:${token}`, 'utf8').digest('hex');
  const tokenId = randomUUID();
  const pool = createPool(databaseUrl);
  const logs = [];
  let child;

  try {
    await pool.query(
      `insert into bridge_api_tokens
       (id, tenant_id, name, token_hash, role, scopes, expires_at)
       values ($1,$2,$3,$4,$5,$6::jsonb,now()+interval '2 hours')`,
      [
        tokenId,
        tenantId,
        `S5 Dograh outage drill ${runId}`,
        tokenHash,
        'ai_runtime',
        JSON.stringify(['intake.write', 'offering.read', 'price.read', 'quote.read', 'quote.prepare']),
      ],
    );

    child = spawn(process.execPath, ['--env-file=.env', '--import', 'tsx', 'apps/bridge-api/src/server.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOST: '127.0.0.1',
        PORT: String(outageBridgePort),
        BIDWRIGHT_BASE_URL: deadBidwrightUrl,
        BIDWRIGHT_TIMEOUT_MS: '1500',
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    for (const stream of [child.stdout, child.stderr]) {
      stream?.on('data', (chunk) => {
        const text = String(chunk).trim();
        if (text) logs.push(...text.split(/\r?\n/).slice(-20));
        if (logs.length > 60) logs.splice(0, logs.length - 60);
      });
    }

    await waitForBridge(child, logs);

    const session = await call('/v1/dograh/session', { token });
    expect(session.status === 200 && session.payload.ok === true, 'Outage Bridge must authenticate Dograh runtime before provider failure drill', session);

    const validSearch = await call('/v1/dograh/tools/search-offerings', {
      method: 'POST',
      token,
      body: { query: '2HP inverter air conditioner installation', types: ['product', 'service'], limit: 5 },
    });
    const ac20 = validSearch.payload.items?.find((item) => item.code === 'HVAC-AC-20');
    const install20 = validSearch.payload.items?.find((item) => item.code === 'HVAC-INSTALL-20');
    expect(ac20 && install20, 'Outage drill must resolve local offerings before Bidwright outage prepare step', validSearch.payload);

    const captureKey = `dograh:${runId}:capture_intake:1`;
    const intake = await call('/v1/dograh/tools/capture-hvac-intake', {
      method: 'POST',
      token,
      idempotencyKey: captureKey,
      body: {
        workflow_id: 'dograh_hvac_quote_v1',
        workflow_run_id: runId,
        customer: { name: `Dograh Outage Caller ${runId}`, phone: '+60123456789' },
        service_intent: 'air_conditioner_installation',
        location: { city: 'Ipoh', state: 'Perak', building_type: 'residential' },
        requirements: { equipment_type: 'air_conditioner', capacity: '2HP', quantity: 2, install_required: true },
        notes: 'S5 outage drill: Bidwright intentionally unavailable during prepare quote.',
      },
    });
    expect(intake.status === 200 && intake.payload.ok === true, 'Outage drill intake must capture before prepare outage', intake);

    const prepareKey = `dograh:${runId}:prepare_quote:1`;
    const prepareBody = {
      workflow_run_id: runId,
      intake_id: intake.payload.intake_id,
      title: `Dograh Bidwright Outage Quote - ${runId}`,
      scope: 'Supply and install 2 x 2HP inverter air conditioners during a controlled Bidwright outage drill.',
      line_proposals: [
        { offering_ref: ac20.offering_ref, quantity: 2, uom: ac20.uom },
        { offering_ref: install20.offering_ref, quantity: 2, uom: install20.uom },
      ],
    };

    const firstPrepare = await call('/v1/dograh/tools/prepare-quote', {
      method: 'POST',
      token,
      idempotencyKey: prepareKey,
      body: prepareBody,
    });

    expect(firstPrepare.status >= 400, 'Bidwright outage prepare must not return a successful quote', firstPrepare);
    expect(
      ['UPSTREAM_STATE_UNKNOWN', 'BIDWRIGHT_UNAVAILABLE', 'BIDWRIGHT_TIMEOUT'].includes(firstPrepare.payload.error?.code),
      'Bidwright outage prepare must surface a retryable upstream/provider error',
      firstPrepare.payload,
    );

    const opResult = await pool.query(
      `select id,status,current_step,bridge_resource_id,bidwright_project_id,bidwright_quote_id,
              bidwright_revision_id,last_error_code,attempt_count
       from bridge_operations
       where tenant_id=$1 and idempotency_key=$2`,
      [tenantId, prepareKey],
    );
    const operation = opResult.rows[0];
    expect(operation, 'Prepare operation must be recorded for reconciliation', { prepareKey });
    expect(operation.status === 'upstream_unknown', 'Prepare operation must be marked upstream_unknown after provider outage', operation);
    expect(!operation.bidwright_project_id && !operation.bidwright_quote_id && !operation.bidwright_revision_id, 'No authoritative Bidwright references should be stored after failed provider create', operation);

    const quoteResult = await pool.query(
      `select id,status,quote_number,bidwright_project_id,bidwright_quote_id,bidwright_revision_id,grand_total
       from bridge_quotes
       where tenant_id=$1 and id=$2`,
      [tenantId, operation.bridge_resource_id],
    );
    const quote = quoteResult.rows[0];
    expect(quote?.status === 'upstream_unknown', 'Bridge quote shell must be visibly marked upstream_unknown', quote);
    expect(!quote.bidwright_project_id && !quote.bidwright_quote_id && !quote.bidwright_revision_id, 'Quote shell must not pretend to have Bidwright authority during outage', quote);
    expect(quote.grand_total === null, 'Quote shell must not expose a grand total during outage', quote);

    const differentBodyConflict = await call('/v1/dograh/tools/prepare-quote', {
      method: 'POST',
      token,
      idempotencyKey: prepareKey,
      body: { ...prepareBody, title: `${prepareBody.title} changed` },
    });
    expect(differentBodyConflict.status === 409 && differentBodyConflict.payload.error?.code === 'IDEMPOTENCY_KEY_REUSED', 'Changed retry body must be rejected by idempotency key conflict', differentBodyConflict);

    const evidence = {
      ok: true,
      runId,
      tenantId,
      tokenId,
      outage_bridge_url: outageBridgeUrl,
      dead_bidwright_url: deadBidwrightUrl,
      session: {
        status: session.payload.status,
        pinned_version: session.payload.pinned_version,
        authority: session.payload.authority,
      },
      first_prepare: {
        status: firstPrepare.status,
        code: firstPrepare.payload.error?.code,
        retryable: firstPrepare.payload.error?.retryable,
        user_safe_message: firstPrepare.payload.error?.user_safe_message,
      },
      operation,
      quote,
      idempotency_conflict_check: {
        status: differentBodyConflict.status,
        code: differentBodyConflict.payload.error?.code,
      },
      passed_controls: [
        'Dograh runtime authenticated before drill',
        'Offering search and intake capture still work without Bidwright mutation',
        'Prepare quote fails closed when Bidwright is unavailable',
        'Operation is marked upstream_unknown for reconciliation',
        'Quote shell is marked upstream_unknown with no total and no Bidwright IDs',
        'Same idempotency key with changed body is rejected',
      ],
    };

    await mkdir(evidenceDir, { recursive: true });
    const evidencePath = resolve(evidenceDir, `${runId}.json`);
    await writeFile(evidencePath, JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify({ ...evidence, evidence_path: evidencePath }, null, 2));
  } finally {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await delay(800);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    await pool.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
