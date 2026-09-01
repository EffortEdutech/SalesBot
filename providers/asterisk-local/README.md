# Frontdesk-Q local Asterisk test stack

This is a development-only PBX lab for S5 Dograh real phone/SIP UAT.

It gives us:

- ARI endpoint on `http://127.0.0.1:8088`
- Dograh ARI user `dograh`
- Dograh WebSocket client name `dograh_local`
- caller SIP extension `1001`
- human/operator SIP extension `1002`
- Dograh inbound extension `7001`

The committed passwords are local development defaults only. Do not reuse them outside this local lab.

## Test topology

```text
Softphone 1001 -> Asterisk extension 7001 -> Stasis(<Dograh generated app>) -> Dograh workflow 1
Dograh transfer tool -> PJSIP/1002 -> human/operator softphone
```

## Ports

| Port | Purpose |
| ---- | ------- |
| 5060 UDP/TCP | SIP signalling |
| 8088 TCP | Asterisk HTTP/ARI |
| 10000-10020 UDP | RTP audio |

## Basic flow

From `frontdesk-q`:

```powershell
$env:DOGRAH_ARI_ENDPOINT = "http://host.docker.internal:8088"
$env:DOGRAH_ARI_APP_NAME = "dograh"
$env:DOGRAH_ARI_APP_PASSWORD = "frontdeskq_ari_dev_only"
$env:DOGRAH_ARI_WS_CLIENT_NAME = "dograh_local"
$env:DOGRAH_INBOUND_SIP_ADDRESS = "7001"
corepack pnpm exec tsx --env-file=.env scripts\s5-configure-dograh-ari-telephony.mjs

corepack pnpm exec tsx --env-file=.env scripts\s5-render-asterisk-local-config.mjs

docker compose -f providers\asterisk-local\docker-compose.yaml up -d

$env:DOGRAH_TRANSFER_TARGET = "PJSIP/1002"
corepack pnpm exec tsx --env-file=.env scripts\s5-configure-dograh-transfer-target.mjs
corepack pnpm exec tsx --env-file=.env scripts\s5-telephony-readiness.mjs
corepack pnpm exec tsx --env-file=.env scripts\s5-check-asterisk-local.mjs
```

Then register two SIP softphones:

| Role | SIP username | Password | Domain / host | Port |
| ---- | ------------ | -------- | ------------- | ---- |
| Caller | `1001` | `frontdesk1001` | `127.0.0.1` | `5060` |
| Human/operator | `1002` | `frontdesk1002` | `127.0.0.1` | `5060` |

From caller `1001`, dial:

```text
7001
```

Say:

```text
I want to speak to a human.
```

Expected:

- Dograh creates a real telephony/SIP run, not a Web Call run.
- The run calls `frontdesk_q_transfer_to_human`.
- Asterisk attempts transfer/bridge to `PJSIP/1002`.
- Softphone `1002` rings or receives the transferred call.

## Useful checks

```powershell
docker compose -f providers\asterisk-local\docker-compose.yaml logs --tail=120 asterisk
docker exec -it frontdeskq-asterisk-local asterisk -rvvv
```

Inside the Asterisk CLI:

```text
pjsip show contacts
pjsip show endpoints
ari show apps
dialplan show local-softphones
```
