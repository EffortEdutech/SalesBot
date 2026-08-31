# Bidwright Contract Tests

Pinned SHA: `88f50e4f8b6fc1db35bdde67ff984dd2a7d8a78c`

Read-only suite requires:

```text
BIDWRIGHT_CONTRACT=1
```

Mutation suite additionally requires:

```text
BIDWRIGHT_CONTRACT_MUTATION=1
```

Run mutation tests only against a disposable test organization/database. The suite creates
test provider records and intentionally does not assume every upstream object has a stable
cleanup endpoint.
