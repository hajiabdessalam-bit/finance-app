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

Scheduled occurrences can be cancelled with an explanation and restored without recording cash. Future schedule changes use a dated replacement or stop date, retaining earlier unpaid bills and actual payment history. Repeats never inherit an earlier payment link; cancelled events are excluded from cash-flow and purchase forecasts.

Scheduled actual payments now create one atomic operation containing both the ledger movement and calendar linkage. Cloud preparation replays linked purchase, reversal, return and scheduled-payment transitions through the authoritative engine, allowing generated IDs to differ while requiring all amounts and links to agree.

The React preview also supports actual entries, account/date/text filters, paged immutable history and explained reversals. The server-only Zen text adapter is prepared for DeepSeek V4.1 Flash with an injected complete-input tokenizer, one bounded request, no automatic retries, sanitized failures and private response handling. It requires a trusted charge verifier to settle a spending hold. No provider credentials or finance-chat route are deployed.

The React goal view creates and edits priorities/deadlines, reserves or releases existing cash, records partial or completed purchases with explicit gold quantity, and retains archived goals. Linked reversals reopen purchased goals and keep their earlier installments. All changes use the same engine and atomic revision checks as the main app.

The main cash calendar compares full remaining goal purchases together by date. It orders hard deadlines and priorities, consumes each purchase cost once, releases only that goal’s existing reservation at payment time, and includes ongoing ownership costs from the following calendar month. Lower-priority purchases wait when an earlier goal cannot be funded. Dates remain conditional on entered income schedules, normal spending allowances and account liquidity through the complete checked horizon; budget salary alone is not cash. Comparisons never record purchases.

Budget reports compare expected and recorded income, recorded spending after refunds/corrections, category allowances and overspending. Transfers, borrowing and debt principal are excluded from spending or earned income. Savings/buffer allocations remain intentions, not verified balances. Archived categories and imported historical period assignments remain visible. Both interfaces use the shared report and budget-edit engine; current/future edits preserve original budget IDs, locks and allocation keys unless their amount is explicitly changed.

Private sync preparation now includes an explicit first-upload validator and an unapplied `database/bootstrap-draft.sql`. A permanent server-verified user must review the exact records and pinned destination; first upload initializes only an empty workspace, retains an immutable receipt for retries and refuses to overwrite an existing baseline. Offline operation history stays in local recovery rather than being replayed as new spending. The isolated database checks cover private RPC permissions, owner separation, retries, later edits and rollback.

Cloud comparisons bind both versions to digests and refuse rewritten shared transactions or changed original imports. Adopting a reviewed server snapshot saves the complete device version, queue and comparison atomically; pending edits stay held for manual review, and unsaved drafts remain. The backup screen reviews retained sync history, and its download now includes edits made after a restore. These helpers do not authenticate or upload by themselves. Live cloud sign-in, a verified server transport, organization selection and live RLS/advisor checks still need to be completed.

React calendar and outside-money views now share the native finance engine. Scheduled events can be created, recorded atomically, cancelled/restored by occurrence and replaced or stopped from a future date while earlier actual history remains. Replacements retain explicit repeat intervals. Ordinary bills can reference a spending allowance; expected income and debt payments use separate treatment. The calendar outlook explicitly excludes unscheduled normal spending and is not a purchase-safety guarantee.

Outside gifts, loans and investments save one linked cash entry; partial actual returns reduce the outstanding principal. Correcting the original requires reversing active returns first. Historical classification keeps original values and cannot recast borrowing or erase an actual return’s loan/investment meaning. Rejected form parsing stays within the save boundary and retains the draft and inputs.

React activity also supports two-category spending/refund splits, category and correction filters, and atomic reviewed replacements for ordinary unsplit spending, income or refunds. Linked and split records retain the explained reversal workflow. Incomplete splits are retained as unapplied drafts.

React accounts include unverified account creation, paginated full balance-check history, expected/observed balances and retained difference explanations with optional supporting entry links. Explanations do not create spending transactions.

React preferences support protected cash, future saving allocations, timezone and dated financial-cycle changes with retained cancellation history. Earlier period boundaries stay intact.

React Records provides full digest-protected JSON backup downloads, safe transaction CSV exports, and paste-based CSV mapping with row review, duplicate detection, stale-preview rejection and retained batch undo. Reviews paginate at 100 rows and accept up to 2,000 rows per import. Restore and retained sync recovery remain available through the main app. No export/import enables cloud upload.

React Planner also exposes joint conditional daily purchase dates, a single-purchase cash check and deadline income-gap calculation. Daily checks use saved budgets and dated schedules, independently of hypothetical monthly scenario inputs. Unknown cash accounts prevent supported daily purchase dates. Native schedule creation/replacement now exposes recurrence intervals instead of silently resetting them to one.

