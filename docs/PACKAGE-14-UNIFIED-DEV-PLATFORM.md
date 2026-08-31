# Package 14 — Unified SalesBot Development Platform

Package 14 removes the normal need to juggle multiple PowerShell windows during SalesBot development.

## Target developer experience

From the repository root:

```powershell
pnpm dev
```

This starts, in one terminal:

- SalesBot Bridge API on `http://127.0.0.1:4170`
- SalesBot Operator Console on `http://127.0.0.1:4173`
- Vite `/bridge` proxy fixed to Bridge port `4170`
- Browser auto-open by default

Bidwright remains the self-hosted upstream target on `http://127.0.0.1:4171`.

## Root `.env`

The Bridge development process now starts Node with the repository-root `.env`:

```text
apps/bridge-api -> ../../.env
```

The Vite application also uses the repository root as its `envDir`.

This removes the previous mismatch where `.env` existed but the Bridge process only saw variables manually exported into a particular PowerShell session.

Shell/process environment values still take precedence where Node/Vite provides them. Package 14's unified launcher explicitly freezes the development Bridge port and proxy target to `4170`.

## Operator System screen

The existing Connection screen is upgraded to a System screen backed by:

```http
GET /v1/operator/system
```

This authenticated human-only route reports:

- Bridge process state
- SalesBot PostgreSQL reachability
- migration/table/critical-column readiness
- authenticated tenant
- authenticated operator token identity
- Bidwright configured/reachable state
- current tenant price-book state
- Dograh tenant-connection state

The endpoint does **not** expose:

- `DATABASE_URL`
- `BRIDGE_TOKEN_PEPPER`
- Bidwright service password
- raw operator bearer token

## Connection verification

The browser now verifies the operator session before accepting it. `Verify & connect` calls the authenticated system endpoint first. An invalid token or unreachable Bridge is shown on the connection screen instead of silently opening a broken console session.

## Financial invariant

Package 14 does not change financial authority. The browser still cannot submit authoritative price, cost, markup, tax, or total values to quote preparation.

The architecture remains:

```text
Customer
→ Dograh AI Frontdesk
→ SalesBot Bridge
→ Bidwright REST API
→ deterministic estimate / quote
→ human approval
→ delivery
```

No browser-to-Bidwright path is introduced.
