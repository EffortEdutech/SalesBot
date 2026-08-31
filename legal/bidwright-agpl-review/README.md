# Bidwright AGPL Review Package

**Purpose:** technical fact pack for qualified legal/license counsel.

**Not legal advice.** This package intentionally records architecture facts and open questions
without concluding whether a particular deployment satisfies AGPL obligations.

## Bidwright source

- Repository: `braedonsaunders/bidwright`
- V1 pinned SHA: `88f50e4f8b6fc1db35bdde67ff984dd2a7d8a78c`
- Repository license identified in the project as: `AGPL-3.0-only`

## Current engineering policy

- Bridge remains a separate proprietary repository/process/service.
- Dograh calls Bridge, not Bidwright directly.
- Bridge calls Bidwright over HTTP.
- No Bidwright source modifications are planned for M1.
- No Bidwright source is copied into Bridge packages.
- Customer-facing UI is intended to be Frontdesk-Q, not Bidwright.
- Production commercialization is gated on counsel review.

See the accompanying files for deployment facts, network interaction and questions.
