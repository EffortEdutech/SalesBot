import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const dograhBaseUrl = (process.env.DOGRAH_BASE_URL ?? 'http://127.0.0.1:4172').replace(/\/+$/, '');
const artifactDir = resolve('artifacts', 's5-dograh-real-voice');
const adminPath = resolve(artifactDir, 'dograh-selfhost-admin.local.json');
const workflowId = Number(process.env.DOGRAH_WORKFLOW_ID ?? 1);
const configName = process.env.DOGRAH_ARI_CONFIG_NAME ?? 'Frontdesk-Q Local Asterisk ARI';
const inboundAddress = process.env.DOGRAH_INBOUND_SIP_ADDRESS ?? '';

const requiredEnv = [
  'DOGRAH_ARI_ENDPOINT',
  'DOGRAH_ARI_APP_NAME',
  'DOGRAH_ARI_APP_PASSWORD',
  'DOGRAH_INBOUND_SIP_ADDRESS',
];

async function readJson(pathname) {
  return JSON.parse(await readFile(pathname, 'utf8'));
}

async function dograh(pathname, { method = 'GET', token, body, allow = [] } = {}) {
  const response = await fetch(`${dograhBaseUrl}/api/v1${pathname}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok && !allow.includes(response.status)) {
    throw new Error(`${method} ${pathname} failed ${response.status}: ${text}`);
  }
  return { status: response.status, payload };
}

function missingRequiredEnv() {
  return requiredEnv.filter((name) => !process.env[name]?.trim());
}

function normalizeAddress(address) {
  return address.trim().toLowerCase();
}

function countryCodeFor(address) {
  const trimmed = address.trim();
  if (/^\d{8,15}$/.test(trimmed.replace(/[\s\-()]/g, '')) && !trimmed.startsWith('+')) {
    return process.env.DOGRAH_INBOUND_COUNTRY_CODE ?? 'MY';
  }
  return process.env.DOGRAH_INBOUND_COUNTRY_CODE || undefined;
}

function ariConfigBody() {
  return {
    provider: 'ari',
    ari_endpoint: process.env.DOGRAH_ARI_ENDPOINT.trim(),
    app_name: process.env.DOGRAH_ARI_APP_NAME.trim(),
    app_password: process.env.DOGRAH_ARI_APP_PASSWORD.trim(),
    ws_client_name: process.env.DOGRAH_ARI_WS_CLIENT_NAME?.trim() ?? '',
  };
}

function maskedConfigSummary(config) {
  return {
    provider: config.provider,
    ari_endpoint: config.ari_endpoint,
    app_name: config.app_name,
    app_password: config.app_password ? '<set>' : '<missing>',
    ws_client_name: config.ws_client_name || null,
  };
}

async function writeEvidence(name, evidence) {
  await mkdir(artifactDir, { recursive: true });
  const evidencePath = resolve(artifactDir, name);
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2));
  return evidencePath;
}

async function main() {
  const missing = missingRequiredEnv();
  if (missing.length > 0) {
    const evidence = {
      ok: false,
      dograh_base_url: dograhBaseUrl,
      workflow_id: workflowId,
      missing_env: missing,
      required_env: requiredEnv,
      optional_env: ['DOGRAH_ARI_WS_CLIENT_NAME', 'DOGRAH_ARI_CONFIG_NAME', 'DOGRAH_INBOUND_COUNTRY_CODE'],
      next_steps: [
        'Start or configure Asterisk with ARI enabled.',
        'Set DOGRAH_ARI_ENDPOINT, DOGRAH_ARI_APP_NAME, DOGRAH_ARI_APP_PASSWORD, and DOGRAH_INBOUND_SIP_ADDRESS in the local shell or .env.',
        'Run this script again to create/update Dograh ARI telephony and route the inbound address to workflow 1.',
        'Set DOGRAH_TRANSFER_TARGET to a real human PJSIP/SIP destination and rerun scripts/s5-configure-dograh-transfer-target.mjs.',
        'Run scripts/s5-telephony-readiness.mjs.',
      ],
    };
    const evidencePath = await writeEvidence('dograh-ari-telephony-config.local.json', evidence);
    console.log(JSON.stringify({ ...evidence, evidence_path: evidencePath }, null, 2));
    process.exitCode = 1;
    return;
  }

  const admin = await readJson(adminPath);
  const token = admin.token;

  const workflow = (await dograh(`/workflow/fetch/${workflowId}`, { token })).payload;
  if (!workflow?.id) throw new Error(`Dograh workflow ${workflowId} was not found.`);

  const configBody = ariConfigBody();
  const telephonyList = (await dograh('/organizations/telephony-configs', { token })).payload;
  const configurations = telephonyList.configurations ?? [];
  const existingConfig =
    configurations.find((config) => config.provider === 'ari' && config.name === configName) ??
    configurations.find((config) => config.provider === 'ari');

  const configPayload = {
    name: configName,
    is_default_outbound: false,
    config: configBody,
  };

  const savedConfig = existingConfig
    ? (await dograh(`/organizations/telephony-configs/${existingConfig.id}`, {
        method: 'PUT',
        token,
        body: {
          name: configName,
          config: configBody,
        },
      })).payload
    : (await dograh('/organizations/telephony-configs', {
        method: 'POST',
        token,
        body: configPayload,
      })).payload;

  const configId = savedConfig.id ?? existingConfig?.id;
  if (!configId) throw new Error(`Dograh did not return a telephony configuration id: ${JSON.stringify(savedConfig)}`);

  const numbersResponse = (await dograh(`/organizations/telephony-configs/${configId}/phone-numbers`, { token })).payload;
  const phoneNumbers = numbersResponse.phone_numbers ?? [];
  const existingNumber = phoneNumbers.find((number) => normalizeAddress(number.address) === normalizeAddress(inboundAddress));

  const phonePayload = {
    address: inboundAddress,
    country_code: countryCodeFor(inboundAddress),
    label: process.env.DOGRAH_INBOUND_LABEL ?? 'Frontdesk-Q inbound',
    inbound_workflow_id: workflowId,
    is_active: true,
    is_default_caller_id: false,
    extra_metadata: {
      configured_by: 'frontdesk-q-s5',
      purpose: 'Dograh inbound real phone/SIP UAT',
    },
  };

  const savedNumber = existingNumber
    ? (await dograh(`/organizations/telephony-configs/${configId}/phone-numbers/${existingNumber.id}`, {
        method: 'PUT',
        token,
        body: {
          label: phonePayload.label,
          inbound_workflow_id: workflowId,
          is_active: true,
          country_code: phonePayload.country_code,
          extra_metadata: phonePayload.extra_metadata,
        },
      })).payload
    : (await dograh(`/organizations/telephony-configs/${configId}/phone-numbers`, {
        method: 'POST',
        token,
        body: phonePayload,
      })).payload;

  const detail = (await dograh(`/organizations/telephony-configs/${configId}`, { token })).payload;
  const refreshedNumbers = (await dograh(`/organizations/telephony-configs/${configId}/phone-numbers`, { token })).payload.phone_numbers ?? [];

  const evidence = {
    ok: true,
    dograh_base_url: dograhBaseUrl,
    workflow: {
      id: workflow.id,
      name: workflow.name,
    },
    ari_configuration: {
      id: configId,
      name: detail.name ?? configName,
      provider: detail.provider ?? 'ari',
      connectivity: detail.connectivity ?? null,
      supports_trunks: detail.supports_trunks ?? null,
      setup_checklist: detail.setup_checklist ?? null,
      credentials: maskedConfigSummary(configBody),
    },
    inbound_address: {
      id: savedNumber.id,
      address: savedNumber.address,
      address_normalized: savedNumber.address_normalized,
      inbound_workflow_id: savedNumber.inbound_workflow_id,
      inbound_workflow_name: savedNumber.inbound_workflow_name ?? null,
      is_active: savedNumber.is_active,
      provider_sync: savedNumber.provider_sync ?? null,
    },
    active_addresses_for_config: refreshedNumbers
      .filter((number) => number.is_active !== false)
      .map((number) => ({
        id: number.id,
        address: number.address_normalized ?? number.address,
        inbound_workflow_id: number.inbound_workflow_id,
        inbound_workflow_name: number.inbound_workflow_name ?? null,
      })),
    next_steps: [
      'Set DOGRAH_TRANSFER_TARGET to the real human SIP/PJSIP destination and rerun scripts/s5-configure-dograh-transfer-target.mjs.',
      'Run scripts/s5-telephony-readiness.mjs.',
      'Place one inbound SIP/phone call to the configured address and ask to speak to a human.',
    ],
  };

  const evidencePath = await writeEvidence('dograh-ari-telephony-config.local.json', evidence);
  console.log(JSON.stringify({ ...evidence, evidence_path: evidencePath }, null, 2));
}

main().catch(async (error) => {
  const evidence = {
    ok: false,
    dograh_base_url: dograhBaseUrl,
    workflow_id: workflowId,
    error: error.message,
  };
  const evidencePath = await writeEvidence('dograh-ari-telephony-config.local.json', evidence);
  console.error(JSON.stringify({ ...evidence, evidence_path: evidencePath }, null, 2));
  process.exitCode = 1;
});
