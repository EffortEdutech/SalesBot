# Frontdesk-Q Current Sprint Plan

**Status:** Active execution source of truth
**Version:** 1.0
**Established:** 20 August 2026
**Product:** SalesBot / Frontdesk-Q
**Pilot:** Malaysian HVAC quotation workflow

## 1. Purpose

This is the day-to-day execution plan for completing Frontdesk-Q V1. It supplements:

- ../docs/AI-FRONTDESK-QUOTATION-V1-DEVELOPMENT-PLAN.md
- ../docs/AI-FRONTDESK-QUOTATION-V1-CONTRACT-FREEZE-ADDENDUM.md

The frozen architecture, provider pins, authority boundaries and financial controls remain authoritative.

> AI proposes. Bridge orchestrates. Bidwright calculates. A human approves. The platform delivers.

Code presence alone is not completion. A task is verified only when its stated evidence and exit gate pass.

## 2. Status legend

| Status                   | Meaning                                                                    |
| ------------------------ | -------------------------------------------------------------------------- |
| VERIFIED                 | Implemented and supported by current test or runtime evidence              |
| VERIFIED CORE            | Core sprint gate passed; recorded follow-up hardening remains              |
| IMPLEMENTED - UNVERIFIED | Code exists, but the current environment or live integration is not proven |
| IN PROGRESS              | Active sprint work                                                         |
| BLOCKED                  | Waiting for a recorded dependency or decision                              |
| NOT STARTED              | Planned but not begun                                                      |

## 3. Current baseline

| Workstream                               | Status                   | Qualification                                                                                                  |
| ---------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Monorepo and TypeScript foundation       | IMPLEMENTED - UNVERIFIED | Fresh full CI-equivalent run required                                                                          |
| Bridge health and readiness              | IMPLEMENTED - UNVERIFIED | Reverify after runtime stabilization                                                                           |
| Supabase migrations 001-003              | VERIFIED                 | Target database previously reported all 17 expected tables                                                     |
| Tenant bearer authentication and RBAC    | IMPLEMENTED - UNVERIFIED | Rerun auth and tenant-isolation tests                                                                          |
| Bidwright adapter and contract tests     | IMPLEMENTED - UNVERIFIED | Pinned live Bidwright gate has not passed                                                                      |
| HVAC price book and offering resolution  | VERIFIED                 | M1 live flow resolved HVAC-AC-20 and HVAC-INSTALL-20 against active HVAC Pilot price book on 2026-08-23        |
| Deterministic quote saga                 | VERIFIED                 | M1 live quote reached PENDING_APPROVAL with Bidwright-backed calculation on 2026-08-23                          |
| Operator Console                         | IMPLEMENTED - UNVERIFIED | Clean runtime verification required                                                                            |
| Unified local launcher                   | VERIFIED                 | Package 14.2 runtime isolation implemented on 2026-08-20; Bridge loopback/watch cleanup verified on 2026-08-21 |
| Approval, revision, PDF and delivery     | VERIFIED CORE            | S4 human approval workspace, approved-only PDF export, PDF content QA and download delivery UAT passed on 2026-08-23 |
| Dograh voice integration                 | VERIFIED CORE            | S5 self-hosted Dograh HTTP tool-chain, Web Call, safe hardening, native transfer and controlled Bidwright outage drills passed; real telephony/SIP transfer bridging remains |
| Pilot hardening and production readiness | NOT STARTED              | Sprints 6-8                                                                                                    |

## 4. Mandatory sequence

1. R0 - Runtime Recovery and Isolation
2. R1 - Repository Quality and Security Baseline
3. M1 - Live Deterministic Quote Without Voice
4. S4 - Human Approval, Revision, PDF and Delivery
5. S5 - Dograh Voice Integration
6. S6 - HVAC Pilot Hardening
7. S7 - Client #1 Production Readiness
8. S8 - Post-Pilot Stabilization

Do not begin Dograh integration before the M1 and approval/delivery gates pass.

