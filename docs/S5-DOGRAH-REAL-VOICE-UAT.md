# S5 Dograh Real Voice UAT

This runbook moves the verified local S5 path to a real Dograh phone workflow.

Core guardrail:

> AI proposes. Bridge orchestrates. Bidwright calculates. Human approves. Platform delivers.

Dograh may call only `search_offerings`, `capture_hvac_intake`, `prepare_quote`, and native Dograh `transfer_to_human`.

Dograh must not receive tools for approval, rejection, PDF export, or delivery.

## 1. Expose Bridge through public HTTPS

Start the Bridge locally first:

```powershell
cd "C:\Users\user\Documents\00-NHL Global Solution\P04-SalesBot\frontdesk-q"
corepack pnpm dev
```

Expose port `4170` through either staging hosting or a tunnel.

Cloudflare quick tunnel example:

```powershell
cloudflared tunnel --url http://127.0.0.1:4170
```

Use the emitted `https://...trycloudflare.com` URL as `PUBLIC_BRIDGE_URL`.

## 2. Generate the Dograh runtime credential bundle

In a second terminal:

```powershell
cd "C:\Users\user\Documents\00-NHL Global Solution\P04-SalesBot\frontdesk-q"
$env:PUBLIC_BRIDGE_URL = "https://YOUR-PUBLIC-BRIDGE.example"
corepack pnpm exec tsx --env-file=.env scripts\s5-dograh-public-bridge-readiness.mjs
```

The script creates a short-lived tenant-scoped `ai_runtime` Bridge bearer token, stores the Bridge/Dograh connection row, verifies `/v1/dograh/session` and `/v1/dograh/tools` through public HTTPS, and writes local-only Dograh credential/tool files under:

```text
artifacts/s5-dograh-real-voice
```

The `artifacts` folder is gitignored. Do not paste the bearer token into chat.

## 3. Configure Dograh

### Free self-hosted path now verified

Self-hosted Dograh is configured locally for Frontdesk-Q:

```text
Dograh UI:  http://127.0.0.1:4174
Dograh API: http://127.0.0.1:4172
Dograh public tunnel: https://xml-ambient-cute-comprehensive.trycloudflare.com
Bridge public tunnel: https://passing-pics-stars-danny.trycloudflare.com
```

Automation commands:

```powershell
cd "C:\Users\user\Documents\00-NHL Global Solution\P04-SalesBot\frontdesk-q"
$env:PUBLIC_BRIDGE_URL = "https://passing-pics-stars-danny.trycloudflare.com"
corepack pnpm exec tsx --env-file=.env scripts\s5-dograh-public-bridge-readiness.mjs
$env:PUBLIC_BRIDGE_URL = "http://host.docker.internal:4170"
corepack pnpm exec tsx --env-file=.env scripts\s5-configure-selfhosted-dograh.mjs
corepack pnpm exec tsx --env-file=.env scripts\s5-dograh-tool-chain-uat.mjs
```

Important contract note: Dograh self-host tool tests do not render `{{workflow_run_id}}` inside headers. Bridge therefore derives mutation idempotency from the request body `workflow_run_id` when the idempotency header is missing or still contains an unresolved template. Keep `workflow_run_id` in the body template for capture and prepare tools.

## 3A. Manual Dograh configuration

Create a Dograh bearer-token credential from:

```text
artifacts/s5-dograh-real-voice/dograh-bridge-runtime-credential.local.json
```

Then copy the returned Dograh credential UUID into the three HTTP tool configs from:

```text
artifacts/s5-dograh-real-voice/dograh-http-tools.local.json
```

The three tool URLs must be:

```text
https://YOUR-PUBLIC-BRIDGE/v1/dograh/tools/search-offerings
https://YOUR-PUBLIC-BRIDGE/v1/dograh/tools/capture-hvac-intake
https://YOUR-PUBLIC-BRIDGE/v1/dograh/tools/prepare-quote
```

Required preset headers:

```text
Authorization: Bearer <stored in Dograh credential>
x-tenant-id: tenant_hvac_pilot
content-type: application/json
```

