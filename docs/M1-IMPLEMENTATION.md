# M1 Implementation — Deterministic Quote Without Voice

Implemented paths:

```text
POST /v1/intakes
POST /v1/offerings/search
POST /v1/prices/resolve
POST /v1/quotes/prepare
GET  /v1/quotes/:quoteId/status
```

M1 canonical flow:

```text
Ahmad + Ipoh + office + 3 × 2HP
  ↓
2HP product offering
2HP installation offering
  ↓
active tenant price book
  ↓
Bidwright project
  ↓
revision service-rate snapshot
  ↓
FDQ Quotation worksheet
  ↓
product + service line items
  ↓
Bidwright recalculate
  ↓
PENDING_APPROVAL
```

Provider create mutations are guarded with `upstream_unknown` before the network call so a
process death or lost response cannot lead to an automatic duplicate create. Reconciliation uses:

- project correlation marker for project creation
- worksheet name for worksheet creation
- `sourceNotes` correlation for worksheet line creation
- source schedule/revision identity for rate-book snapshots

M1 tests use synthetic prices and a fake Bidwright provider; the live pinned Bidwright contract
suite remains a separate opt-in gate.
