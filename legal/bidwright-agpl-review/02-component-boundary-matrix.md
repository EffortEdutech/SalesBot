# Component Boundary Matrix

| Component          | Owner/source                                |      Planned modifications |       User directly accesses? | Protocol to Frontdesk-Q    |
| ------------------ | ------------------------------------------- | -------------------------: | ----------------------------: | -------------------------- |
| Frontdesk-Q Bridge | Our proprietary code                        |                        Yes |            indirectly via API | n/a                        |
| Frontdesk-Q Web    | Our proprietary code                        |                        Yes |                           Yes | HTTPS to Bridge            |
| Dograh             | `dograh-hq/dograh` / BSD-2-Clause           |                Prefer none |  Customer interacts via calls | HTTPS tool calls to Bridge |
| Bidwright          | `braedonsaunders/bidwright` / AGPL-3.0-only |        None planned for M1 | No direct customer UI planned | Bridge → Bidwright REST    |
| Bridge DB          | Our schema                                  |                        Yes |                            No | PostgreSQL                 |
| Bidwright DB       | Bidwright deployment                        | No direct Bridge DB access |                            No | Accessed by Bidwright only |

Key engineering rule:

> Dograh and Frontdesk-Q never connect directly to Bidwright PostgreSQL.