Mutation idempotency: include `workflow_run_id` in each mutation tool body. Bridge will derive the idempotency key safely from that body value. Do not rely on Dograh rendering `{{workflow_run_id}}` inside headers.

## 4. Publish and run one phone call

Attach the three Frontdesk-Q HTTP tools plus Dograh native `transfer_to_human`.

Do not attach approval, rejection, delivery, or PDF-export tools.

Use this caller scenario:

```text
Name: Ahmad Rahman
Phone: +60123456789
Location: Ipoh, Perak
Building: office
Request: supply and install 3 x 2HP inverter air conditioners
Timing: next week
```

Expected result:

- Bridge intake source channel is `dograh_voice`.
- Bridge quote status is `pending_approval`.
- Grand total is calculated by Bridge/Bidwright, not Dograh.
- AI/runtime approval attempt remains forbidden.
- Human operator can later approve and deliver through the console.

After the real call, capture the Dograh workflow run ID and Bridge quote ID in `CURRENT-SPRINT-PLAN.md`.

## 5. Human transfer Web Call UAT

Configure the native Dograh transfer target before the live Web Call:

```powershell
cd "C:\Users\user\Documents\00-NHL Global Solution\P04-SalesBot\frontdesk-q"
corepack pnpm exec tsx --env-file=.env scripts\s5-configure-dograh-transfer-target.mjs
```

By default, local development uses this safe non-dialing transfer target:

```text
PJSIP/frontdesk-human
```

Use a real SIP/PSTN destination only when you are ready for carrier UAT:

```powershell
$env:DOGRAH_TRANSFER_TARGET = "sip:operator@your-pbx.example.com"
corepack pnpm exec tsx --env-file=.env scripts\s5-configure-dograh-transfer-target.mjs
```

Run the backend transfer drill before audio UAT:

```powershell
corepack pnpm exec tsx --env-file=.env scripts\s5-dograh-transfer-drill.mjs
```

Expected backend result:

- `frontdesk_q_transfer_to_human` appears as `tool_call_started`.
- `frontdesk_q_transfer_to_human` appears as `tool_call_result`.
- No approval, PDF export, delivery, or quote-send tool is exposed to Dograh.

Manual Web Call steps:

1. Open Dograh UI: <http://127.0.0.1:4174/workflow>
2. Open `Frontdesk - inbound`.
3. Start the Test/Web Call panel.
4. Say clearly: `I want to speak to a human.`
5. Expected voice behaviour: Dograh stops HVAC intake and says it will connect the caller to a human operator.
6. Expected run evidence: the run includes `frontdesk_q_transfer_to_human`.
7. In local-only mode, actual call bridging may not complete unless a PBX/SIP/PSTN target exists. The local pass gate is the transfer tool invocation and safe handoff message.
8. Record the Dograh workflow run ID and result in `CURRENT-SPRINT-PLAN.md`.

## 6. Controlled Bidwright outage drill

Run this after Web Call and transfer-tool UAT, before real telephony/SIP UAT:

```powershell
cd "C:\Users\user\Documents\00-NHL Global Solution\P04-SalesBot\frontdesk-q"
corepack pnpm exec tsx --env-file=.env scripts\s5-dograh-outage-drill.mjs
```

The drill starts a disposable Bridge on `http://127.0.0.1:4179` and points only that disposable process at a dead Bidwright URL, `http://127.0.0.1:4199`. It does not stop or mutate the normal app ports `4170` through `4174`.

Expected result:

- Dograh `ai_runtime` can authenticate against the disposable Bridge.
- Offering search and intake capture still work.
- `prepare_quote` returns `409 UPSTREAM_STATE_UNKNOWN` when Bidwright is unavailable.
- The Bridge operation is marked `upstream_unknown` for reconciliation.
- The quote shell is marked `upstream_unknown` with no quote number, no Bidwright project/quote/revision IDs, and no grand total.
- Reusing the same idempotency key with a changed body returns `IDEMPOTENCY_KEY_REUSED`.

This is the safe-failure gate: Dograh must never invent a quote total or advance to approval/delivery when Bidwright is unavailable.
## 7. Telephony/SIP readiness gate

Before claiming real phone transfer UAT, run:

```powershell
cd "C:\Users\user\Documents\00-NHL Global Solution\P04-SalesBot\frontdesk-q"
corepack pnpm exec tsx --env-file=.env scripts\s5-telephony-readiness.mjs
```

The readiness gate checks:

- Dograh API is reachable.
- `Frontdesk - inbound` exists.
- `frontdesk_q_transfer_to_human` exists and is attached to both Start Call and Main Agenda.
- Transfer destination is a real SIP/PSTN target, not the local placeholder `PJSIP/frontdesk-human`.
- Dograh has at least one active telephony configuration.
- At least one active phone/SIP address routes inbound calls to workflow `1`.

Current local result on 2026-08-31:

- Dograh API and workflow are reachable.
- Transfer tool is configured and attached correctly.
- Dograh has an active `Dograh Cloudonix SIP` config, but it has zero routed numbers.
- Transfer target is still the safe placeholder `PJSIP/frontdesk-human`.
- Real phone bridging is therefore not ready yet.

For the free/self-hosted path, use Dograh ARI/Asterisk instead of a paid carrier path.

### Automated ARI/Asterisk configuration

When an Asterisk/ARI endpoint is available, configure Dograh from the repo:

```powershell
cd "C:\Users\user\Documents\00-NHL Global Solution\P04-SalesBot\frontdesk-q"

$env:DOGRAH_ARI_ENDPOINT = "http://127.0.0.1:8088"
$env:DOGRAH_ARI_APP_NAME = "dograh"
$env:DOGRAH_ARI_APP_PASSWORD = "<local-ari-password>"
$env:DOGRAH_ARI_WS_CLIENT_NAME = "dograh_local"
$env:DOGRAH_INBOUND_SIP_ADDRESS = "sip:frontdesk@127.0.0.1"

corepack pnpm exec tsx --env-file=.env scripts\s5-configure-dograh-ari-telephony.mjs
```

The script creates or updates a Dograh `ari` telephony configuration, adds the inbound SIP/PJSIP address if needed, and routes it to workflow `1` / `Frontdesk - inbound`.

The script intentionally fails safe until these real values exist:

- `DOGRAH_ARI_ENDPOINT`
- `DOGRAH_ARI_APP_NAME`
- `DOGRAH_ARI_APP_PASSWORD`
- `DOGRAH_INBOUND_SIP_ADDRESS`

It writes local ignored evidence to:

```text
artifacts/s5-dograh-real-voice/dograh-ari-telephony-config.local.json
```

Then configure the real human transfer destination and rerun readiness:

```powershell
$env:DOGRAH_TRANSFER_TARGET = "PJSIP/operator-extension"
corepack pnpm exec tsx --env-file=.env scripts\s5-configure-dograh-transfer-target.mjs
corepack pnpm exec tsx --env-file=.env scripts\s5-telephony-readiness.mjs
```

For a paid PSTN carrier later, `DOGRAH_TRANSFER_TARGET` may be an E.164 number such as `+60123456789`, but do not use that for the free/self-hosted gate.

### Manual ARI/Asterisk configuration

If configuring through the UI instead:

1. In Dograh UI, open <http://127.0.0.1:4174/telephony-configurations>.
2. Create an `ari` / Asterisk REST Interface telephony configuration.
3. Required ARI fields:
   - `ari_endpoint`: your Asterisk ARI base URL, for example `http://127.0.0.1:8088` or a LAN host URL.
   - `app_name`: ARI username from `ari.conf`.
   - `app_password`: ARI password from `ari.conf`.
   - `ws_client_name`: the configured websocket client name when externalMedia requires it.
4. Add one active phone/SIP address to that config.
5. Route that address to workflow `1` / `Frontdesk - inbound`.
6. Configure the real human transfer destination and rerun the readiness gate.

Real phone UAT pass criteria:

- Inbound caller reaches Dograh through the configured phone/SIP address.
- Caller says: `I want to speak to a human.`
- Dograh invokes `frontdesk_q_transfer_to_human`.
- Telephony provider bridges the call to the configured human destination.
- UAT evidence records Dograh workflow run ID, provider call ID, transfer destination, and transfer outcome.
