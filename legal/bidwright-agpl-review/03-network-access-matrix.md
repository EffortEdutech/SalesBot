# Network Access / Interaction Matrix

Record actual production facts before counsel sign-off.

| Actor                  | Can access Frontdesk-Q UI? | Can access Bridge API? | Can access Bidwright UI/API? | Notes                                         |
| ---------------------- | -------------------------: | ---------------------: | ---------------------------: | --------------------------------------------- |
| End customer/caller    |   No/possibly portal later |             indirectly |                  Planned: No | Receives quote generated from provider output |
| Tenant owner           |                        Yes | Yes via Frontdesk-Q UI |                  Planned: No | Reviews/approves in Frontdesk-Q               |
| Tenant estimator/staff |                        Yes | Yes via Frontdesk-Q UI |                  Planned: No | Frontdesk-Q workflow                          |
| Platform operator      |                        Yes |                    Yes | Possibly administrative only | Must document actual practice                 |
| Bridge service account |                        n/a |                    n/a |                Yes, REST API | Dedicated tenant/org-scoped account           |

Counsel should assess the actual production interaction, not only the intended diagram.
