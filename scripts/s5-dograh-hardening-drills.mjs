import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPool } from '@frontdesk-q/db';

const tenantId = process.env.TENANT_ID ?? 'tenant_hvac_pilot';
const bridgeUrl = (process.env.BRIDGE_URL ?? 'http://127.0.0.1:4170').replace(/\/+$/, '');
const runId = `s5-hardening-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
const evidenceDir = resolve('artifacts', 's5-dograh-hardening');

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function call(pathname, { method = 'GET', token, idempotencyKey, body, parseJson = true } = {}) {
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
  const payload = parseJson && text ? JSON.parse(text) : text;
  return { status: response.status, ok: response.ok, payload };
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

  try {
    await pool.query(
      `insert into bridge_api_tokens
       (id, tenant_id, name, token_hash, role, scopes, expires_at)
       values ($1,$2,$3,$4,$5,$6::jsonb,now()+interval '2 hours')`,
      [
        tokenId,
        tenantId,
        `S5 Dograh hardening drills ${runId}`,
        tokenHash,
        'ai_runtime',
        JSON.stringify(['intake.write', 'offering.read', 'price.read', 'quote.read', 'quote.prepare']),
      ],
    );

    const session = await call('/v1/dograh/session', { token });
    expect(session.status === 200 && session.payload.ok === true, 'Dograh session must be available', session);
    expect(session.payload.authority.can_approve_quote === false, 'Dograh runtime must not approve quotes', session.payload.authority);
    expect(session.payload.authority.can_deliver_quote === false, 'Dograh runtime must not deliver quotes', session.payload.authority);

    const tools = await call('/v1/dograh/tools', { token });
    expect(tools.status === 200 && tools.payload.ok === true, 'Dograh tool manifest must be available', tools);
    expect(
      ['approve_quote', 'reject_quote', 'deliver_quote', 'export_pdf'].every((name) => tools.payload.forbidden_tools.includes(name)),
      'Forbidden commercial tools must be advertised as forbidden',
      tools.payload.forbidden_tools,
    );

    const incompleteIntake = await call('/v1/dograh/tools/capture-hvac-intake', {
      method: 'POST',
      token,
      idempotencyKey: `dograh:${runId}:incomplete_intake:1`,
      body: {
        workflow_id: 'dograh_hvac_quote_v1',
        workflow_run_id: `${runId}-incomplete`,
        customer: { name: 'Incomplete Dograh Caller' },
        service_intent: 'air_conditioner_installation',
        location: { city: 'Ipoh', building_type: '' },
        requirements: { equipment_type: 'air_conditioner', capacity: '', quantity: 0, install_required: true },
      },
    });
    expect(incompleteIntake.status === 422, 'Incomplete/ambiguous intake must be rejected before quote preparation', incompleteIntake);
    expect(incompleteIntake.payload.error?.code === 'VALIDATION_ERROR', 'Incomplete intake should return validation error', incompleteIntake.payload);

    const unsupportedSearch = await call('/v1/dograh/tools/search-offerings', {
      method: 'POST',
      token,
      body: { query: 'unsupported swimming pool elevator solar diesel generator bundle', types: ['product', 'service'], limit: 5 },
    });
    expect(unsupportedSearch.status === 200 && unsupportedSearch.payload.ok === true, 'Unsupported offering search should fail safely as an empty/non-authoritative result', unsupportedSearch);

    const validSearch = await call('/v1/dograh/tools/search-offerings', {
      method: 'POST',
      token,
      body: { query: '2HP inverter air conditioner installation', types: ['product', 'service'], limit: 5 },
    });
    const ac20 = validSearch.payload.items?.find((item) => item.code === 'HVAC-AC-20');
    const install20 = validSearch.payload.items?.find((item) => item.code === 'HVAC-INSTALL-20');
    expect(ac20 && install20, 'Valid HVAC offerings must resolve before quote drill', validSearch.payload);

    const intake = await call('/v1/dograh/tools/capture-hvac-intake', {
      method: 'POST',
      token,
      idempotencyKey: `dograh:${runId}:capture_intake:1`,
      body: {
        workflow_id: 'dograh_hvac_quote_v1',
        workflow_run_id: runId,
        customer: { name: `Dograh Hardening Caller ${runId}`, phone: '+60123456789' },
        service_intent: 'air_conditioner_installation',
        location: { city: 'Ipoh', state: 'Perak', building_type: 'residential' },
        requirements: { equipment_type: 'air_conditioner', capacity: '2HP', quantity: 5, install_required: true },
        notes: 'S5.1 hardening drill: web-call-like residential caller asks for 5 x 2HP AC units with installation.',
      },
    });
    expect(intake.status === 200 && intake.payload.ok === true, 'Valid Dograh intake must capture successfully', intake);

    const intakeReplay = await call('/v1/dograh/tools/capture-hvac-intake', {
      method: 'POST',
      token,
      idempotencyKey: `dograh:${runId}:capture_intake:1`,
      body: {
        workflow_id: 'dograh_hvac_quote_v1',
        workflow_run_id: runId,
        customer: { name: `Dograh Hardening Caller ${runId}`, phone: '+60123456789' },
        service_intent: 'air_conditioner_installation',
        location: { city: 'Ipoh', state: 'Perak', building_type: 'residential' },
        requirements: { equipment_type: 'air_conditioner', capacity: '2HP', quantity: 5, install_required: true },
        notes: 'S5.1 hardening drill: web-call-like residential caller asks for 5 x 2HP AC units with installation.',
      },
    });
    expect(intakeReplay.payload.intake_id === intake.payload.intake_id, 'Duplicate intake replay must not create another intake', {
      first: intake.payload.intake_id,
      replay: intakeReplay.payload.intake_id,
    });

    const badPrepare = await call('/v1/dograh/tools/prepare-quote', {
      method: 'POST',
      token,
      idempotencyKey: `dograh:${runId}:bad_prepare:1`,
      body: {
        workflow_run_id: `${runId}-bad-prepare`,
        intake_id: intake.payload.intake_id,
        title: `Unsupported Dograh Prepare Drill ${runId}`,
        scope: 'Unsupported pool/elevator package should not become a quote.',
        line_proposals: [{ offering_ref: 'unsupported-offering-ref', quantity: 1, uom: 'item' }],
      },
    });
    expect(
      (badPrepare.status >= 400 && badPrepare.payload.ok === false) ||
        (badPrepare.status === 200 &&
          badPrepare.payload.state === 'needs_review' &&
          badPrepare.payload.validation?.pricing_complete === false &&
          badPrepare.payload.validation?.blocking_reasons?.includes('OFFERING_NOT_FOUND')),
      'Unsupported or invalid offering prepare must fail closed as error or needs_review',
      badPrepare,
    );

    const prepared = await call('/v1/dograh/tools/prepare-quote', {
      method: 'POST',
      token,
      idempotencyKey: `dograh:${runId}:prepare_quote:1`,
      body: {
        workflow_run_id: runId,
        intake_id: intake.payload.intake_id,
        title: `Dograh Hardening Quote - 5 x 2HP AC units - ${runId}`,
        scope: 'Supply and install 5 x 2HP inverter air conditioners at a residential property in Ipoh.',
        line_proposals: [
          { offering_ref: ac20.offering_ref, quantity: 5, uom: ac20.uom },
          { offering_ref: install20.offering_ref, quantity: 5, uom: install20.uom },
        ],
      },
    });
    expect(prepared.status === 200 && prepared.payload.state === 'pending_approval', 'Dograh prepared quote must stop at pending_approval', prepared);
    expect(prepared.payload.approval_required === true, 'Dograh prepared quote must require human approval', prepared.payload);

    const forbiddenApproval = await call(`/v1/quotes/${prepared.payload.quote_id}/approve`, {
      method: 'POST',
      token,
      idempotencyKey: `dograh:${runId}:forbidden_approve:1`,
      body: { note: 'AI runtime must not approve this quotation.' },
    });
    const forbiddenPdf = await call(`/v1/quotes/${prepared.payload.quote_id}/pdf`, { token, parseJson: true });
    const forbiddenDelivery = await call(`/v1/quotes/${prepared.payload.quote_id}/deliver`, {
      method: 'POST',
      token,
      idempotencyKey: `dograh:${runId}:forbidden_deliver:1`,
      body: { channel: 'download', recipient: 'dograh-ai-runtime' },
    });
    for (const [name, result] of [
      ['approval', forbiddenApproval],
      ['pdf_export', forbiddenPdf],
      ['delivery', forbiddenDelivery],
    ]) {
      expect(result.status === 403 && result.payload.error?.code === 'FORBIDDEN', `AI runtime ${name} must be forbidden`, result);
    }

    const after = await pool.query(
      `select q.id,q.quote_number,q.status,q.approval_status,q.currency,q.grand_total,
              q.bidwright_revision_id,q.calculation_hash,
              i.source_channel,i.dograh_workflow_id,i.dograh_workflow_run_id
       from bridge_quotes q
       join bridge_intakes i on i.id=q.intake_id and i.tenant_id=q.tenant_id
       where q.tenant_id=$1 and q.id=$2`,
      [tenantId, prepared.payload.quote_id],
    );
    const quote = after.rows[0];
    expect(quote?.status === 'pending_approval', 'Final hardening quote must remain pending human approval', quote);

    const evidence = {
      ok: true,
      runId,
      bridgeUrl,
      tenantId,
      tokenId,
      session: {
        status: session.payload.status,
        pinned_version: session.payload.pinned_version,
        authority: session.payload.authority,
      },
      tools: {
        tool_names: tools.payload.tools.map((tool) => tool.name),
        forbidden_tools: tools.payload.forbidden_tools,
      },
      drills: {
        incomplete_intake: {
          status: incompleteIntake.status,
          code: incompleteIntake.payload.error?.code,
          passed: incompleteIntake.status === 422,
        },
        unsupported_search: {
          status: unsupportedSearch.status,
          item_count: unsupportedSearch.payload.items?.length ?? null,
          passed: unsupportedSearch.status === 200,
        },
        bad_prepare: {
          status: badPrepare.status,
          code: badPrepare.payload.error?.code ?? null,
          state: badPrepare.payload.state ?? null,
          blocking_reasons: badPrepare.payload.validation?.blocking_reasons ?? [],
          passed:
            badPrepare.status >= 400 ||
            (badPrepare.payload.state === 'needs_review' &&
              badPrepare.payload.validation?.blocking_reasons?.includes('OFFERING_NOT_FOUND')),
        },
        duplicate_replay: {
          intake_id: intakeReplay.payload.intake_id,
          duplicate_prevented: intakeReplay.payload.intake_id === intake.payload.intake_id,
        },
        forbidden_commercial_actions: {
          approval: { status: forbiddenApproval.status, code: forbiddenApproval.payload.error?.code },
          pdf_export: { status: forbiddenPdf.status, code: forbiddenPdf.payload.error?.code },
          delivery: { status: forbiddenDelivery.status, code: forbiddenDelivery.payload.error?.code },
        },
      },
      quote: {
        quote_id: prepared.payload.quote_id,
        quote_number: prepared.payload.quote_number,
        state: prepared.payload.state,
        approval_required: prepared.payload.approval_required,
        currency: prepared.payload.currency,
        grand_total: prepared.payload.grand_total,
        voice_safe_message: prepared.payload.voice_safe_message,
        persisted: quote,
      },
      remaining_manual_drills: [
        'Dograh native transfer_to_human behavior during an actual browser/phone call',
        'Controlled Bridge/Bidwright outage or timeout while Dograh is calling HTTP tools',
      ],
    };

    await mkdir(evidenceDir, { recursive: true });
    const evidencePath = resolve(evidenceDir, `${runId}.json`);
    await writeFile(evidencePath, JSON.stringify(evidence, null, 2));

    console.log(JSON.stringify({ ...evidence, evidence_path: evidencePath }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