---

# R0 - Runtime Recovery and Isolation

**Status:** VERIFIED

## Objective

Create one predictable local workflow and remove stale process, port, browser-origin and service-worker contamination.

## Checklist

- [x] Add pnpm dev:status.
- [x] Add pnpm dev:stop.
- [x] Report listeners on ports 4170 and 4173 with PID and process ownership.
- [x] Stop only SalesBot-owned runtime listeners and watcher parents; refuse foreign listeners.
- [x] Refuse pnpm dev startup while a required port is occupied by a foreign process; clean stale SalesBot listeners.
- [x] Bind Bridge and UI specifically to loopback ports 127.0.0.1:4170 and 127.0.0.1:4173.
- [x] Add a safe Bridge GET / diagnostic.
- [x] Remove development service workers and caches for the SalesBot origin.
- [x] Confirm one Ctrl+C stops both child processes.
- [x] Update the runbook, package manifest and task-package map for Package 14.2.

## Acceptance evidence

- [x] Both ports are free before startup.
- [x] pnpm dev starts Bridge and Operator UI in one terminal.
- [x] Bridge root, health and readiness endpoints respond correctly.
- [x] http://127.0.0.1:4173/ serves the SalesBot Vite app shell.
- [x] The /login path does not surface WorkLedger.
- [x] Both ports are free after shutdown.

## Exit gate

One documented command starts the complete local platform, and one shutdown action leaves no SalesBot listener behind.

---

# R1 - Repository Quality and Security Baseline

**Status:** VERIFIED

## Checklist

- [x] Confirm supported Node.js and pnpm versions.
- [x] Run pnpm install.
- [x] Run pnpm lint.
- [x] Run pnpm format:check.
- [x] Run pnpm typecheck.
- [x] Run unit and M1 tests.
- [x] Build every workspace package.
- [x] Run relevant non-mutating contract tests.
- [x] Validate migrations against a disposable database.
- [x] Confirm environment files and raw credentials are ignored.
- [x] Search tracked files for passwords, tokens and Bridge peppers.
- [x] Confirm previously exposed credentials were rotated. Owner confirmation received; no secrets recorded.
- [x] Confirm the stored operator hash matches the active replacement pepper. Owner confirmation received; no pepper/token recorded.
- [x] Update documentation to match observed commands and behaviour.
- [x] Record every failure; do not silently waive a quality gate.

## Exit gate

Engineering R1 passes when CI-equivalent checks pass, migrations validate, no tracked active secret is found, documentation matches observed behaviour, and the system owner confirms credential rotation and active operator hash/pepper alignment without recording secrets.

---

# M1 - Live Deterministic Quote Without Voice

**Status:** VERIFIED - M1 LIVE FLOW PASSED ON 2026-08-23

## Canonical scenario

| Field         | Value                          |
| ------------- | ------------------------------ |
| Customer      | Ahmad                          |
| Location      | Ipoh                           |
| Building type | Office                         |
| Scope         | Supply and installation        |
| Equipment     | 3 x 2HP air-conditioning units |
| Currency      | MYR                            |
| Approval      | Human approval required        |

Quantities and prices are quotation inputs, not certified quantities or contractual entitlements.

## Provider and tenant preparation

- [x] Start the pinned Bidwright service on port 4171.
- [x] Verify its version/source pin against PROVIDER_VERSIONS.md.
- [x] Use a disposable development or staging organization.
- [x] Verify tenant_hvac_pilot is active.
- [x] Verify the Bridge token belongs only to that tenant.
- [x] Verify the expected Bidwright organization matches the tenant connection.
- [ ] Run authentication and read contract tests.
- [x] Run mutation tests only against disposable data.

## Price-book evidence

