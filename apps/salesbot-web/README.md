# SalesBot Operator Console

First real visual/operator surface for the M1 SalesBot backend.

## Screens

- Overview
- Leads / Intakes
- Deterministic Quote Builder
- Quotes
- Offering / Price Lookup
- Bridge Operations
- Connection

## Install / register

From repository root after extracting package 13:

```bash
node scripts/apply-package-13.mjs
pnpm install
pnpm --filter @frontdesk-q/salesbot-web typecheck
pnpm --filter @frontdesk-q/salesbot-web test
pnpm --filter @frontdesk-q/salesbot-web dev
```

Open:

```text
http://localhost:4173
```

The Vite server proxies `/bridge` to `http://127.0.0.1:4100` by default.

## Current authentication

Development/staging only: enter a human-role Bridge token in the connection screen.
It is kept in browser `sessionStorage` only.

`ai_runtime` is explicitly blocked from the operator-read endpoints.

## Financial rule

The quote builder never sends authoritative:

```text
price
cost
markup
tax
total
```

to `/v1/quotes/prepare`.

It sends only the Bridge-approved:

```text
offering_ref
quantity
uom
```

Bidwright remains the calculation authority.
