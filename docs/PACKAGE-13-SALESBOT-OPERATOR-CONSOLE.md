# Package 13 — SalesBot Operator Console

Architecture:

```text
Browser: apps/salesbot-web
          ↓
       Bridge API
       ├── SalesBot PostgreSQL / Supabase
       └── Bidwright REST API
```

The web app never connects directly to Bidwright or Bidwright PostgreSQL.

Package 13 adds four human-operator read endpoints:

```http
GET /v1/operator/overview
GET /v1/operator/intakes
GET /v1/operator/quotes
GET /v1/operator/operations
```

All use the authenticated token's tenant ID in SQL.

AI runtime credentials are rejected from these endpoints.

## Safe integration

The ZIP deliberately does **not** replace the existing M1 `apps/bridge-api/src/server.ts`.

Run:

```bash
node scripts/apply-package-13.mjs
```

The script adds:

```ts
import { registerOperatorRoutes } from './routes/operator-routes.js';
registerOperatorRoutes(app, pool);
```

while preserving the M1 pricing/quote route registrations already present.

## Not production-auth complete

Before a real customer pilot, add:

- named human user identity
- secure session
- tenant membership
- approval RBAC
- audit actor identity
- session revocation/expiry

The current token screen is a development/staging operating tool.
