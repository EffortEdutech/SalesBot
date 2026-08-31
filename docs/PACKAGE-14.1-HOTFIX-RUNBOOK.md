# Package 14.1 — Unified Dev Platform Hotfix

This patch fixes the validation failures found during the first live Package 14 bring-up.

## Fixes

1. Adds `OPERATOR_IDENTITY_NOT_FOUND` to the shared Bridge error-code union.
2. Fixes the `quote-routes.ts` Zod helper so TypeScript sees schema output defaults.
   This removes the false `body.source possibly undefined` errors.
3. Makes Bidwright rate-schedule tier resolution explicitly non-optional.
4. Reasserts the SalesBot web package manifest containing Vite and React plugin
   development dependencies.

## Apply

Extract this ZIP from the directory that contains `frontdesk-q`, allowing overwrite.

Then, from the `frontdesk-q` root:

```powershell
pnpm install

pnpm --filter @frontdesk-q/bridge-api typecheck
pnpm --filter @frontdesk-q/bridge-api test

pnpm --filter @frontdesk-q/salesbot-web typecheck
pnpm --filter @frontdesk-q/salesbot-web test
```

If all four gates pass:

```powershell
pnpm dev
```

Expected local endpoints:

- Bridge: http://127.0.0.1:4170
- SalesBot Operator Console: http://127.0.0.1:4173
- Bidwright target: http://127.0.0.1:4171

`pnpm install` is required after adding/updating the SalesBot web workspace so pnpm
creates the local Vite dependency links.
