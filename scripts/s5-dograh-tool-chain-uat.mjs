import { readFile } from 'node:fs/promises';

const dograhBaseUrl = (process.env.DOGRAH_BASE_URL ?? 'http://127.0.0.1:4172').replace(/\/+$/, '');
const artifactDir = 'artifacts/s5-dograh-real-voice';

async function readJson(pathname) {
  return JSON.parse(await readFile(pathname, 'utf8'));
}

async function dograh(pathname, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${dograhBaseUrl}/api/v1${pathname}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`${method} ${pathname} failed ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function testTool(toolUuid, token, llmParams, presetParams = {}) {
  const result = await dograh(`/tools/${toolUuid}/test`, {
    method: 'POST',
    token,
    body: { llm_params: llmParams, preset_params: presetParams },
  });
  if (result.status !== 'success') {
    throw new Error(`Dograh tool test failed for ${toolUuid}: ${JSON.stringify(result)}`);
  }
  return result.data;
}

async function main() {
  const admin = await readJson(`${artifactDir}/dograh-selfhost-admin.local.json`);
  const provisioning = await readJson(`${artifactDir}/dograh-selfhost-provisioning.local.json`);
  const tools = provisioning.tool_uuids;
  const runId = `real-dograh-tool-chain-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;

  const search = await testTool(tools.frontdesk_q_search_offerings, admin.token, {
    query: '2HP inverter air conditioner installation',
    types: ['product', 'service'],
    limit: 5,
  });
  const ac20 = search.items.find((item) => item.code === 'HVAC-AC-20') ?? search.items.find((item) => item.type === 'product');
  const install20 =
    search.items.find((item) => item.code === 'HVAC-INSTALL-20') ?? search.items.find((item) => item.type === 'service');
  if (!ac20 || !install20) throw new Error(`Expected HVAC product and install offerings. Received: ${JSON.stringify(search)}`);

  const intake = await testTool(tools.frontdesk_q_capture_hvac_intake, admin.token, {
    workflow_id: 'dograh_hvac_quote_v1',
    workflow_run_id: runId,
    customer: { name: `Ahmad Selfhost Dograh ${runId}`, phone: '+60123456789' },
    service_intent: 'air_conditioner_installation',
    location: { city: 'Ipoh', state: 'Perak', building_type: 'office' },
    requirements: { equipment_type: 'air_conditioner', capacity: '2HP', quantity: 3, install_required: true },
    notes: 'Self-hosted Dograh tool-chain UAT: caller asks for supply and installation of 3 x 2HP AC units.',
  });

  const prepared = await testTool(tools.frontdesk_q_prepare_quote, admin.token, {
    workflow_run_id: runId,
    intake_id: intake.intake_id,
    title: `Self-hosted Dograh Tool Chain UAT - ${runId}`,
    scope: 'Supply and install 3 x 2HP inverter air conditioners at an office in Ipoh.',
    line_proposals: [
      { offering_ref: ac20.offering_ref, quantity: 3, uom: ac20.uom },
      { offering_ref: install20.offering_ref, quantity: 3, uom: install20.uom },
    ],
  });

  if (prepared.state !== 'pending_approval') {
    throw new Error(`Quote must stop at pending_approval. Received: ${JSON.stringify(prepared)}`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        dograh_base_url: dograhBaseUrl,
        workflow_run_id: runId,
        offering_codes: [ac20.code, install20.code],
        intake: {
          intake_id: intake.intake_id,
          status: intake.status,
          source_channel: intake.source_channel,
          next_allowed_actions: intake.next_allowed_actions,
        },
        quote: {
          quote_id: prepared.quote_id,
          quote_number: prepared.quote_number,
          state: prepared.state,
          currency: prepared.currency,
          grand_total: prepared.grand_total,
          approval_required: prepared.approval_required,
          voice_safe_message: prepared.voice_safe_message,
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
