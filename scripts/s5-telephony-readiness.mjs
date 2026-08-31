import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const dograhBaseUrl = (process.env.DOGRAH_BASE_URL ?? 'http://127.0.0.1:4172').replace(/\/+$/, '');
const artifactDir = resolve('artifacts', 's5-dograh-real-voice');
const adminPath = resolve(artifactDir, 'dograh-selfhost-admin.local.json');
const workflowId = Number(process.env.DOGRAH_WORKFLOW_ID ?? 1);
const transferToolName = process.env.DOGRAH_TRANSFER_TOOL_NAME ?? 'frontdesk_q_transfer_to_human';
const placeholderTargets = new Set(['PJSIP/frontdesk-human', 'sip:operator@your-pbx.example.com']);

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

function findTransferTool(workflowDefinition, transferToolUuid) {
  const nodes = workflowDefinition?.nodes ?? [];
  const attachedNodes = nodes
    .filter((node) => (node.data?.tool_uuids ?? []).includes(transferToolUuid))
    .map((node) => ({ node_id: node.id, node_type: node.type, node_name: node.data?.name ?? null }));
  return attachedNodes;
}

function transferDestination(tool) {
  return tool?.definition?.config?.destination ?? tool?.definition?.destination ?? null;
}

function isRealTarget(target) {
  if (!target || placeholderTargets.has(target)) return false;
  if (/^\+\d{8,15}$/.test(target)) return true;
  if (/^sip:[^\s@]+@[^\s@]+\.[^\s@]+/i.test(target)) return true;
  if (/^PJSIP\/(?!frontdesk-human$).+/i.test(target)) return true;
  return false;
}

