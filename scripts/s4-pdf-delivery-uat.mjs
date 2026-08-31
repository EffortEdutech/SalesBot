import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createPool } from '@frontdesk-q/db';

const tenantId = 'tenant_hvac_pilot';
const quoteId = '430472f8-344e-4304-9cf9-d393016e5b95';
const bridgeUrl = process.env.BRIDGE_URL ?? 'http://127.0.0.1:4170';
const outDir = path.resolve('artifacts', 's4-uat');
const outFile = path.join(outDir, 'BW-260823-6701-approved.pdf');

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main() {
  const pepper = requireEnv('BRIDGE_TOKEN_PEPPER');
  const databaseUrl = requireEnv('DATABASE_URL');
  const token = `brg.dev.${randomBytes(24).toString('hex')}`;
  const tokenHash = createHash('sha256').update(`${pepper}:${token}`, 'utf8').digest('hex');

  const client = createPool(databaseUrl);
  try {
    const tokenId = randomUUID();
    await client.query(
      `insert into bridge_api_tokens
       (id, tenant_id, name, token_hash, role, scopes, expires_at)
       values ($1,$2,$3,$4,$5,$6::jsonb,now()+interval '2 hours')`,
      [
        tokenId,
        tenantId,
        'S4 PDF delivery UAT operator',
        tokenHash,
        'tenant_owner',
        JSON.stringify(['quotes:approve', 'quotes:deliver', 'operator:system']),
      ],
    );

    const headers = {
      authorization: `Bearer ${token}`,
      'x-tenant-id': tenantId,
    };

    const before = await client.query(
      `select id, quote_number, status, approval_status, currency, grand_total,
              bidwright_project_id, bidwright_revision_id, calculation_hash
       from bridge_quotes where tenant_id=$1 and id=$2`,
      [tenantId, quoteId],
    );
    if (before.rowCount !== 1) throw new Error(`quote not found: ${quoteId}`);

    const pdfResponse = await fetch(`${bridgeUrl}/v1/quotes/${quoteId}/pdf`, { headers });
    const pdfBytes = Buffer.from(await pdfResponse.arrayBuffer());
    if (!pdfResponse.ok) {
      throw new Error(`PDF export failed ${pdfResponse.status}: ${pdfBytes.toString('utf8')}`);
    }
    if (!pdfBytes.subarray(0, 4).equals(Buffer.from('%PDF'))) {
      throw new Error(`PDF export did not return a PDF; first bytes=${pdfBytes.subarray(0, 16).toString('hex')}`);
    }

    await mkdir(outDir, { recursive: true });
    await writeFile(outFile, pdfBytes);
    const saved = await readFile(outFile);
    const pdfSha256 = createHash('sha256').update(saved).digest('hex');

    const deliverResponse = await fetch(`${bridgeUrl}/v1/quotes/${quoteId}/deliver`, {
      method: 'POST',
      headers: {
        ...headers,
        'content-type': 'application/json',
        'x-idempotency-key': `deliver-m1-${quoteId}-download-uat-001`,
      },
      body: JSON.stringify({
        channel: 'download',
        recipient: 'uat-local-operator',
      }),
    });
    const deliverPayload = await deliverResponse.json();
    if (!deliverResponse.ok || deliverPayload.ok !== true) {
      throw new Error(`Delivery UAT failed ${deliverResponse.status}: ${JSON.stringify(deliverPayload)}`);
    }

    const after = await client.query(
      `select id, quote_number, status, approval_status, currency, grand_total,
              bidwright_revision_id, calculation_hash
       from bridge_quotes where tenant_id=$1 and id=$2`,
      [tenantId, quoteId],
    );
    const deliveries = await client.query(
      `select id, channel, recipient, pdf_sha256, status, attempt_count, sent_at
       from bridge_deliveries
       where tenant_id=$1 and quote_id=$2
       order by created_at desc
       limit 3`,
      [tenantId, quoteId],
    );
    const audit = await client.query(
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
          bridgeUrl,
          quoteId,
          tokenId,
          before: before.rows[0],
          pdf: {
            file: outFile,
            bytes: saved.length,
            sha256: pdfSha256,
            contentType: pdfResponse.headers.get('content-type'),
          },
          delivery: deliverPayload,
          after: after.rows[0],
          deliveries: deliveries.rows,
          audit: audit.rows,
        },
        null,
        2,
      ),
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
