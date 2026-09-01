const endpoint = (process.env.ASTERISK_ARI_ENDPOINT ?? 'http://127.0.0.1:8088').replace(/\/+$/, '');
const user = process.env.ASTERISK_ARI_USER ?? 'dograh';
const password = process.env.ASTERISK_ARI_PASSWORD ?? 'frontdeskq_ari_dev_only';

async function get(pathname) {
  const response = await fetch(`${endpoint}${pathname}`, {
    headers: {
      authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`,
    },
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { text };
  }
  return { status: response.status, ok: response.ok, payload };
}

async function main() {
  const info = await get('/ari/asterisk/info');
  const endpoints = info.ok ? await get('/ari/endpoints') : { ok: false, status: null, payload: null };
  const applications = info.ok ? await get('/ari/applications') : { ok: false, status: null, payload: null };
  const evidence = {
    ok: info.ok,
    ari_endpoint: endpoint,
    ari_user: user,
    ari_password: password ? '<set>' : '<missing>',
    checks: [
      { name: 'Asterisk ARI info reachable', ok: info.ok, status: info.status },
      { name: 'Asterisk ARI endpoints readable', ok: endpoints.ok, status: endpoints.status },
      { name: 'Asterisk ARI applications readable', ok: applications.ok, status: applications.status },
    ],
    asterisk: info.payload
      ? {
          system: info.payload.system ?? null,
          config: info.payload.config ?? null,
          status: info.payload.status ?? null,
        }
      : null,
    pjsip_endpoints:
      Array.isArray(endpoints.payload)
        ? endpoints.payload.map((endpointItem) => ({
            technology: endpointItem.technology,
            resource: endpointItem.resource,
            state: endpointItem.state,
          }))
        : [],
    ari_applications:
      Array.isArray(applications.payload)
        ? applications.payload.map((application) => ({
            name: application.name,
            channel_ids: application.channel_ids ?? [],
          }))
        : [],
    next_steps: info.ok
      ? [
          'Register SIP softphone 1001 and SIP softphone 1002.',
          'Call 7001 from 1001.',
          'Say: I want to speak to a human.',
          'Check Dograh Agent Runs and Asterisk logs for transfer to PJSIP/1002.',
        ]
      : [
          'Start local Asterisk: docker compose -f providers/asterisk-local/docker-compose.yaml up -d.',
          'Check logs: docker compose -f providers/asterisk-local/docker-compose.yaml logs --tail=120 asterisk.',
        ],
  };
  console.log(JSON.stringify(evidence, null, 2));
  if (!evidence.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
