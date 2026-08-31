import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const dograhBaseUrl = (process.env.DOGRAH_BASE_URL ?? 'http://127.0.0.1:4172').replace(/\/+$/, '');
const artifactDir = resolve('artifacts', 's5-dograh-real-voice');
const adminPath = resolve(artifactDir, 'dograh-selfhost-admin.local.json');
const workflowId = Number(process.env.DOGRAH_WORKFLOW_ID ?? 1);
const transferToolName = process.env.DOGRAH_TRANSFER_TOOL_NAME ?? 'frontdesk_q_transfer_to_human';
const utterance = process.env.DOGRAH_TRANSFER_TEST_UTTERANCE ?? 'I want to speak to a human.';

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
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${method} ${pathname} failed ${response.status}: ${text}`);
  }
  return payload;
}

function compactTurn(turn) {
  return {
    id: turn.id,
    status: turn.status,
    user_text: turn.user_text ?? null,
    assistant_text: turn.assistant_text ?? turn.output_text ?? turn.text ?? null,
    events: (turn.events ?? []).map((event) => ({
      type: event.type,
      name: event.name ?? event.payload?.function_name ?? event.payload?.tool_name ?? event.payload?.name ?? null,
      status: event.status ?? event.payload?.status ?? null,
    })),
  };
}

function collectToolSignals(session) {
  const signals = [];
  for (const turn of session.session_data?.turns ?? []) {
    for (const event of turn.events ?? []) {
      const raw = JSON.stringify(event).toLowerCase();
      if (raw.includes('transfer') || raw.includes(transferToolName.toLowerCase())) {
        signals.push({
          turn_id: turn.id,
          event_type: event.type ?? null,
          name: event.name ?? event.payload?.function_name ?? event.payload?.tool_name ?? event.payload?.name ?? null,
          status: event.status ?? event.payload?.status ?? null,
        });
      }
    }
  }
  return signals;
}

async function main() {
  const admin = await readJson(adminPath);
  const token = admin.token;

  const session = await dograh(`/workflow/${workflowId}/text-chat/sessions`, {
    method: 'POST',
    token,
    body: {
      name: `S5 transfer drill ${new Date().toISOString()}`,
      annotations: {
        frontdesk_q: {
          drill: 'human_transfer',
          modality: 'text_probe_before_web_call',
        },
      },
    },
  });

  const afterMessage = await dograh(
    `/workflow/${workflowId}/text-chat/sessions/${session.workflow_run_id}/messages`,
    {
      method: 'POST',
      token,
      body: {
        text: utterance,
        expected_revision: session.revision,
      },
    },
  );

  const transferSignals = collectToolSignals(afterMessage);
  const compactTranscript = (afterMessage.session_data?.turns ?? []).map(compactTurn);
  const assistantTexts = compactTranscript.map((turn) => turn.assistant_text).filter(Boolean);

  await mkdir(artifactDir, { recursive: true });
  const evidencePath = resolve(artifactDir, 'dograh-transfer-drill.local.json');
  const evidence = {
    ok: transferSignals.length > 0,
    dograh_base_url: dograhBaseUrl,
    workflow_id: workflowId,
    workflow_run_id: afterMessage.workflow_run_id,
    utterance,
    transfer_tool_name: transferToolName,
    transfer_signals: transferSignals,
    assistant_texts: assistantTexts,
    compact_transcript: compactTranscript,
    evidence_path: evidencePath,
    note: transferSignals.length > 0
      ? 'Transfer signal observed in Dograh text-chat drill. Proceed to Web Call UAT.'
      : 'No transfer signal observed. Do not mark Web Call transfer UAT passed yet.',
  };
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2));

  console.log(JSON.stringify(evidence, null, 2));
  if (!evidence.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