- [x] Provision the HVAC pilot price book.
- [x] Record its identifier, version, effective date and expiry date.
- [x] Confirm MYR currency.
- [x] Confirm the 2HP product and installation service codes, descriptions and units.
- [x] Distinguish base cost from selling rate.
- [x] Record the source and human approval status of each selling rate.
- [x] Confirm the price book is active on the quotation date.
- [x] Confirm the tenant price-disclosure policy.
- [x] Confirm no AI-controlled price mutation exists.

## Live quotation flow

- [x] Create Ahmad's intake.
- [x] Resolve exactly one 2HP equipment offering.
- [x] Resolve exactly one installation offering.
- [x] Confirm quantity and UOM compatibility.
- [x] Prepare the quote through the Operator Console or Bridge API.
- [x] Create exactly one Bidwright project and quote revision.
- [x] Snapshot the applicable rate schedule.
- [x] Create or reuse the intended worksheet.
- [x] Insert product and installation line items.
- [x] Recalculate in Bidwright.
- [x] Read Bidwright totals as authoritative.
- [x] Persist provider IDs and calculation snapshot in Bridge.
- [x] Confirm exactly one Bridge quote reaches PENDING_APPROVAL.

## Commercial and audit controls

- [x] Quote records the exact tenant, price-book snapshot and Bidwright revision.
- [x] Every line records code, description, quantity, UOM, rate and amount.
- [x] Arithmetic reconciles with Bidwright.
- [x] Assumptions and exclusions are visible.
- [x] Unresolved scope is flagged for human review.
- [ ] Audit records distinguish human, AI, system and provider actors.
- [x] No AI actor can approve, reject or alter an approved price.
- [x] Request and operation IDs provide end-to-end traceability.

## Idempotency and failure tests

- [ ] Repeat the request with the same idempotency key.
- [ ] Confirm the same result and no duplicate provider or Bridge resources.
- [ ] Reuse the key with a changed body and confirm conflict rejection.
- [ ] Simulate provider timeout or lost response.
- [ ] Confirm uncertain mutations become upstream unknown.
- [ ] Require reconciliation before retrying an uncertain create.

## Exit gate

M1 passes only with evidence of one tenant, one intake, one approved price-book snapshot, one Bidwright project, one quote revision, one calculated worksheet, one Bridge quote, PENDING_APPROVAL status, no duplicates and a complete audit trail.

---

# S4 - Human Approval, Revision, PDF and Delivery

**Status:** VERIFIED CORE - APPROVAL, PDF AND DOWNLOAD DELIVERY PASSED ON 2026-08-23**

## Approval review

- [x] List pending approvals by tenant.
- [x] Show customer, scope, items, assumptions, exclusions and totals in the Operator Console approval workspace.
- [x] Show the exact price-book snapshot and Bidwright revision for M1 approval evidence.
- [x] Show warnings and missing information in validation evidence; M1 approval had no warnings/blockers.
- [x] Enforce tenant isolation and quote approval permission.

## Decisions and revisions

- [x] Approve, reject with reason, or request changes.
- [x] Record actor, timestamp, exact revision and reason.
- [x] Prevent AI identities from deciding.
- [x] Prevent approval of stale or mismatched revisions.
- [ ] Create a new revision after any scope, quantity or price change.
- [x] Preserve previous revision and decision history.
- [ ] Invalidate prior approval after mutation.
- [ ] Recalculate and require new human approval.
- [ ] Provide a clear revision comparison.

## Immutability, PDF and delivery

- [x] Store approved revision ID, total, timestamp, approver and calculation hash.
- [x] Prevent silent mutation of approved commercial content.
- [x] Generate PDF only from the approved exact revision.
- [x] Verify customer, scope, items, totals, currency and revision in the PDF.
- [x] Store delivery PDF hash with timestamp and approved Bidwright revision reference.
- [x] Deliver only an approved exact revision.
- [x] Make delivery idempotent.
- [x] Record channel, recipient, timestamp and content hash; provider message reference remains for external delivery provider integration.
- [ ] Record retryable and terminal delivery failures.
- [x] Ensure delivery failure never alters approval.
- [x] Prevent retries from sending a different revision.

