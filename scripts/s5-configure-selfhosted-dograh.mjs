import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

const dograhBaseUrl = (process.env.DOGRAH_BASE_URL ?? 'http://127.0.0.1:4172').replace(/\/+$/, '');
const dograhUiUrl = (process.env.DOGRAH_UI_URL ?? 'http://127.0.0.1:4174').replace(/\/+$/, '');
const artifactDir = resolve('artifacts', 's5-dograh-real-voice');
const bridgeCredentialPath = resolve(artifactDir, 'dograh-bridge-runtime-credential.local.json');
const dograhAdminPath = resolve(artifactDir, 'dograh-selfhost-admin.local.json');
const dograhProvisioningPath = resolve(artifactDir, 'dograh-selfhost-provisioning.local.json');
const envPath = resolve('.env');

function randomPassword() {
  return `Dograh-${randomBytes(18).toString('base64url')}-S5!`;
}

function mask(value) {
  if (!value || value.length < 12) return '***';
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

async function readJson(pathname) {
  return JSON.parse(await readFile(pathname, 'utf8'));
}

async function writeJson(pathname, value) {
  await mkdir(resolve(pathname, '..'), { recursive: true });
  await writeFile(pathname, JSON.stringify(value, null, 2));
}

async function dograh(pathname, { method = 'GET', token, apiKey, body, allow = [] } = {}) {
  const response = await fetch(`${dograhBaseUrl}/api/v1${pathname}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(apiKey ? { 'x-api-key': apiKey } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok && !allow.includes(response.status)) {
    throw new Error(`${method} ${pathname} failed ${response.status}: ${JSON.stringify(payload)}`);
  }
  return { status: response.status, payload };
}

async function loadOrCreateAdmin() {
  let admin = existsSync(dograhAdminPath)
    ? await readJson(dograhAdminPath)
    : {
        email: 'frontdeskq-dograh-admin@nhlglobalsolution.com',
        password: randomPassword(),
        name: 'Frontdesk-Q Dograh Admin',
      };

  if (admin.email === 'frontdeskq-dograh-admin@example.test') {
    admin.email = 'frontdeskq-dograh-admin@nhlglobalsolution.com';
  }

  if (admin.token) {
    const me = await dograh('/auth/me', { token: admin.token, allow: [401, 403] });
    if (me.status === 200) return admin;
  }

  const login = await dograh('/auth/login', {
    method: 'POST',
    body: { email: admin.email, password: admin.password },
    allow: [401, 404],
  });
  if (login.status === 200) {
    admin = { ...admin, token: login.payload.token, user: login.payload.user };
    await writeJson(dograhAdminPath, admin);
    return admin;
  }

  const signup = await dograh('/auth/signup', {
    method: 'POST',
    body: { email: admin.email, password: admin.password, name: admin.name },
    allow: [409],
  });
  if (signup.status === 409) {
    throw new Error(
      `Dograh admin user already exists but stored password did not work. Delete or recover ${dograhAdminPath}, then retry.`,
    );
  }

  admin = { ...admin, token: signup.payload.token, user: signup.payload.user };
  await writeJson(dograhAdminPath, admin);
  return admin;
}

async function ensureManagementApiKey(admin) {
  if (admin.api_key) return admin;
  const created = await dograh('/user/api-keys', {
    method: 'POST',
    token: admin.token,
    body: { name: 'Frontdesk-Q Dograh Management' },
  });
  admin = {
    ...admin,
    api_key_id: created.payload.id,
    api_key_prefix: created.payload.key_prefix,
    api_key: created.payload.api_key,
  };
  await writeJson(dograhAdminPath, admin);
  return admin;
}

async function ensureBridgeCredential(admin, bridgeSecret) {
  const existing = (await dograh('/credentials/', { token: admin.token })).payload.find(
    (credential) => credential.name === 'Frontdesk-Q Bridge ai_runtime',
  );
  const body = {
    name: 'Frontdesk-Q Bridge ai_runtime',
    description: 'Tenant-scoped Bridge bearer token for Dograh voice runtime. AI cannot approve, export or deliver.',
    credential_type: 'bearer_token',
    credential_data: { token: bridgeSecret.dograh_credential.credential_data.token },
  };
  if (existing) {
    return (
      await dograh(`/credentials/${existing.uuid}`, {
        method: 'PUT',
        token: admin.token,
        body,
      })
    ).payload;
  }
  return (await dograh('/credentials/', { method: 'POST', token: admin.token, body })).payload;
}

function param(name, type, description, required = true) {
  return { name, type, description, required };
}

function httpToolDefinitions({ bridgeUrl, tenantId, credentialUuid }) {
  const headers = { 'x-tenant-id': tenantId, 'content-type': 'application/json' };
  return [
    {
      name: 'frontdesk_q_search_offerings',
      description:
        'Search tenant-approved HVAC products/services through Bridge. Use before preparing a quote; do not invent prices.',
      category: 'http_api',
      icon: 'search',
      icon_color: '#2563EB',
      definition: {
        schema_version: 1,
        type: 'http_api',
        config: {
          method: 'POST',
          url: `${bridgeUrl}/v1/dograh/tools/search-offerings`,
          headers,
          credential_uuid: credentialUuid,
          timeout_ms: 15000,
          parameters: [
            param('query', 'string', 'Natural language search phrase, e.g. "2HP inverter air conditioner".'),
            param('types', 'array', 'Allowed offering types to search: product, service, or both.'),
            param('limit', 'number', 'Maximum results to return. Use 5 unless there is a reason to narrow.', false),
          ],
          body_template: { query: '{{query}}', types: '{{types}}', limit: '{{limit}}' },
        },
      },
    },
    {
      name: 'frontdesk_q_capture_hvac_intake',
      description:
        'Capture caller and HVAC requirement details. Use once required fields are known. Does not quote or approve.',
      category: 'http_api',
      icon: 'clipboard-list',
      icon_color: '#059669',
      definition: {
        schema_version: 1,
        type: 'http_api',
        config: {
          method: 'POST',
          url: `${bridgeUrl}/v1/dograh/tools/capture-hvac-intake`,
          headers,
          credential_uuid: credentialUuid,
          timeout_ms: 15000,
          parameters: [
            param('workflow_id', 'string', 'Dograh workflow identifier.'),
            param('workflow_run_id', 'string', 'Dograh workflow run identifier. Must stay stable for retries.'),
            param('customer', 'object', 'Caller identity object with name, phone and optional email.'),
            param('service_intent', 'string', 'HVAC service intent such as air_conditioner_installation.'),
            param('location', 'object', 'Location object with city, state, country/address and building_type if known.'),
            param('requirements', 'object', 'HVAC requirements: equipment_type, capacity, quantity, install_required, building_type.'),
            param('notes', 'string', 'Brief call notes/scope summary.', false),
          ],
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
      },
    },
    {
      name: 'frontdesk_q_prepare_quote',
      description:
        'Prepare a deterministic Bridge/Bidwright quote from an intake and opaque offering refs. Must stop at pending human approval.',
      category: 'http_api',
      icon: 'file-pen-line',
      icon_color: '#7C3AED',
      definition: {
        schema_version: 1,
        type: 'http_api',
        config: {
          method: 'POST',
          url: `${bridgeUrl}/v1/dograh/tools/prepare-quote`,
          headers,
          credential_uuid: credentialUuid,
          timeout_ms: 15000,
          parameters: [
            param('workflow_run_id', 'string', 'Dograh workflow run identifier. Must stay stable for retries.'),
            param('intake_id', 'string', 'Bridge intake ID returned by capture_hvac_intake.'),
            param('title', 'string', 'Short quotation title.'),
            param('scope', 'string', 'Human-readable scope summary.'),
            param('line_proposals', 'array', 'Line proposals with offering_ref, quantity and uom only. No prices.'),
          ],
          body_template: {
            workflow_run_id: '{{workflow_run_id}}',
            intake_id: '{{intake_id}}',
            title: '{{title}}',
            scope: '{{scope}}',
            line_proposals: '{{line_proposals}}',
          },
        },
      },
    },
  ];
}

async function ensureTool(admin, definition) {
  const existing = (await dograh('/tools/', { token: admin.token })).payload.find((tool) => tool.name === definition.name);
  if (existing) {
    return (
      await dograh(`/tools/${existing.tool_uuid}`, {
        method: 'PUT',
        token: admin.token,
        body: {
          name: definition.name,
          description: definition.description,
          icon: definition.icon,
          icon_color: definition.icon_color,
          definition: definition.definition,
          status: 'active',
        },
      })
    ).payload;
  }
  return (await dograh('/tools/', { method: 'POST', token: admin.token, body: definition })).payload;
}

async function updateFrontdeskEnv(admin, health) {
  let env = existsSync(envPath) ? await readFile(envPath, 'utf8') : '';
  const entries = {
    DOGRAH_BASE_URL: dograhBaseUrl,
    DOGRAH_UI_URL: dograhUiUrl,
    DOGRAH_PUBLIC_URL: health.tunnel_url ?? '',
    DOGRAH_API_KEY: admin.api_key,
  };
  for (const [key, value] of Object.entries(entries)) {
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    env = pattern.test(env) ? env.replace(pattern, line) : `${env.replace(/\s*$/, '\n')}${line}\n`;
  }
  await writeFile(envPath, env);
}

async function main() {
  if (!existsSync(bridgeCredentialPath)) {
    throw new Error(`Missing Bridge credential bundle: ${bridgeCredentialPath}. Run s5-dograh-public-bridge-readiness.mjs first.`);
  }
  const bridgeSecret = await readJson(bridgeCredentialPath);
  const bridgeUrl = (process.env.PUBLIC_BRIDGE_URL ?? bridgeSecret.bridge.public_bridge_url).replace(/\/+$/, '');
  const tenantId = bridgeSecret.bridge.tenant_id;

  const health = (await dograh('/health')).payload;
  const admin = await ensureManagementApiKey(await loadOrCreateAdmin());
  const credential = await ensureBridgeCredential(admin, bridgeSecret);
  const tools = [];
  for (const definition of httpToolDefinitions({ bridgeUrl, tenantId, credentialUuid: credential.uuid })) {
    tools.push(await ensureTool(admin, definition));
  }

  const searchTool = tools.find((tool) => tool.name === 'frontdesk_q_search_offerings');
  const smoke = await dograh(`/tools/${searchTool.tool_uuid}/test`, {
    method: 'POST',
    token: admin.token,
    body: {
      llm_params: { query: '2HP inverter air conditioner', types: ['product', 'service'], limit: 3 },
      preset_params: {},
    },
  });

  await updateFrontdeskEnv(admin, health);
  await writeJson(dograhProvisioningPath, {
    dograh_base_url: dograhBaseUrl,
    dograh_ui_url: dograhUiUrl,
    dograh_public_url: health.tunnel_url ?? null,
    admin_email: admin.email,
    api_key_id: admin.api_key_id,
    api_key_prefix: admin.api_key_prefix,
    bridge_credential_uuid: credential.uuid,
    tool_uuids: Object.fromEntries(tools.map((tool) => [tool.name, tool.tool_uuid])),
    search_tool_test: {
      status: smoke.payload.status,
      status_code: smoke.payload.status_code,
      item_count: Array.isArray(smoke.payload.data?.items) ? smoke.payload.data.items.length : null,
      codes: Array.isArray(smoke.payload.data?.items) ? smoke.payload.data.items.map((item) => item.code) : [],
    },
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        dograh: {
          base_url: dograhBaseUrl,
          ui_url: dograhUiUrl,
          public_url: health.tunnel_url ?? null,
          version: health.version,
        },
        management: {
          admin_email: admin.email,
          api_key_prefix: admin.api_key_prefix,
          api_key_masked: mask(admin.api_key),
          saved_to_env: true,
        },
        bridge: {
          public_bridge_url: bridgeUrl,
          tenant_id: tenantId,
          credential_uuid: credential.uuid,
        },
        tools: Object.fromEntries(tools.map((tool) => [tool.name, tool.tool_uuid])),
        smoke: {
          status: smoke.payload.status,
          status_code: smoke.payload.status_code,
          item_count: Array.isArray(smoke.payload.data?.items) ? smoke.payload.data.items.length : null,
          codes: Array.isArray(smoke.payload.data?.items) ? smoke.payload.data.items.map((item) => item.code) : [],
        },
        local_secret_files: {
          admin: dograhAdminPath,
          provisioning: dograhProvisioningPath,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
