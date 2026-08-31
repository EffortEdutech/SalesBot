# Frontdesk-Q

V1 Bridge foundation for:

```text
Dograh → Bridge API → Bidwright
```

Quick start:

```bash
corepack enable
pnpm install
cp .env.example .env
pnpm dev
```

Public:

- `GET /health`
- `GET /ready`

All `/v1/*` requests are tenant authenticated.

Live Bidwright mutation contract tests are OFF by default and must only run
against a disposable test organization/database.

## M1 runtime endpoints

```text
POST /v1/intakes
POST /v1/offerings/search
POST /v1/prices/resolve
POST /v1/quotes/prepare
GET  /v1/quotes/:quoteId/status
```

Provision the synthetic HVAC test book only in development/staging:

```bash
pnpm provision:hvac-pilot
```

Run deterministic M1 tests:

```bash
pnpm test:m1
```
