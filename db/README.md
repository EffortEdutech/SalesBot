# PostgreSQL / Supabase Schema

Apply:

```bash
psql "$DATABASE_URL" -f db/migrations/001_bridge_core.sql
```

The migration creates all requested V1 tables plus `bridge_api_tokens`, which is required
for tenant-scoped runtime authentication.

Every application query must be tenant scoped. RLS can be added once the final production
database-role model is frozen.

Then apply:

```bash
psql "$DATABASE_URL" -f db/migrations/002_pricing_offerings.sql
```
