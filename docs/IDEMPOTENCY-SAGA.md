# Idempotency / Saga

```text
reserved → executing → succeeded
                    ├→ failed_retriable
                    ├→ failed_terminal
                    └→ upstream_unknown
```

Never blindly repeat a provider create after `upstream_unknown`.
