# Build Readiness

Implemented in the repository snapshot:

- TypeScript/pnpm monorepo foundation
- Bridge `/health` and `/ready`
- tenant bearer auth and isolation
- RBAC foundation
- PostgreSQL migrations 001–003
- lease-based idempotency / resumable saga checkpoints
- pinned Bidwright auth/client adapter and opt-in contract suite
- HVAC synthetic price-book provisioning
- tenant price-book metadata and opaque offering bindings
- `/v1/offerings/search`
- `/v1/prices/resolve`
- price disclosure rules
- `/v1/intakes`
- `/v1/quotes/prepare`
- `/v1/quotes/:quoteId/status`
- deterministic quote orchestration with conservative provider-create reconciliation
- M1 automated fixture/tests
- Bidwright AGPL counsel fact pack

Validation performed while generating the artifact:

- JSON files parsed successfully
- ZIP folder roots verified
- TypeScript parser diagnostics checked; no TS1xxx syntax/module-mode errors remain
- new pricing/offering/quote core showed no non-module TypeScript diagnostics in the generator environment

Not yet performed:

- `pnpm install` + full CI run in a networked development machine
- PostgreSQL migrations against the target Supabase project
- live M1 against a running pinned Bidwright instance
- legal/counsel sign-off for intended commercial deployment
