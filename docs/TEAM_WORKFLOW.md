# Team workflow

## Ownership

| Owner   | Work package                                               | Merge-visible outcome                         |
| ------- | ---------------------------------------------------------- | --------------------------------------------- |
| Kavya   | 0A foundation, contracts, architecture, risk/security      | Signed explainable intent decision            |
| Fuzail  | 0B ledger, persistence, provider adapter, workers/recovery | Pending resolves without duplicate submission |
| Aryan   | Feature aggregation, graph bounds, fraud fixtures          | Mule-linked destination has stable evidence   |
| Lakshya | Operations console and design system                       | Analyst follows one immutable timeline        |
| Keerti  | Consumer challenge, recovery/dispute UI, E2E               | User cancels risk and tracks recovery         |

Kavya and Fuzail retain the backend critical path. Other backend contributions should stay bounded to the owner's reviewed interfaces and low-risk support.

## Branches and reviews

- Start from updated `main`; never push directly to `main`.
- Use `<name>/<area>-<issue>`, for example `fuzail/payment-ledger`.
- Contracts merge before consumers. Announce enum/schema changes before merge.
- Prefer small migrations; never edit a migration after teammates have used it.
- Squash merge after CI and required review.
- Architecture, auth/signing, tenancy, payment state, rule publication, and migrations require Kavya plus the module owner.

## Required PR evidence

State scope/work package, tests run, API/event/database changes, security/privacy impact, compatibility/rollback notes, and screenshots for visible UI changes. Do not weaken a test to make CI green.

Run `pnpm verify` before requesting final review.
