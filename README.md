# PLAN

A personal finance planner that separates real account balances, spending records, budgets, goal reservations and forecasts.

The replacement app lives in `app/`. The original standalone app remains at the repository root during development. Production should remain on the original until the migration, daily workflows and cloud access controls are verified.

## Run locally

Requires Node.js 24+. No dependency installation is needed.

```sh
npm start
npm test
```

Open http://127.0.0.1:4173. The development server serves only `app/`; it cannot expose files from the workspace root, recovery folder, or finance backups.

## Your records

Import an existing PLAN JSON backup through More → Backup. Review the counts before applying. The original records and original text are retained inside the new backup. Historical expenses are not reposted against current balances. Account balances need an explicit balance check; old estimates never become verified cash merely because a month ends.

New records use IndexedDB. Each save atomically updates the workspace, a recovery snapshot and its offline outbox. Concurrent tab edits are rejected rather than silently replacing newer records. Download independent JSON backups regularly. Browser storage alone is not a remote backup or cross-device synchronization.

## Financial rules

- Monetary values use integer minor units.
- Transfers do not become spending or income.
- Credit purchases are spending; repayments move cash to debt without recording spending twice.
- Borrowing is not earned income.
- Overspending is recordable; negative balances stay visible.
- Corrections retain the original transaction and its linked reversal.
- Goal reservations share one existing cash pool; archiving releases their remaining reservation.
- Forecasts are conditional on budget assumptions and remain separate from confirmed balances.
- Expected returns on loans or investments do not become spendable cash until received.

## Current limitations

This is an incremental rebuild. Split expenses/refunds, linked partial returns, installment purchases, hard/flexible funding deadlines, persistent CSV batch undo and manual debt payoff scenarios are implemented. Cloud authentication/synchronization, advanced recurring-budget integration, advanced payoff comparisons, receipt parsing, live price quotes and AI are still in development. The planner returns period-end funding dates. A separate read-only purchase preview checks dated bills/income and unspent spending allowances against account balances and protected reservations. It is conservative and does not automatically optimize purchase dates. The cash calendar expands weekly/monthly schedules, keeps expected receipts separate from real money and flags overdue bills or account shortages. Failed entries are retained as separate review-only drafts. The draft database schema and transport-independent sync protocol are preparation; no cloud database is connected yet.

Money outside can record a new gift, loan or investment and its cash movement together. Partial returns are linked to that record. Reverse linked returns before correcting an original outgoing payment; original entries stay in the ledger.

`server/validation.mjs` validates a complete proposed sync state against a trusted snapshot. It is not a deployed route or an authorization layer. Before cloud writes are enabled, the server must verify permanent-user ownership, handle immutable replay IDs and version conflicts, and prevent direct database calls from bypassing domain validation.

AI provider keys must remain server-side. OpenCode Go documents coding-agent usage, so a subscription should not be assumed to permit finance-chat traffic. The core planner works without AI.

## Deployment and privacy

Deploy only `app/` as the preview's static output. Never publish personal backup files, recovery snapshots, environment files or local-only regression fixtures. The service worker caches only public shell assets, never API responses or finance exports.


Optional isolated database checks require a local-only runtime:

```sh
npm install --prefix private/pg-tests --ignore-scripts --save-exact @electric-sql/pglite@0.5.8
node --test --test-isolation=none tests/database.test.mjs
```

These tests use synthetic users and an in-memory PostgreSQL engine. They do not connect to Supabase or import personal records; without the optional runtime the SQL suite is skipped. They supplement, rather than replace, live project access-control verification.

Cycle changes take effect at an existing period boundary. A transition period bridges to the new day in the following month, retaining one budget key per month. Earlier assignments and imported historical month keys remain unchanged. Future changes can be cancelled in reverse order; active periods cannot be remapped. Forecasts pause at a transition that lacks its own reviewed budget.

## Frontend development

The separate `app/react.html` page starts the React/TypeScript migration with overview, scenario comparison and read-only notes. It reads the same origin's validated IndexedDB workspace, makes no API calls and has no financial write controls. The main app continues to provide all editing workflows until frontend parity is verified.

```sh
npm ci --ignore-scripts
npm run typecheck
npm run build:frontend
```

The checked-in browser bundle is built from public source only, with runtime dependency licenses alongside it. It uses no external script CDN. Rebuild after frontend or engine changes. Starting the existing static app does not require rebuilding the frontend.

Weekly balance checks retain their original differences. A review can add an explanation without inventing spending. Forgotten transactions dated before the latest checked balance update spending history without changing that balance; for same-day forgotten entries, confirm the balance again if it already included them. Activity supports account/category/date/correction filters and pages of 100 records, with split categories and amounts displayed explicitly.