React Debts exposes one-debt payoff and combined highest-interest/smallest-balance comparisons with explicit APRs and minimums. These are non-mutating fixed-budget estimates; they neither record repayments nor confirm cash-flow affordability. Long desktop navigation scrolls within the sidebar; phone navigation retains contained horizontal scrolling.

Both interfaces can download a self-contained readable HTML report for offline viewing and printing. It separates current money from the selected period, recorded income/spending from budget intentions, and original legacy estimates from verified cash. Reports escape displayed text, include no scripts or external resources, and exclude unrelated notes, operation queues and raw backup content. Native report tables also show recorded income separately.

Every reviewed local restore now keeps a separate full pre-restore workspace, revision, queued edits and prior sync hold on the device, even when the outbox is empty. These copies remain outside the 30-snapshot rotation and appear in recovery review/downloads. They are never replayed automatically; keep independent downloaded backups as well.

The prepared private HTTP sync handler pins one HTTPS app origin and accepts only explicit authenticated JSON read/apply/bootstrap commands. It verifies a permanent user before reading finance input, bounds streamed bodies, preserves database conflict results and returns private non-cacheable responses with sanitized errors. It performs no redirects or automatic retries. No route is attached; live rate limiting, authentication configuration, organization selection and database verification remain required.

React Records now previews local JSON backups and retained recovery copies before an explicit replacement. The preview binds complete current and selected versions to integrity digests; concurrent edits reject the restore. Atomic storage retains the previous full state, queues and drafts permanently and holds future sync. Recovery history paginates locally and its audit download remains review-only.

The main interface also uses the shared digest-bound restore review, pins the reviewed revision during the atomic save, and invalidates its preview after another local save. Backup file size is checked before reading it.

Both interfaces share ordinary category creation and recoverable archival. Archived categories retain transaction evidence, allocations and reports; built-in and saving-intention categories remain available. Cloud validation replays each category command and rejects attempts to rewrite existing names, meanings or budget allocations.

The optional frontend cloud transport is inert until explicitly called. It requires the current HTTPS app origin, uses transient bearer credentials without cookies or redirects, validates returned workspace versions and bounds requests/responses. Conflicts remain reviewable; uncertain writes receive no acknowledgment or automatic retry. The HTTP boundary now requires a trusted durable account-admission function and denies access when that function is unavailable. No live limiter, route, session or automatic queue sender is configured.

The UNAPPLIED sync-rate-draft.sql adds private durable admission: 60 requests per owner per server minute, one atomic bounded counter per owner, no client clock or configurable limit, and no browser table/RPC access. Delayed requests cannot roll a newer bucket backwards. The server adapter exposes this admission callback; live database deployment, concurrent access checks, edge protection for unauthenticated traffic and route wiring remain pending.

React Goals also retains manual dated per-unit quotes and fees already included in the total goal budget. Actual gold holdings show recorded cost and quantity; linked corrections remain visible separately and are excluded from current holdings. Manual quotes are not current valuations, verified cash or assumptions of future appreciation.

The optional cloud review coordinator connects authenticated reads to local comparisons and confirmed adoption without uploading or replaying edits. It reads the cloud again before adoption, rejects changed local or remote versions, and uses the existing atomic local revision check to protect edits made during that final read. A cloud workspace that is empty requires a separate first-upload review. Retained records, held queues and drafts stay on the device. The server can advance after the last read; subsequent writes still require its version check. This coordinator is source preparation and is not yet wired to a live sign-in or interface.

Queue sending now captures the complete selected queue before any asynchronous work and requires its original versions to form a contiguous chain from the selected baseline. It cannot silently rebase an edit onto a newer server version. A lost-response duplicate that reveals later cloud edits stops for review without acknowledging or sending subsequent operations. Malformed or impossible receipts never clear the queue.

The transport deadline also covers sign-in credential retrieval. Failed or stalled sign-in keeps records locally, hides raw session errors and cannot trigger a delayed request after timing out.

Private deployment wiring now has a separately bundled Node function for `/api/plan/sync`. It returns a private 503 response by default and makes no database requests. It requires both explicit server readiness flags and valid runtime origin/database/publishable/secret configuration before creating the authenticated handler. Runtime environment lookups remain server-side; the bundle contains no credentials. Build with `npm run build:server` after server changes. Live configuration must wait for the separate project, applied private SQL, authentication and access checks; never enable the flags based only on a successful bundle build.

Cloud note validation restricts creation, editing, checklist toggles and archive/restore to one note per operation. Editing retains checklist identity/progress; archive/restore retains all note content, and archived checklist items cannot be toggled.

The optional first-upload controller previews complete records and original imported history with the exact private Supabase destination, request identity and integrity digest. Sending requires explicit confirmation, unchanged local records and an empty cloud read; the database still checks for a concurrent initialization. Existing cloud history is never replaced. Uncertain writes do not retry or clear local edits, and even a confirmed first-upload receipt requires a separate cloud comparison before adopting a baseline. Oversized history stays complete locally. This controller is not wired to a live session or interface, and does not authorize or retry the previously denied actual backup upload.