async function main() {
  const admin = await readJson(adminPath);
  const token = admin.token;
  const checks = [];
  const blockers = [];
  const warnings = [];

  const health = await dograh('/health', { token, allow: [404] });
  checks.push({ name: 'Dograh API reachable', ok: health.status < 500, status: health.status });

  const workflow = (await dograh(`/workflow/fetch/${workflowId}`, { token })).payload;
  checks.push({ name: 'Frontdesk workflow exists', ok: Boolean(workflow?.id), workflow_id: workflow?.id, workflow_name: workflow?.name });

  const tools = (await dograh('/tools/', { token })).payload;
  const transferTool = tools.find((tool) => tool.name === transferToolName);
  const destination = transferDestination(transferTool);
  const realTarget = isRealTarget(destination);
  checks.push({ name: 'Transfer tool exists', ok: Boolean(transferTool), tool_uuid: transferTool?.tool_uuid ?? null });
  checks.push({ name: 'Transfer target is real SIP/PSTN target', ok: realTarget, destination });
  if (!realTarget) {
    blockers.push('DOGRAH_TRANSFER_TARGET is still a safe placeholder. Set it to a real SIP endpoint, PJSIP endpoint, or E.164 phone number, then rerun scripts/s5-configure-dograh-transfer-target.mjs.');
  }

  const attachedNodes = transferTool ? findTransferTool(workflow.workflow_definition, transferTool.tool_uuid) : [];
  const attachedToStart = attachedNodes.some((node) => node.node_type === 'startCall');
  const attachedToAgent = attachedNodes.some((node) => node.node_type === 'agentNode');
  checks.push({ name: 'Transfer tool attached to Start Call', ok: attachedToStart, attached_nodes: attachedNodes });
  checks.push({ name: 'Transfer tool attached to main agent node', ok: attachedToAgent, attached_nodes: attachedNodes });
  if (!attachedToStart || !attachedToAgent) {
    blockers.push('Transfer tool is not attached to both Start Call and Main Agenda. Rerun scripts/s5-configure-dograh-transfer-target.mjs.');
  }

  const telephonyList = (await dograh('/organizations/telephony-configs', { token })).payload;
  const configs = telephonyList.configurations ?? [];
  const activeConfigs = configs.filter((config) => !config.inactive);
  checks.push({ name: 'At least one active telephony configuration exists', ok: activeConfigs.length > 0, count: activeConfigs.length, configurations: activeConfigs.map((config) => ({ id: config.id, name: config.name, provider: config.provider, connectivity: config.connectivity, phone_number_count: config.phone_number_count, is_ready_for_outbound: config.is_ready_for_outbound, outbound_blocked_reason: config.outbound_blocked_reason })) });
  if (activeConfigs.length === 0) {
    blockers.push('No active Dograh telephony configuration exists. For free/self-hosted, create an ARI/Asterisk configuration in Dograh Telephony.');
  }

  const configDetails = [];
  for (const config of activeConfigs) {
    const detail = (await dograh(`/organizations/telephony-configs/${config.id}`, { token })).payload;
    const numbers = (await dograh(`/organizations/telephony-configs/${config.id}/phone-numbers`, { token })).payload.phone_numbers ?? [];
    const activeNumbers = numbers.filter((number) => number.is_active !== false);
    const routedNumbers = activeNumbers.filter((number) => number.inbound_workflow_id === workflowId);
    configDetails.push({
      id: config.id,
      name: config.name,
      provider: config.provider,
      connectivity: config.connectivity,
      inactive: config.inactive,
      supports_trunks: detail.supports_trunks,
      ready_for_outbound: detail.setup_checklist?.ready_for_outbound ?? config.is_ready_for_outbound ?? null,
      outbound_blocked_reason: detail.setup_checklist?.outbound_blocked_reason ?? config.outbound_blocked_reason ?? null,
      phone_numbers: activeNumbers.map((number) => ({
        id: number.id,
        address: number.address_normalized ?? number.address,
        inbound_workflow_id: number.inbound_workflow_id,
        inbound_workflow_name: number.inbound_workflow_name ?? null,
        is_default_caller_id: number.is_default_caller_id ?? false,
      })),
      routed_to_frontdesk_count: routedNumbers.length,
    });
  }
  const hasRoutedInbound = configDetails.some((config) => config.routed_to_frontdesk_count > 0);
  checks.push({ name: 'At least one active phone/SIP address routes inbound calls to Frontdesk workflow', ok: hasRoutedInbound, workflow_id: workflowId });
  if (!hasRoutedInbound) {
    blockers.push('No active telephony phone/SIP address is routed to Frontdesk workflow 1. Add a phone number/SIP address and set inbound_workflow_id=1.');
  }

  const hasAri = activeConfigs.some((config) => config.provider === 'ari');
  if (!hasAri) warnings.push('Free self-hosted path should use Dograh ARI/Asterisk. Paid carrier paths include Telnyx/Twilio/Plivo.');

  const evidence = {
    ok: blockers.length === 0,
    dograh_base_url: dograhBaseUrl,
    workflow_id: workflowId,
    transfer_tool_name: transferToolName,
    transfer_tool_uuid: transferTool?.tool_uuid ?? null,
    transfer_destination: destination,
    checks,
    telephony_configurations: configDetails,
    blockers,
    warnings,
    next_manual_uat: blockers.length === 0
      ? [
          'Place an inbound call to the configured Dograh phone/SIP address.',
          'Say: I want to speak to a human.',
          'Expected: Dograh invokes frontdesk_q_transfer_to_human and the telephony provider bridges to the configured destination.',
          'Record Dograh workflow run ID, provider call ID, destination, and transfer outcome in CURRENT-SPRINT-PLAN.md.',
        ]
      : [
          'Create/activate Dograh ARI/Asterisk telephony configuration or another provider configuration.',
          'Route an active phone/SIP address to workflow 1.',
          'Set DOGRAH_TRANSFER_TARGET to the real human destination and rerun scripts/s5-configure-dograh-transfer-target.mjs.',
          'Rerun this readiness script.',
        ],
  };

  await mkdir(artifactDir, { recursive: true });
  const evidencePath = resolve(artifactDir, 'dograh-telephony-readiness.local.json');
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ ...evidence, evidence_path: evidencePath }, null, 2));
  if (!evidence.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
