import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const dograhBaseUrl = (process.env.DOGRAH_BASE_URL ?? 'http://127.0.0.1:4172').replace(/\/+$/, '');
const artifactDir = resolve('artifacts', 's5-dograh-real-voice');
const adminPath = resolve(artifactDir, 'dograh-selfhost-admin.local.json');
const provisioningPath = resolve(artifactDir, 'dograh-selfhost-provisioning.local.json');
const transferTarget = process.env.DOGRAH_TRANSFER_TARGET ?? 'PJSIP/frontdesk-human';
const transferToolName = process.env.DOGRAH_TRANSFER_TOOL_NAME ?? 'frontdesk_q_transfer_to_human';
const workflowName = process.env.DOGRAH_WORKFLOW_NAME ?? 'Frontdesk - inbound';

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

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function transferDefinition() {
  return {
    name: transferToolName,
    description:
      'Transfer the caller to a human operator when the caller asks for a person, becomes frustrated, has an unsupported request, or the assistant is unsure.',
    category: 'transfer_call',
    icon: 'phone-forwarded',
    icon_color: '#F97316',
    definition: {
      schema_version: 1,
      type: 'transfer_call',
      config: {
        destination_source: 'static',
        destination: transferTarget,
        messageType: 'custom',
        customMessage: 'Sure, I will connect you to a human operator now.',
        timeout: 30,
        parameters: [
          {
            name: 'reason',
            type: 'string',
            description: 'Short reason why the caller should be transferred to a human.',
            required: true,
          },
        ],
      },
    },
  };
}

function addTransferPrompt(prompt) {
  const marker = '## Human transfer rule';
  if (prompt.includes(marker)) return prompt;
  return `${prompt.trim()}

${marker}
- If the caller asks for a human, person, staff, manager, estimator, or operator, call the frontdesk_q_transfer_to_human tool immediately.
- Also transfer if the request is unsupported, urgent, angry, legally sensitive, or you are unsure.
- Do not continue collecting quote details after a clear human-transfer request.`;
}

async function main() {
  const admin = await readJson(adminPath);
  const provisioning = await readJson(provisioningPath);
  const token = admin.token;

  const tools = (await dograh('/tools/', { token })).payload;
  let transferTool = tools.find((tool) => tool.name === transferToolName);
  const definition = transferDefinition();

  if (transferTool) {
    transferTool = (
      await dograh(`/tools/${transferTool.tool_uuid}`, {
        method: 'PUT',
        token,
        body: definition,
      })
    ).payload;
  } else {
    transferTool = (
      await dograh('/tools/', {
        method: 'POST',
        token,
        body: definition,
      })
    ).payload;
  }

  const workflowsResponse = await dograh('/workflow/fetch', { token });
  const workflows = Array.isArray(workflowsResponse.payload)
    ? workflowsResponse.payload
    : workflowsResponse.payload.workflows ?? workflowsResponse.payload.items ?? [];
  const workflowSummary = workflows.find((workflow) => workflow.name === workflowName) ?? workflows[0];
  if (!workflowSummary) throw new Error('No Dograh workflow found to update.');

  const workflow = (await dograh(`/workflow/fetch/${workflowSummary.id}`, { token })).payload;
  const workflowDefinition = structuredClone(workflow.workflow_definition);
  const transferCapableNodes = workflowDefinition.nodes.filter((node) =>
    ['startCall', 'agentNode'].includes(node.type),
  );
  if (transferCapableNodes.length === 0) {
    throw new Error(`No transfer-capable start/agent node found in workflow ${workflowSummary.id}.`);
  }

  const bridgeToolUuids = [
    provisioning.tool_uuids?.frontdesk_q_capture_hvac_intake,
    provisioning.tool_uuids?.frontdesk_q_search_offerings,
    provisioning.tool_uuids?.frontdesk_q_prepare_quote,
  ];
  for (const node of transferCapableNodes) {
    const existingToolUuids = node.data.tool_uuids ?? [];
    const nodeTools = node.type === 'agentNode' ? [...bridgeToolUuids, transferTool.tool_uuid] : [transferTool.tool_uuid];
    node.data.tool_uuids = unique([...existingToolUuids, ...nodeTools]);
    node.data.prompt = addTransferPrompt(node.data.prompt ?? '');
  }

  const globalNode = workflowDefinition.nodes.find((node) => node.type === 'globalNode');
  if (globalNode?.data?.prompt) {
    globalNode.data.prompt = addTransferPrompt(globalNode.data.prompt);
  }

  const updated = (
    await dograh(`/workflow/${workflow.id}`, {
      method: 'PUT',
      token,
      body: {
        name: workflow.name,
        workflow_definition: workflowDefinition,
        workflow_configurations: workflow.workflow_configurations ?? {},
      },
    })
  ).payload;

  const validation = (await dograh(`/workflow/${workflow.id}/validate`, { method: 'POST', token })).payload;
  if (validation.valid === false) {
    throw new Error(`Updated Dograh workflow is invalid: ${JSON.stringify(validation)}`);
  }

  const published = (await dograh(`/workflow/${workflow.id}/publish`, { method: 'POST', token })).payload;

  await mkdir(artifactDir, { recursive: true });
  const evidencePath = resolve(artifactDir, 'dograh-transfer-target.local.json');
  const evidence = {
    ok: true,
    dograh_base_url: dograhBaseUrl,
    workflow: {
      id: workflow.id,
      name: workflow.name,
      status: updated.status,
      validation,
      published: {
        id: published.id ?? workflow.id,
        status: published.status ?? null,
        current_definition_id: published.current_definition_id ?? null,
      },
    },
    transfer_tool: {
      uuid: transferTool.tool_uuid,
      name: transferTool.name,
      category: transferTool.category,
      status: transferTool.status,
      destination: transferTarget,
    },
    attached_tools_by_node: transferCapableNodes.map((node) => ({
      node_id: node.id,
      node_type: node.type,
      node_name: node.data.name,
      tool_uuids: node.data.tool_uuids ?? [],
    })),
    web_call_test_prompt: 'I want to speak to a human.',
    expected_web_call_behavior:
      'Dograh should stop quote intake and invoke the transfer tool or announce transfer to a human operator.',
    production_note:
      'Replace DOGRAH_TRANSFER_TARGET with a real SIP/PSTN destination before real phone UAT.',
  };
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2));

  console.log(JSON.stringify({ ...evidence, evidence_path: evidencePath }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

