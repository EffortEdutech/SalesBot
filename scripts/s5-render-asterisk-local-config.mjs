import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const dograhBaseUrl = (process.env.DOGRAH_BASE_URL ?? 'http://127.0.0.1:4172').replace(/\/+$/, '');
const configName = process.env.DOGRAH_ARI_CONFIG_NAME ?? 'Frontdesk-Q Local Asterisk ARI';
const artifactDir = resolve('artifacts', 's5-dograh-real-voice');
const adminPath = resolve(artifactDir, 'dograh-selfhost-admin.local.json');
const templatePath = resolve('providers', 'asterisk-local', 'config', 'extensions.conf.template');
const generatedDir = resolve('providers', 'asterisk-local', 'generated');
const generatedPath = resolve(generatedDir, 'extensions.conf');

async function readJson(pathname) {
  return JSON.parse(await readFile(pathname, 'utf8'));
}

async function dograh(pathname, { token }) {
  const response = await fetch(`${dograhBaseUrl}/api/v1${pathname}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`GET ${pathname} failed ${response.status}: ${text}`);
  return payload;
}

function maskCredentials(credentials) {
  return {
    provider: credentials.provider,
    ari_endpoint: credentials.ari_endpoint,
    app_name: credentials.app_name,
    app_password: credentials.app_password ? '<set>' : '<missing>',
    ws_client_name: credentials.ws_client_name,
    stasis_app_name: credentials.stasis_app_name,
  };
}

async function main() {
  const admin = await readJson(adminPath);
  const token = admin.token;
  const list = await dograh('/organizations/telephony-configs', { token });
  const configs = list.configurations ?? [];
  const summary =
    configs.find((config) => config.provider === 'ari' && config.name === configName) ??
    configs.find((config) => config.provider === 'ari');
  if (!summary) throw new Error(`No Dograh ARI telephony configuration found. Run scripts/s5-configure-dograh-ari-telephony.mjs first.`);

  const detail = await dograh(`/organizations/telephony-configs/${summary.id}`, { token });
  const credentials = detail.credentials ?? {};
  const stasisAppName = credentials.stasis_app_name ?? credentials.app_name;
  if (!stasisAppName) throw new Error(`Dograh ARI config ${summary.id} did not expose stasis_app_name or app_name.`);

  const template = await readFile(templatePath, 'utf8');
  const rendered = template.replaceAll('__DOGRAH_STASIS_APP__', stasisAppName);
  await mkdir(generatedDir, { recursive: true });
  await writeFile(generatedPath, rendered);

  const evidence = {
    ok: true,
    dograh_base_url: dograhBaseUrl,
    dograh_ari_configuration: {
      id: summary.id,
      name: summary.name,
      credentials: maskCredentials(credentials),
    },
    asterisk_generated_extensions_conf: generatedPath,
    inbound_extension: '7001',
    human_extension: '1002',
    transfer_target: 'PJSIP/1002',
    next_steps: [
      'Start Asterisk with docker compose -f providers/asterisk-local/docker-compose.yaml up -d.',
      'Configure Dograh transfer target as PJSIP/1002.',
      'Register softphones 1001 and 1002, then call 7001 from 1001.',
    ],
  };
  const evidencePath = resolve(artifactDir, 'asterisk-local-render.local.json');
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ ...evidence, evidence_path: evidencePath }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
