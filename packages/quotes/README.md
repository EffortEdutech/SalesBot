# @frontdesk-q/quotes

Deterministic `prepare_quote_draft` orchestration.

Important:

- LLM supplies stable `offering_ref` + quantity/UOM, never price.
- Provider create steps are checkpointed conservatively.
- An uncertain provider create enters `upstream_unknown`; it is reconciled before any retry.
- Service price books are revision-snapshotted before line-item creation.
- Final totals are extracted from Bidwright recalculation output.