Browser quota/retention estimates are optional hints: unsupported APIs or failed checks cannot make an otherwise opened workspace appear unavailable. React Records can refresh these hints and explicitly ask the browser for retention against automatic cleanup. Retention does not protect against clearing browser data or device loss; full backups must also be kept independently. Phone layout remains contained.

The UNAPPLIED AI conversation draft retains only the reviewed question and final answer, tied to an admitted durable request and an owned initialized workspace. Question digests must match admission; duplicate receipts cannot rewrite answers. Tables use owner/non-anonymous RLS with no browser writes, and service-only RPCs provide bounded cursor pagination. The private adapter exposes save/read preparation using only the server API key. A future AI route must use the workspace captured with the admitted context, not a later client-selected workspace, and must verify final output before storing it. No conversation route, automatic history transmission, provider credential or live SQL is enabled; hidden reasoning is never retained through these methods.

Weekly review actions now open the relevant account, calendar, budget or exact activity evidence. Activity can return to all entries after a targeted review. Recorded goal purchases, linked gifts and paid scheduled bills retain their known purpose and do not create ordinary uncategorized warnings; their amounts still count in spending. An ordinary review correction retains the original, reversal and replacement without changing cash when the amount is unchanged.

The private sync boundary also replays each ordinary manual or CSV transaction through the authoritative engine. A transaction operation cannot invent goal/outside/correction metadata, claim a specialized source or append multiple cash entries. Linked financial commands retain their separate atomic checks.

Cloud acknowledgment preparation commits the exact receipt, one queued operation and reviewed baseline together in IndexedDB. It requires an unchanged local revision, identical queued operation, matching workspace and contiguous version, and refuses restore holds. Concurrent edits, unexpected receipts and out-of-order acknowledgments retain all records, queues and drafts. Authentication and sending remain the responsibility of a future verified session controller; the helper performs no network requests.

Goal commands at the private sync boundary retain existing purchase and archive history. New goals start without fabricated progress or reserved cash; edits affect one existing goal, archives replay the engine, and reserve/release operations change one active goal without moving another goal's savings.

The optional reviewed queue sender captures local state, revision, queue, baseline and hold in one consistent read. A future verified session controller supplies the current permanent identity and authenticated transport. Preview performs no finance network request; explicit sending rechecks the exact review and identity, reads the current cloud version, preserves original operation versions and atomically retains each receipt. Changed accounts, concurrent edits, restore holds and uncertain responses stop sending without retries or discarding pending edits. This module is not connected to live sign-in or the app interface.

The optional private-session adapter uses pinned Supabase JS 2.117.2 with memory-only sessions, no automatic refresh and no URL grant detection. Explicit password sign-in verifies the exact access token with Supabase getUser, requires a confirmed permanent identity and rechecks that the session did not change. Expired/revoked/mismatched identities, concurrent sign-out and late timed-out logins cannot supply cloud credentials. Passwords and tokens are not added to finance records or backups. This is tested preparation using synthetic authentication responses; no live account, email, project or sign-in UI is configured. Reloading would require sign-in again under this initial memory-only policy.

Both interfaces compare the minimum exact spending reduction in a selected flexible category that could fund a purchase goal by a deadline. The scenario shows the current and compared allowances for each eligible future period, retains earlier hard deadlines and reports other goals still unfunded by that date. It preserves locked allowances, recorded spending, scheduled bills, ongoing costs and protected savings. A missing transition budget blocks the comparison. This is a local hypothetical calculation: it changes no saved budget, income, spending or balance and is not an automatic recommendation to cut essential expenses.

The optional private-cloud composition connects verified memory-only sign-in to authenticated comparisons, confirmed adoption and explicitly reviewed pending edits. One cloud action runs at a time; sign-out immediately invalidates pending work without deleting local records. Comparisons stay bound to the signed-in permanent identity. The composer cannot initialize a cloud workspace or invoke first upload. Integration tests exercise the actual pinned SDK and HTTP validation boundary with synthetic authentication and storage responses. Real project/RLS/session verification and browser configuration remain prerequisites; no live cloud controls are wired yet.

Provider verification now shares one deadline across complete token counting, the request, streamed response and trusted charge verification. A timeout aborts the response reader, keeps uncertain cost holds and never starts a late provider request after token counting expires. Invalid UTF-8 rejects the answer instead of silently replacing characters. No live provider or credential is configured.

The optional read-only advisor service prepares an exact aggregate-data review with the question, model, fresh provider quote and maximum reserved cost. It reconstructs the server-owned snapshot before admission and rejects changed records or reviews. Durable reservation and verified settlement precede a saved answer; history stays bound to the originally admitted workspace and question even if the caller changes a selection during generation. An unavailable history save returns the confirmed paid answer with historySaved=false and never regenerates it automatically. No HTTP advisor route, real provider credential, complete tokenizer or trusted billing verifier is connected yet.
