import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createPool } from '@frontdesk-q/db';

const tenantId = 'tenant_hvac_pilot';
const bridgeUrl = process.env.BRIDGE_URL ?? 'http://127.0.0.1:4170';
const runId = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function call(pathname, { method = 'GET', token, idempotencyKey, body } = {}) {
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
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/pdf')) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!response.ok) throw new Error(`${method} ${pathname} failed ${response.status}: ${bytes.toString('utf8')}`);
    return { response, bytes };
  }
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok || payload.ok === false) {
    throw new Error(`${method} ${pathname} failed ${response.status}: ${JSON.stringify(payload)}`);
  }
  return { response, payload };
}

async function main() {
  const pepper = requireEnv('BRIDGE_TOKEN_PEPPER');
  const databaseUrl = requireEnv('DATABASE_URL');
  const token = `brg.dev.${randomBytes(24).toString('hex')}`;
  const tokenHash = createHash('sha256').update(`${pepper}:${token}`, 'utf8').digest('hex');
  const pool = createPool(databaseUrl);

  try {
    const tokenId = randomUUID();
    await pool.query(
      `insert into bridge_api_tokens
       (id, tenant_id, name, token_hash, role, scopes, expires_at)
       values ($1,$2,$3,$4,$5,$6::jsonb,now()+interval '2 hours')`,
      [
        tokenId,
        tenantId,
        `S4 fresh flow UAT operator ${runId}`,
        tokenHash,
        'tenant_owner',
        JSON.stringify(['intake.write', 'quote.prepare', 'quote.approve', 'quote.deliver', 'quote.read']),
      ],
    );

    const offeringRows = await pool.query(
      `select canonical_code, public_ref
       from bridge_offerings
       where tenant_id=$1 and active=true and canonical_code = any($2::text[])`,
      [tenantId, ['HVAC-AC-20', 'HVAC-INSTALL-20']],
    );
    const offeringRefByCode = Object.fromEntries(offeringRows.rows.map((row) => [row.canonical_code, row.public_ref]));
    const ac20Ref = offeringRefByCode['HVAC-AC-20'];
    const install20Ref = offeringRefByCode['HVAC-INSTALL-20'];
    if (!ac20Ref || !install20Ref) {
      throw new Error(`Live HVAC offering refs not found: ${JSON.stringify(offeringRefByCode)}`);
    }

    const intake = (
      await call('/v1/intakes', {
        method: 'POST',
        token,
        idempotencyKey: `s4-fresh-${runId}-intake`,
        body: {
          customer: { name: `Ahmad S4 UAT ${runId}`, phone: '+60123456789' },
          service_intent: 'air_conditioner_installation',
          service: { name: '2HP AC supply and installation' },
          location: { city: 'Ipoh', state: 'Perak', country: 'MY', building_type: 'office' },
          requirements: { quantity: 3, capacity: '2HP', building_type: 'office' },
          notes: 'S4 fresh-flow UAT quote for approved-only PDF export and exact-hash download delivery.',
          source: { channel: 'uat' },
        },
      })
    ).payload;

    const prepared = (
      await call('/v1/quotes/prepare', {
        method: 'POST',
        token,
        idempotencyKey: `s4-fresh-${runId}-prepare`,
        body: {
          intake_id: intake.intake_id,
          title: `S4 UAT - Supply and installation of 3 x 2HP AC units - ${runId}`,
          scope: 'Supply and install 3 x 2HP inverter air conditioners at an office in Ipoh.',
          line_proposals: [
            { offering_ref: ac20Ref, quantity: 3, uom: 'EA' },
            { offering_ref: install20Ref, quantity: 3, uom: 'EA' },
          ],
        },
      })
    ).payload;

    const quoteId = prepared.quote_id;
    if (prepared.state !== 'pending_approval') {
      console.log(JSON.stringify({ ok: false, runId, stage: 'prepare', prepared }, null, 2));
      return;
    }
    const approval = (
      await call(`/v1/quotes/${quoteId}/approve`, {
        method: 'POST',
        token,
        idempotencyKey: `s4-fresh-${runId}-approve`,
        body: { note: 'Human operator UAT approval before PDF export and download delivery.' },
      })
    ).payload;

    const pdf = await call(`/v1/quotes/${quoteId}/pdf`, { token });
    const pdfBytes = pdf.bytes;
    if (!pdfBytes.subarray(0, 4).equals(Buffer.from('%PDF'))) {
      throw new Error(`PDF export did not return a PDF; first bytes=${pdfBytes.subarray(0, 16).toString('hex')}`);
    }
    const pdfSha256 = createHash('sha256').update(pdfBytes).digest('hex');
    const outDir = path.resolve('artifacts', 's4-uat');
    await mkdir(outDir, { recursive: true });
    const outFile = path.join(outDir, `${prepared.quote_number}-fresh-approved.pdf`);
    await writeFile(outFile, pdfBytes);
    const saved = await readFile(outFile);

    const operatorDetailBeforeDelivery = (
      await call('/v1/operator/quotes/' + quoteId, { token })
    ).payload;

    const delivery = (
      await call(`/v1/quotes/${quoteId}/deliver`, {
        method: 'POST',
        token,
        idempotencyKey: `s4-fresh-${runId}-deliver`,
        body: {
          channel: 'download',
          recipient: 'uat-local-operator',
          pdf_sha256: pdfSha256,
        },
      })
    ).payload;

    const after = await pool.query(
      `select id, quote_number, status, approval_status, currency, grand_total,
              bidwright_project_id, bidwright_revision_id, calculation_hash
       from bridge_quotes where tenant_id=$1 and id=$2`,
      [tenantId, quoteId],
    );
    const deliveries = await pool.query(
      `select id, channel, recipient, pdf_sha256, status, attempt_count, sent_at
       from bridge_deliveries
       where tenant_id=$1 and quote_id=$2
       order by created_at desc
       limit 1`,
      [tenantId, quoteId],
    );
    const audit = await pool.query(
      `select actor_type, actor_id, action, resource_type, resource_id, created_at
       from bridge_audit_log
       where tenant_id=$1 and resource_id=$2
       order by created_at desc
       limit 5`,
      [tenantId, quoteId],
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          runId,
          bridgeUrl,
          tokenId,
          intake,
          offering_refs: { 'HVAC-AC-20': ac20Ref, 'HVAC-INSTALL-20': install20Ref },
          prepared,
          approval,
          pdf: {
            file: outFile,
            bytes: saved.length,
            sha256: pdfSha256,
            contentType: pdf.response.headers.get('content-type'),
          },
          operator_detail_before_delivery: {
            item_count: operatorDetailBeforeDelivery.items.length,
            approval_count: operatorDetailBeforeDelivery.approvals.length,
            audit_count: operatorDetailBeforeDelivery.audit.length,
            grand_total: operatorDetailBeforeDelivery.quote.grand_total,
            bidwright_revision_id: operatorDetailBeforeDelivery.quote.bidwright_revision_id,
          },
          delivery,
          hash_match: delivery.pdf_sha256 === pdfSha256,
          after: after.rows[0],
          deliveries: deliveries.rows,
          audit: audit.rows,
        },
        null,
        2,
      ),
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
