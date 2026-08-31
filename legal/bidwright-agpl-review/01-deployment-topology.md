# Intended Deployment Topology

```text
Customer
   ↓ phone/web
Dograh
   ↓ HTTPS
Frontdesk-Q Bridge
   ↓ HTTPS/REST
Bidwright API
   ↓
Bidwright PostgreSQL

Frontdesk-Q Client/Admin UI
   ↓ HTTPS
Frontdesk-Q Bridge
```

Planned process/container separation:

```text
frontdesk-q-bridge      proprietary service
frontdesk-q-web         proprietary customer/operator UI
dograh                  separate provider/service
bidwright-api           pinned upstream Bidwright deployment
bidwright-workers       Bidwright deployment components as required
bidwright-db            Bidwright data store
bridge-db               Frontdesk-Q integration/state data store
```

No conclusion is made here about the legal effect of process, container, or network separation.
