import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPool } from '@frontdesk-q/db';

const tenantId = process.env.TENANT_ID ?? 'tenant_hvac_pilot';
const bridgeUrl = process.env.BRIDGE_URL ?? 'http://127.0.0.1:4170';
const pepper = process.env.BRIDGE_TOKEN_PEPPER;
const databaseUrl = process.env.DATABASE_URL;

if (!pepper) throw new Error('BRIDGE_TOKEN_PEPPER is required');
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const token = `brg.dev.${randomBytes(24).toString('hex')}`;
const tokenHash = createHash('sha256').update(`${pepper}:${token}`, 'utf8').digest('hex');
const pool = createPool(databaseUrl);
const tokenId = randomUUID();
const createdAt = new Date();

try {
  await pool.query(
    `insert into bridge_api_tokens
     (id, tenant_id, name, token_hash, role, scopes, expires_at)
     values ($1,$2,$3,$4,$5,$6::jsonb,now()+interval '8 hours')`,
    [
      tokenId,
      tenantId,
      `SalesBot Operator Console dev token ${createdAt.toISOString()}`,
      tokenHash,
      'tenant_owner',
      JSON.stringify(['operator:system', 'quote.read', 'quote.approve', 'quote.deliver', 'intake.write', 'quote.prepare']),
    ],
  );

  const artifact = resolve('artifacts', 'operator-console-dev-token.local.json');
  await mkdir(resolve('artifacts'), { recursive: true });
  await writeFile(
    artifact,
    JSON.stringify(
      {
        created_at: createdAt.toISOString(),
        expires_at_hint: 'created_at + 8 hours',
        tenant_id: tenantId,
        role: 'tenant_owner',
        bridge_url_for_ui: '/bridge',
        direct_bridge_url: bridgeUrl,
        token,
      },
      null,
      2,
    ),
  );

  const response = await fetch(`${bridgeUrl}/v1/operator/system`, {
    headers: { authorization: `Bearer ${token}`, 'x-tenant-id': tenantId },
  });
  const body = await response.json();
  if (!response.ok || body.ok === false) {
    throw new Error(`Fresh operator token failed verification: ${response.status} ${JSON.stringify(body)}`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        status: response.status,
        tenant_id: tenantId,
        role: 'tenant_owner',
        artifact,
        operator: body.operator?.name ?? null,
      },
      null,
      2,
    ),
  );
} finally {
  await pool.end();
}