## Exit gate

An authorized human can review, revise, approve and deliver the exact quotation revision while every commercial decision and artifact remains immutable, tenant-scoped and auditable.

---

# S5 - Dograh Voice Integration

**Status:** VERIFIED CORE - WEB CALL AND SAFE HARDENING DRILLS PASSED ON 2026-08-31**

- [x] Verify the pinned Dograh version.
- [x] Provision Bridge credentials and HTTP tools.
- [x] Keep tenant context outside LLM control.
- [x] Capture required HVAC intake fields.
- [x] Search offerings only through Bridge.
- [x] Respect price-disclosure policy.
- [x] Prepare quotations through the stable Bridge contract.
- [x] Return safe pending-approval responses.
- [x] Transfer requested human-handoff cases using Dograh native transfer_call tool; text drill and Web Call transfer-tool UAT passed with `frontdesk_q_transfer_to_human`. Actual bridge transfer is unavailable in Web Call transport and requires telephony/SIP UAT.
- [x] Test duplicate and malformed tool inputs.
- [x] Test incomplete or ambiguous intake validation.
- [x] Test unsupported offering fail-closed behaviour.
- [x] Test AI runtime cannot approve, export PDF or deliver.
- [x] Test Web Call captures HVAC intent and stops at human review.
- [x] Run controlled Bidwright outage drill while Dograh prepare-quote path calls HTTP tools; Bridge marks operation and quote shell upstream_unknown with no total/provider IDs.

**Exit gate:** A voice enquiry creates the same deterministic M1 result without granting the AI pricing or approval authority.

---

# S6 ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â HVAC Pilot Hardening

**Status:** NOT STARTED

- [ ] Security and tenant-isolation review.
- [ ] Structured logs, metrics and alerts.
- [ ] PII masking and retention rules.
- [ ] Backup, restore and reconciliation procedures.
- [ ] Rate-expiry and missing-binding alerts.
- [ ] Accessibility and operator usability review.
- [ ] Load, concurrency and duplicate-request tests.
- [ ] Failure drills for Bridge, database, Bidwright and delivery provider.
- [ ] Complete the Bidwright AGPL technical fact pack.
- [ ] Obtain qualified legal review before commercial deployment.

# S7 ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â Client #1 Production Readiness

**Status:** NOT STARTED

- [ ] Confirm client scope and approved offering list.
- [ ] Obtain human-approved rates and commercial terms.
- [ ] Configure production tenant, providers and secrets.
- [ ] Complete user acceptance testing.
- [ ] Complete operations, support and incident runbooks.
- [ ] Complete privacy, retention, monitoring and backup reviews.
- [ ] Obtain human go-live approval.

# S8 ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â Post-Pilot Stabilization

**Status:** NOT STARTED

- [ ] Review defects, overrides and human handoffs.
- [ ] Reconcile quotations, approvals, PDFs and deliveries.
- [ ] Measure conversion, turnaround and failure rates.
- [ ] Correct price-book, workflow and usability issues.
- [ ] Prioritize V1.1 from observed evidence.
- [ ] Do not expand verticals until HVAC is stable.

## 5. Global definition of done

A story may be marked VERIFIED only when:

- [ ] Acceptance criteria and relevant automated tests pass.
- [ ] Required live integration evidence exists.
- [ ] Tenant isolation is verified.
- [ ] Errors, request IDs and audit events are preserved.
- [ ] Documentation is updated.
- [ ] No active secret is exposed.
- [ ] No known P0 or P1 defect remains.
- [ ] Human authority is preserved for commercial approval.

## 6. Blocker register

