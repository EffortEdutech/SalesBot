# Task Package Map

1. Repository scaffold â†’ root configs, `.github/`, `docs/`
2. Bridge skeleton â†’ `apps/bridge-api/`, `packages/contracts/`, `packages/db/`
3. DB schema â†’ `db/migrations/001_bridge_core.sql`
4. Tenant auth/isolation â†’ `packages/auth/`, `packages/tenant/`, Bridge auth middleware/tests
5. Idempotency/saga â†’ `packages/idempotency/`, `bridge_operations`
6. Bidwright adapter â†’ `packages/bidwright/`
7. Bidwright contract tests â†’ `tests/contract/bidwright/`

8. HVAC price-book merge/provisioning â†’ `packages/pricing/`, `data/`, `scripts/provision-hvac-pilot.ts`, migration 002
9. Offering search + price resolution â†’ `packages/offerings/`, pricing resolver, Bridge pricing routes
10. Deterministic quote saga â†’ `packages/quotes/`, Bridge quote routes, migration 003
11. M1 automated tests â†’ `tests/m1/`
12. Bidwright AGPL review facts â†’ `legal/bidwright-agpl-review/`
13. SalesBot operator console -> `apps/salesbot-web/`, Bridge operator routes
14. Unified development platform -> root launcher scripts and runbooks
    14.1. Unified development platform hotfix -> TypeScript/Vite dependency corrections
    14.2. Runtime isolation -> dev status/stop, port preflight, loopback UI binding, dev cache cleanup, Bridge root diagnostic
