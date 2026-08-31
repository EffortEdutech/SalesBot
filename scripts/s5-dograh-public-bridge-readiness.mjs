import { mkdir, writeFile } from 'node:fs/promises';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { createPool } from '@frontdesk-q/db';

const tenantId = process.env.TENANT_ID ?? 'tenant_hvac_pilot';
const publicBridgeUrl = trimTrailingSlash(process.env.PUBLIC_BRIDGE_URL ?? process.env.BRIDGE_URL ?? '');
const artifactDir = resolve('artifacts', 's5-dograh-real-voice');
const credentialPath = resolve(artifactDir, 'dograh-bridge-runtime-credential.local.json');
const toolConfigPath = resolve(artifactDir, 'dograh-http-tools.local.json');

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requireHttpsUrl(value) {
  if (!value) throw new Error('PUBLIC_BRIDGE_URL is required, for example https://example.trycloudflare.com');
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:') {
    throw new Error(`PUBLIC_BRIDGE_URL must be public HTTPS. Received ${value}`);
  }
}

async function call(pathname, { method = 'GET', token, idempotencyKey, body } = {}) {
  const response = await fetch(`${publicBridgeUrl}${pathname}`, {
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
  if (!response.ok || payload.ok === false) {
    throw new Error(`${method} ${pathname} failed ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

function dograhToolConfigs(credentialUuid) {
  const headers = {
    'x-tenant-id': tenantId,
    'content-type': 'application/json',
  };

  return [
    {
      name: 'frontdesk_q_search_offerings',
      description: 'Search active tenant HVAC offerings through Frontdesk-Q Bridge only.',
      method: 'POST',
      url: `${publicBridgeUrl}/v1/dograh/tools/search-offerings`,
      credential_uuid: credentialUuid,
      headers,
      timeout_ms: 15000,
      body_template: { query: '{{query}}', types: '{{types}}', limit: '{{limit}}' },
    },
    {
      name: 'frontdesk_q_capture_hvac_intake',
      description: 'Capture a tenant-scoped HVAC voice intake. Does not disclose or approve prices.',
      method: 'POST',
      url: `${publicBridgeUrl}/v1/dograh/tools/capture-hvac-intake`,
      credential_uuid: credentialUuid,
      headers: {
        ...headers,
        'x-idempotency-key': 'dograh:{{workflow_run_id}}:capture_intake:1',
      },
      timeout_ms: 15000,
      body_template: {
        workflow_id: '{{workflow_id}}',
        workflow_run_id: '{{workflow_run_id}}',
        customer: '{{customer}}',
        service_intent: '{{service_intent}}',
        location: '{{location}}',
        requirements: '{{requirements}}',
        notes: '{{notes}}',
      },
    },
    {
      name: 'frontdesk_q_prepare_quote',
      description: 'Prepare a deterministic quote that must stop at pending human approval.',
      method: 'POST',
      url: `${publicBridgeUrl}/v1/dograh/tools/prepare-quote`,
      credential_uuid: credentialUuid,
      headers: {
        ...headers,
        'x-idempotency-key': 'dograh:{{workflow_run_id}}:prepare_quote:1',
      },
      timeout_ms: 30000,
      body_template: {
        intake_id: '{{intake_id}}',
        title: '{{title}}',
        scope: '{{scope}}',
        line_proposals: '{{line_proposals}}',
      },
    },
  ];
}

async function main() {
  requireHttpsUrl(publicBridgeUrl);
  const pepper = requireEnv('BRIDGE_TOKEN_PEPPER');
  const databaseUrl = requireEnv('DATABASE_URL');
  const runId = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const token = `brg.dograh.${randomBytes(32).toString('hex')}`;
  const tokenHash = createHash('sha256').update(`${pepper}:${token}`, 'utf8').digest('hex');
  const tokenId = randomUUID();
  const pool = createPool(databaseUrl);

  try {
    await pool.query(
      `insert into bridge_api_tokens
       (id, tenant_id, name, token_hash, role, scopes, expires_at)
       values ($1,$2,$3,$4,$5,$6::jsonb,now()+interval '14 days')`,
      [
        tokenId,
        tenantId,
        `S5 real Dograh ai_runtime ${runId}`,
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
      [tenantId, publicBridgeUrl, `bridge_api_tokens:${tokenId}`, 'ai_runtime', 's5-bridge-http-tools-v1'],
    );

    const session = await call('/v1/dograh/session', { token });
    const tools = await call('/v1/dograh/tools', { token });

    await mkdir(artifactDir, { recursive: true });
    await writeFile(
      credentialPath,
      JSON.stringify(
        {
          warning: 'LOCAL SECRET FILE. Do not commit, screenshot, or paste into chat.',
          dograh_credential: {
            name: 'Frontdesk-Q Bridge ai_runtime',
            credential_type: 'bearer_token',
            credential_data: { token },
          },
          bridge: { public_bridge_url: publicBridgeUrl, tenant_id: tenantId, token_id: tokenId, expires_in: '14 days' },
        },
        null,
        2,
      ),
    );

    await writeFile(
      toolConfigPath,
      JSON.stringify(
        {
          warning: 'Use after creating the Dograh credential. Replace <DOGRAH_CREDENTIAL_UUID> with the UUID returned by Dograh.',
          forbidden_tools: ['approve_quote', 'reject_quote', 'deliver_quote', 'export_pdf'],
          tools: dograhToolConfigs('<DOGRAH_CREDENTIAL_UUID>'),
          workflow_runtime_checks: [
            'Tenant header is preset, not LLM controlled.',
            'Authorization uses Dograh bearer credential, not prompt-visible text.',
            'capture and prepare calls use stable workflow-run idempotency keys.',
            'Prepared quote must stop at pending_approval.',
            'Human transfer is handled by Dograh native transfer_to_human tool.',
          ],
        },
        null,
        2,
      ),
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          runId,
          publicBridgeUrl,
          tenantId,
          tokenId,
          session: {
            status: session.status,
            pinned_version: session.pinned_version,
            authority: session.authority,
          },
          bridge_tools: {
            tool_names: tools.tools.map((tool) => tool.name),
            forbidden_tools: tools.forbidden_tools,
          },
          local_secret_file: credentialPath,
          dograh_tool_config_file: toolConfigPath,
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