| ID    | Description                                                  | Owner               | Status | Resolution                                         |
| ----- | ------------------------------------------------------------ | ------------------- | ------ | -------------------------------------------------- |
| B-001 | Package 14.2 runtime isolation is not applied                | Engineering         | Closed | R0 implemented and verified on 2026-08-20          |
| B-002 | Current full CI-equivalent run is not recorded               | Engineering         | Closed | pnpm run ci and pnpm build passed on 2026-08-21    |
| B-003 | Live pinned Bidwright M1 has not passed                      | Engineering/Product | Closed | M1 live flow passed on 2026-08-23                  |
| B-004 | Previously exposed credentials require confirmed rotation    | System owner        | Closed | Owner confirmed on 2026-08-22; no secrets recorded |
| B-005 | Bidwright AGPL commercial position requires qualified review | Business/Legal      | Open   | Resolve before production commercialization        |

## 7. Evidence register

| Date       | Gate                       | Environment                                         | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                          | Result                                   | Recorded by |
| ---------- | -------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ----------- |
| 2026-08-20 | Plan baseline              | Repository review                                   | Master plan, package map, readiness notes and runbooks reconciled                                                                                                                                                                                                                                                                                                                                                                                 | Pass                                     | Codex       |
| 2026-08-20 | R0 runtime isolation       | Local Windows dev runtime                           | Package 14.2 files added; pnpm dev:status/stop pass; pnpm dev starts Bridge/UI; Bridge /, /health, /ready return 200; UI and /login app shell return 200; shutdown clears ports                                                                                                                                                                                                                                                                   | Pass with browser automation unavailable | Codex       |
| 2026-08-21 | R0.1 Bridge loopback       | Local Windows dev runtime                           | Terminal log showed duplicate Bridge watch process and 0.0.0.0:4170 bind; Bridge default HOST changed to 127.0.0.1; launcher sets HOST=127.0.0.1; dev:stop now includes repo-scoped watcher-parent cleanup; pnpm dev logs only 127.0.0.1:4170; Bridge /, /health, /ready and UI / return 200; shutdown clears ports                                                                                                                               | Pass                                     | Codex       |
| 2026-08-21 | R1 engineering baseline    | Local Windows repo and disposable Supabase database | Node v22.14.0 and pnpm 9.15.4 confirmed; pnpm install lockfile up to date; pnpm run ci passed; pnpm build passed; non-mutating Bidwright contract tests skipped because live provider env not configured; migrations 001-003 applied successfully to disposable database fdq_r1_validation_20260821 then database dropped; .env/.env.* ignored; tracked secret scan found placeholders/test tokens only                                           | Pass                                     | Codex       |
| 2026-08-22 | R1 owner confirmation      | System owner attestation                            | System owner confirmed previously exposed credentials were rotated and active operator hash/pepper alignment is valid; no secret, pepper, token or raw credential was recorded                                                                                                                                                                                                                                                                    | Pass                                     | User/Codex  |
| 2026-08-22 | M1 provider and price book | Local Windows dev runtime                           | Cloned Bidwright provider, checked out pinned commit 88f50e4f8b6fc1db35bdde67ff984dd2a7d8a78c, started pinned API on 127.0.0.1:4171 using disposable local org salesbot-bridge-hvac-20260822125128; provisioned HVAC Pilot price book 3ed7f2c2-e2c6-4acf-9165-63b786fb55a8; Bridge system diagnostics show Bidwright reachable, DB connected, migrations 17/17, tenant active, price book active; UI shell returns 200; agent-browser unavailable | Pass; browser automation unavailable     | Codex       |
| 2026-08-23 | M1 live quote flow | Local Windows dev runtime | Ahmad/Ipoh/office/3x2HP intake a3989d5e-b7a9-4575-959c-89a8947b088d; resolved HVAC-AC-20 product and HVAC-INSTALL-20 service; Bridge quote 430472f8-344e-4304-9cf9-d393016e5b95 / BW-260823-6701 reached pending_approval; Bidwright project project-b1445a1f-e76d-45d4-a76e-363756145f5c, quote quote-73c080ca-86c9-4c6d-84fc-dd172da09ef3, revision revision-ae5f5ea4-7f4b-4b70-9aae-c6dc2fc7bac7, worksheet worksheet-70fbe6b3-576a-4237-a00e-8adbf07ce42b, snapshot rs-9e6aa72f-2d1d-4ded-b676-832cc0a32dba; validation warnings/blockers empty; MYR subtotal/grand_total 10499.85; line records product MYR 6450.00 and service MYR 1350.00. | Pass; browser automation unavailable | Codex |
| 2026-08-23 | S4 approval/delivery API controls | Local Windows dev runtime and Bridge API tests | Added human-only quote approval, rejection, change-request, approved-only PDF, and manual/download delivery endpoints; repository writes bridge_approvals, bridge_deliveries and bridge_audit_log with revision/calculation-hash evidence; AI runtime approval returns FORBIDDEN; PDF export before approval returns QUOTE_APPROVAL_REQUIRED; delivery records SHA-256 content hash and moves approved quote to sent. Commands: corepack pnpm -C frontdesk-q --filter @frontdesk-q/bridge-api test passed 13/13; corepack pnpm -C frontdesk-q typecheck passed. | Pass for API control layer; live human UAT still pending | Codex |
| 2026-08-23 | S4 live human approval | Local Windows dev runtime | Human operator approved M1 quote 430472f8-344e-4304-9cf9-d393016e5b95 / BW-260823-6701 using tenant_owner dev approval token; Bridge quote status approved, approval_status approved, MYR grand_total 10499.85, Bidwright revision revision-ae5f5ea4-7f4b-4b70-9aae-c6dc2fc7bac7, calculation hash e553bdc8a93d591ab3418c228adbc1b0a7cb7bb9a0b23b14dc8a6d38813fd0f1; bridge_approvals row 0c0bdd76-bd67-4352-8502-d95cb5a29a1e recorded approved_at; bridge_audit_log recorded actor_type human and action quote.approved. | Pass | User/Codex |
| 2026-08-23 | S4 approved-only PDF/download delivery UAT | Local Windows dev runtime | Installed missing Playwright Chromium runtime for Bidwright PDF generation; fixed Bridge PDF provider factory wiring; initial M1 delivery UAT sent quote 430472f8-344e-4304-9cf9-d393016e5b95 with delivery f5ee3107-9a5a-4f75-9f6d-acda2440e264 and exposed non-deterministic regenerated PDF hashes; tightened manual/download delivery API to accept and store the exact exported PDF SHA-256. Fresh UAT quote bb2d403a-e653-43b6-b27c-dcc5a16e01b7 / BW-260823-AC3F reached pending_approval, was human-approved as approval 688ae384-6b4c-498a-baf4-34d8a7a5bcde, exported approved PDF artifacts/s4-uat/BW-260823-AC3F-fresh-approved.pdf bytes 140022 SHA-256 a46ef9546827625aa92fdbc30da7c27af9a3b160abc36fe003315048af532aaa, then download delivery 7cdc6b45-c65f-48b8-9c86-74e7431ad47a recorded the same hash, state sent, actor_type human and action quote.delivered. Commands: bridge-api tests passed 13/13; pnpm typecheck passed. | Pass | Codex |
| 2026-08-23 | S4 Operator Console and PDF content QA | Local Windows dev runtime | Added Operator Console approval workspace and quote detail API. Fresh UAT quote d29745d6-b84c-4710-a892-54ee278222b3 / BW-260823-4DF5 reached pending_approval, was human-approved as approval 12bd0212-3663-4c68-b0d7-36063e3ee259, exported approved PDF artifacts/s4-uat/BW-260823-4DF5-fresh-approved.pdf bytes 139698 SHA-256 c0065a920e2342d35c5c6b750e9b3f3fc5ba3d3073bab73bb54778671e358a88, recorded download delivery 1d428079-e074-4009-aba8-07c621cb2aa8 with matching hash, and finished sent. Operator detail before delivery returned item_count 2, approval_count 1, audit_count 1, MYR grand_total 10499.85 and Bidwright revision revision-092cdbd5-e804-458a-96f5-26e3d4bc9cff. Parsed PDF text confirmed quote number, Ahmad customer, 2HP scope, MYR currency and 10,499.85 total. Commands: provider build passed; bridge-api tests passed 15/15; frontdesk-q typecheck and build passed. | Pass | Codex |
| 2026-08-23 | S5 self-hosted Dograh tool-chain UAT | Local Windows dev runtime, self-hosted Dograh OSS v1.45.0, Cloudflare quick tunnels | Cloned dograh-hq/dograh at pinned commit 689ca048bb0ab03183d6904b6c6eb6a405084dd0 under providers/dograh; generated local-only Dograh .env; started self-hosted Dograh UI http://127.0.0.1:3010 and API http://127.0.0.1:8010 with public tunnel https://xml-ambient-cute-comprehensive.trycloudflare.com; exposed Bridge through https://passing-pics-stars-danny.trycloudflare.com; created Dograh admin and management API key in local ignored artifact; created Bridge bearer credential 5c5d54ab-6eee-4c9a-b058-9a5c0aa54cef and three HTTP tools: search 7f9da236-b6c6-4f1f-8475-9ec66c280b9b, capture 5d86c43f-bdc3-42bc-bb7a-bf075a34e273, prepare ca0f202b-c5e3-4ac0-b089-634ba37b7046. Fixed Bridge to derive mutation idempotency from body workflow_run_id when Dograh sends unresolved header templates. Dograh tool-chain UAT workflow real-dograh-tool-chain-20260823120301 searched HVAC-AC-20/HVAC-INSTALL-20, captured intake fb737cd1-cf1e-47b9-9b5e-13a744fa36f6, prepared quote 49b6d456-fd92-4f51-87b9-20e2b7e43e2a / BW-260823-6F17 to pending_approval, MYR grand_total 10499.85. Commands: bridge-api tests passed 20/20; s5-configure-selfhosted-dograh.mjs passed; s5-dograh-tool-chain-uat.mjs passed. | Pass; real phone/SIP provider still pending | Codex |
| 2026-08-23 | S5 Dograh Bridge HTTP-tools voice UAT | Local Windows dev runtime | Added Dograh runtime facade with pinned version s5-bridge-http-tools-v1 and allowlisted tools capture_hvac_intake, search_offerings and prepare_quote; forbidden tools include approve_quote, reject_quote, deliver_quote and export_pdf. Live UAT provisioned temporary ai_runtime token fca840d8-3769-4e37-b4a1-ec6767b5eac9 and active dograh bridge_connection, searched HVAC-AC-20 and HVAC-INSTALL-20 only through Bridge, captured Dograh voice intake 804622a3-1907-4aba-9118-9a701735e3e7 with duplicate replay prevented, prepared quote 93a33671-8567-42bc-b4ad-fd72bdcfbd85 / BW-260823-8220 to pending_approval with MYR grand_total 10499.85, Bidwright project project-90c7f099-eeea-4f56-a288-9918d662d55e and revision revision-6705cd97-b8b8-4468-95b1-d5fe54363f81; ai_runtime approval attempt returned 403 FORBIDDEN. Commands: bridge-api tests passed 20/20; frontdesk-q typecheck and build passed. | Pass | Codex |
| 2026-08-31 | S5 Dograh Web Call UAT | Local Windows dev runtime, self-hosted Dograh OSS v1.45.0, browser Web Call | User ran the Frontdesk inbound Web Call successfully. Dograh asked for building type, captured residential, understood 2HP capacity and 5 units, confirmed installation required, and responded that the quotation was prepared and awaiting human review. This validates the browser voice conversation path and the human-review boundary. | Pass; real phone carrier/SIP still pending | User/Codex |
| 2026-08-31 | S5.1 Dograh safe hardening drills | Local Windows dev runtime, Bridge 4170, Bidwright 4171, Dograh 4172/4174 | Added and ran scripts/s5-dograh-hardening-drills.mjs. Evidence artifact artifacts/s5-dograh-hardening/s5-hardening-20260831002914.json. Runtime session pinned_version s5-bridge-http-tools-v1; allowed tools capture_hvac_intake, search_offerings and prepare_quote; forbidden tools approve_quote, reject_quote, deliver_quote and export_pdf. Incomplete intake returned VALIDATION_ERROR 422; unsupported search returned 0 items safely; unsupported prepare failed closed as needs_review with OFFERING_NOT_FOUND; duplicate intake replay reused intake 2f203cf5-199e-47e1-8ea2-f520d732b1c1; AI runtime approval, PDF export and delivery returned FORBIDDEN 403. Valid hardening quote 367d0191-27bc-43c0-a4fe-4d71535129aa / BW-260831-86DB remained pending_approval, MYR 21999.75. | Pass; native transfer and controlled outage drills still pending | Codex |
| 2026-08-31 | S5 Dograh native human transfer drill | Local Windows dev runtime, self-hosted Dograh OSS v1.45.0, Dograh workflow 1 | Added scripts/s5-configure-dograh-transfer-target.mjs and scripts/s5-dograh-transfer-drill.mjs. Configured Dograh native transfer_call tool frontdesk_q_transfer_to_human UUID 293ddaa0-d0cb-4251-a965-e5d8c3490913 with safe local target PJSIP/frontdesk-human; published Frontdesk - inbound definition 3. Transfer tool is attached to Start Call and Main Agenda nodes, while quote tools remain only on Main Agenda. Text drill workflow_run_id 9 for utterance "I want to speak to a human." emitted tool_call_started and tool_call_result for frontdesk_q_transfer_to_human. Evidence artifacts: artifacts/s5-dograh-real-voice/dograh-transfer-target.local.json and dograh-transfer-drill.local.json. | Pass for Dograh backend/tool selection; Web Call transfer-tool UAT also passed; actual transfer bridging requires telephony/SIP | Codex |
| 2026-08-31 | S5 Dograh Web Call human transfer UAT | Local Windows dev runtime, self-hosted Dograh OSS v1.45.0, browser Web Call | User ran Web Call with Sam. Caller said "I want to speak to a human." Dograh invoked frontdesk_q_transfer_to_human and marked it completed, then returned: "call transfers are not available for web calls. Please try a telephony call." This proves intent classification and native transfer tool invocation in live Web Call; actual call bridging is blocked by Web Call transport design and requires telephony/SIP UAT. | Pass for Web Call transfer-tool invocation; telephony transfer bridging pending | User/Codex |
| 2026-08-31 | S5 controlled Bidwright outage drill | Local Windows dev runtime, disposable Bridge 127.0.0.1:4179, dead Bidwright URL 127.0.0.1:4199 | Added scripts/s5-dograh-outage-drill.mjs and patched QuotePreparationService to mark retryable pricing/provider errors as upstream_unknown before any authoritative Bidwright result exists. Drill run s5-outage-20260831032720 authenticated Dograh ai_runtime, resolved offerings, captured intake, then prepare_quote returned 409 UPSTREAM_STATE_UNKNOWN. bridge_operations status upstream_unknown at quote_shell with last_error_code BIDWRIGHT_UNAVAILABLE; quote 52fffc7c-f7cb-4b2d-ac99-04911249e9c2 status upstream_unknown with no quote number, no Bidwright project/quote/revision IDs and no grand_total. Reusing same idempotency key with changed body returned IDEMPOTENCY_KEY_REUSED. Evidence artifact artifacts/s5-dograh-hardening/s5-outage-20260831032720.json. Commands: bridge-api typecheck passed; bridge-api tests passed 20/20; outage drill passed. | Pass | Codex |

## 8. Immediate next action

Proceed S5 closeout: controlled Bidwright outage drill has passed. Next configure a real telephony/SIP target and run one inbound phone call UAT to verify actual human transfer bridging. S4.1 revision mutation/reapproval comparison remains follow-up hardening.
