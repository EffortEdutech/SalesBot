# Data and API Flow

Frontdesk-Q sends business-level operations through its Bidwright adapter.

Examples:

```text
Bridge → POST /api/auth/login
Bridge → GET/POST /catalogs
Bridge → GET/POST /api/rate-schedules
Bridge → POST /projects
Bridge → POST /projects/:projectId/rate-schedules/import
Bridge → POST /projects/:projectId/worksheets
Bridge → POST /projects/:projectId/worksheets/:worksheetId/items
Bridge → POST /projects/:projectId/recalculate
Bridge → GET  /projects/:projectId/pdf/main
```

Bridge does not query or write the Bidwright database directly.

Bridge stores provider IDs and integration state but intends Bidwright to remain the V1
authoritative financial calculation provider.
