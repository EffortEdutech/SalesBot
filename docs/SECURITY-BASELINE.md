# Security Baseline

- Tenant is derived from bearer token, never from agent-supplied organization ID.
- `X-Tenant-ID` is a consistency assertion only.
- Provider credentials stay server-side.
- Financial mutations require idempotency.
- AI runtime cannot approve or manage price books.
