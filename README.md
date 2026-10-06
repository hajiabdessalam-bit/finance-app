# PLAN

A personal finance planner that separates real account balances, spending records, budgets, goal reservations and forecasts.

The replacement app lives in `app/`. The original standalone app remains at the repository root during development. Production should remain on the original until the migration, daily workflows and cloud access controls are verified.

## Run locally

Requires Node.js 24+. The built static app can run without installing dependencies. Install the pinned dependencies to run the complete tests or edit the typed frontend.

```sh
npm start
# For full tests and frontend development:
npm ci --ignore-scripts
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

This is an incremental rebuild. Split expenses/refunds, linked partial returns, installment purchases, hard/flexible funding deadlines, persistent CSV batch undo and manual debt payoff scenarios and repayment-order comparisons are implemented. Cloud authentication/synchronization, joint daily purchase optimization, receipt parsing, live price quotes and connected AI are still in development. The joint planner returns period-end funding dates. A separate purchase preview checks dated bills/income and unspent spending allowances against account balances and protected reservations. It can find the earliest conditional date for one purchase within a selected horizon, consuming only that goal's own reservation when paid. It conservatively checks outflows before same-day income. The cash calendar expands weekly/monthly schedules, keeps expected receipts separate from real money and flags overdue bills or account shortages. Failed entries are retained as separate review-only drafts. The draft database schema and transport-independent sync protocol are preparation; no cloud database is connected yet.

Money outside can record a new gift, loan or investment and its cash movement together. Partial returns are linked to that record. Reverse linked returns before correcting an original outgoing payment; original entries stay in the ledger.

`server/validation.mjs` validates a complete proposed sync state and financial transitions against a trusted snapshot. Checked baselines require matching reconciliation evidence, original differences cannot be rewritten, reservations require available cash, and unrelated operations cannot edit other collections. `server/sync-service.mjs` prepares permanent-user verification, replay matching and version conflicts. The draft SQL denies authenticated client writes and exposes a private write RPC only to the trusted server role. `server/supabase-adapter.mjs` separates user identity checks from privileged RPC credentials. These modules are tested preparation; no deployed route, credentials, database or cloud upload is enabled. Reviewed bootstrap, complete operation-specific checks and live access-control verification remain prerequisites.

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

The separate `app/react.html` page starts the React/TypeScript migration with overview, scenario comparison, account balance checks and editable notes/checklists. It uses the same origin's validated IndexedDB workspace and atomic revision checks. Failed edits retain review-only drafts, available for download; concurrent saves cannot silently replace newer records. It makes no API calls. The main app continues to provide the remaining editing workflows until frontend parity is verified.

```sh
npm ci --ignore-scripts
npm run typecheck
npm run build:frontend
```

The checked-in browser bundle is built from public source only, with runtime dependency licenses alongside it. It uses no external script CDN. Rebuild after frontend or engine changes. Starting the existing static app does not require rebuilding the frontend.

Weekly balance checks retain their original differences. A review can add an explanation without inventing spending. Forgotten transactions dated before the latest checked balance update spending history without changing that balance; for same-day forgotten entries, confirm the balance again if it already included them. Activity supports account/category/date/correction filters and pages of 100 records, with split categories and amounts displayed explicitly.

## Local planning assistant and debt comparisons

The planning assistant calculates the extra income per future period needed to fund a selected goal by a date, using the same shared cash pool and competing goals as the main planner. It shows assumptions and keeps the scenario separate from saved goals. Funding is estimated at period end; the dated cash preview must be checked before a purchase.

Debt comparisons use explicit balances, APRs, minimum payments and one fixed monthly budget. They compare highest-interest-first and smallest-balance-first orders, roll freed minimum payments into the remaining debts, and show estimated interest. Monthly interest rounds exactly to minor units. Daily statement calculations, changing rates, fees and new borrowing are excluded. The comparison does not record payments.

`server/advisor.ts` prepares AI SDK tools for read-only scenarios and a priority proposal that requires explicit review against an unchanged workspace. It removes names, notes and individual transactions from its aggregate summary. No provider, deployed route or model call is configured. Provider access, permanent-user authorization, informed data-transfer consent and durable cost limits remain prerequisites.

Reviewed backup restores keep the previous state in a recovery checkpoint and archive its outgoing queue locally. Sending is held after a restore, including subsequent edits, until a future reviewed cloud baseline is established. Normal saves remove acknowledged or obsolete queued operations. This hold does not prevent local editing or backup downloads.

The overview provides weekly evidence checks for stale or unverified account balances, unresolved differences, potential duplicate entries, uncategorized spending, overdue bills and the current period budget. Matching entries are review candidates and are never deleted automatically. Unknown debt balances display as incomplete rather than zero.

Ordinary unsplit spending, income and refunds can use a reviewed replacement: the original, its reversal and the replacement save in one operation. Changes to a historical entry already included in a later balance check do not create cash. Linked goal purchases, scheduled payments, outside money and split entries retain their own reversal/re-entry workflows.

More → Backup also downloads locally held sync history for manual review. This separate audit file preserves archived queues and the restore hold; it is not an importable workspace or an instruction to replay edits.

Scheduled ordinary bills can explicitly use a spending category's budget allowance. Their unpaid amounts use the remaining allowance first, and excess costs reduce forecast capacity. Unlinked bills and debt payments remain additional commitments. A mapped bill records its actual expense in that category; expected income cannot use a spending allowance. The dated purchase preview charges the bill on its due date and reserves only the remainder of that category allowance. Completed-goal recurring costs retain their separate existing treatment. Historical scenarios exclude reversed original expenses.

The build writes content-addressed public assets and generates an integrity-checked offline shell for both interfaces. Installation verifies every response against its SHA-256 before making the release available. Cached releases serve matching files together; APIs and private exports are never cached. Updates wait for existing PLAN tabs to close naturally, preserving unsaved forms. Rebuild after changing native modules, frontend source, styles or shell templates. Keep the generated assets referenced by the current entry pages with the deployment.

`server/advisor-budget.mjs` prepares exact micro-USD admission limits, specific provider/model/summary/question consent, recent price quotes, bounded token/step budgets and conservative handling of uncertain charges. The separate UNAPPLIED `database/ai-budget-draft.sql` stores monthly caps and request-count caps, holds reservations across failures, rejects reused context, and pauses after an overrun. Its RPCs are server-only; browser access is restricted to ownership-protected reads. The Supabase adapter exposes these ledger operations, but no credentials, budgets, provider or HTTP route are enabled. A real provider adapter must enforce every billable token limit, include reasoning and fixed fees, and verify total charges; live concurrency/access-control checks remain necessary before use.
