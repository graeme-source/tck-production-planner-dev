# TCK Production Planner — Codebase Analysis

**Status:** v1.0 (2026-08-15) — companion to `docs/PRODUCT_SPEC.md`
**Method:** full-code sweep of the monorepo (data model, backend routes, frontend pages,
build/test infrastructure), assessed against spec objectives A–H. All claims carry
`file:line` references verified against the current tree.

---

## 1. Executive summary

The system is functionally rich and clearly battle-tested — it already runs the whole
loop from Shopify sales to dispatch. But it has grown by accretion, and three
structural problems now work directly against the spec objectives:

1. **Stock is not a ledger.** Ingredient stock is a pile of point-in-time snapshot
   rows; nothing ever *consumes* stock when production happens. This makes Objectives
   B and C (sales-driven stock, never-run-out/never-expire) impossible to achieve
   properly — the system cannot know what it used, only what someone last counted.
2. **The core engines live inside giant route files with no service layer.**
   `production-plans.ts` is 9,411 lines with 87 endpoints and single handlers over
   1,200 lines; business rules are duplicated (sometimes divergently) between backend
   files and between backend and frontend. Every change is risky, which slows down
   exactly the daily-issue fixing this spec exists for.
3. **There is no safety net.** Zero tests, no CI, no lint, request validation on ~6%
   of 634 endpoints, and two competing database migration systems. Defects like the
   ones catalogued in §4 ship silently.

None of this needs a rewrite. The recommended path (§7) is: fix the known
data-correctness bugs first, then introduce a stock ledger and extract the three core
engines (plan calculator, order engine, stock) into tested service modules, then build
the objective-level features (shelf-life-aware ordering, HACCP report pack,
personalised start pages) on that foundation.

---

## 2. Snapshot

| Area | Size | Notes |
|---|---|---|
| Total TypeScript | ~174k LOC | monorepo: `artifacts/api-server`, `artifacts/production-planner`, `lib/*` |
| Backend routes | 68 files, **634 endpoints** | no service layer; 6 external-integration adapters only |
| Largest backend file | `routes/production-plans.ts` — 9,411 LOC, 87 endpoints | single handlers of 1,285 lines (`:644`) and 921 lines (`:7086`) |
| Largest frontend files | `settings.tsx` 6,094 LOC (48 components, 176 `useState`); `production-plans.tsx` 6,491; `reports.tsx` 5,417 | |
| Tests / CI / lint | **none** | no test files, no `.github/`, no eslint config; gate is `tsc` only |
| API spec coverage | ~46 of 634 endpoints (~7%) | orval-generated clients cover a legacy core; everything since is hand-rolled |
| Frontend data fetching | 3 competing patterns; **656 raw `fetch(`** | orval hooks (36 files), hand-written `useQuery` (39), bare `useEffect`+`fetch` (24) |
| Migration systems | **two** | `runStartupMigrations()` in `api-server/src/index.ts:96-2808` (332 DDL statements at every boot) *and* 53 Drizzle migrations in `lib/db/migrations/` (with a duplicated `0017_` pair) |
| Committed junk | ~27.5 MB | `attached_assets/` (27 MB incl. two `.mov` screen recordings), `backups/` (2 SQL dumps), 3 unreferenced root PNGs |

A counter-signal worth recording: comment quality is high and TODO/FIXME debt is
essentially zero. The problem is structure and missing infrastructure, not sloppiness.

---

## 3. Findings by spec objective

### Objective A — Add new recipes quickly and easily

**Verdict: far from the "one sitting, no surprises" bar.** Making a new recipe fully
operational today takes ~17 steps across at least 5 different screens, several of
which fail silently.

- The Add dialog covers only part of the data. Shopify variant mapping and Label LIVE
  design exist **only in the Edit dialog** (`recipes.tsx:1247`, `:1023`) — you must
  create, close, reopen. `maxBatchesPerDay` is only editable from the **Case Orders**
  page (`case-orders.ts:133`). Assembly order is only settable from the **building
  station at run time** (`building-station.tsx:473`). Marinades and QUID flags have
  **no UI at all** — API-only (`recipes.ts:170-181`; `quid` is in the form schema at
  `recipes.tsx:55,66` but no checkbox renders it).
- **Silent non-appearance:** a recipe that has neither an active DPT settings row nor
  `isCoreMenu` **never appears on any production plan** (`production-plans.ts:1387-1440`).
  Nothing warns about this — it is the canonical "it silently doesn't appear in X".
- **Silent failures in the save path:** `POST /api/recipes` inserts the recipe row in
  a transaction but the ingredient/sub-recipe/marinade rows **outside it**
  (`recipes.ts:230-276`) — a failed insert orphans the recipe. (The `PUT` handler was
  fixed for exactly this, `recipes.ts:565-567`; `POST` wasn't.) `isFridgeProduct` is
  saved via a second fire-and-forget HTTP call with `.catch(() => {})`
  (`recipes.tsx:2367-2385`).
- **Quick-add ingredient creates a stub** with `packWeight: 0, costPerPack: 0`
  (`recipes.tsx:344`) so costing silently reads £0 with no "incomplete ingredient"
  flag downstream.
- Sales matching without a variant mapping falls back to fuzzy name matching
  (`production-plans.ts:1283-1300`), and the "Calzone Club Special" is routed by a
  hard-coded product title (`production-plans.ts:1138`, `inventory-sync.ts`).
- The AI Recipe Designer proposes drafts but supports fewer fields than the form and
  leaves all post-create wiring manual; it's also gated to a hard-coded founder email
  (`recipe-designer.ts:27`).

### Objective B — Manage existing stock based on sales

**Verdict: finished-goods side is genuinely close; ingredient side is not connected
to sales at all.**

What works: Shopify orders drive plan deficits (`production-plans.ts:1412-1444`),
wrapping/fulfilment increment/decrement finished-goods fridge stock with FIFO batch
tracking (`inventory-sync.ts:199-288`), and a sell-through throttle hides delivery
slots when surplus is low (`stock-gating.ts:292-327`).

What doesn't:

- **Ingredient stock has no recorded consumption events.** Deliveries add snapshot
  rows; counts overwrite; production writes *nothing* to stock (prep completion is
  a tick only, `production-plans.ts:8066-8121`). "Latest snapshot row wins" is the
  read model everywhere (`orders.ts:203-210`, `stock-control.ts:45-54`).
  *Nuance:* consumption **is** accounted for — but only transiently, at
  calculation time, by `lib/outstanding-prep.ts`, which predicts today's
  post-prep stock inside the order maths ("only the ordering maths applies the
  deduction" — its own design note, `outstanding-prep.ts:10-12`). It covers
  today only (plus a 5-day deferred-tin sweep), tin-tracked prep only (bases/
  sauces/dough explicitly out, `outstanding-prep.ts:32-35`), and is recomputed
  from inference on every load — the 2026-08-13 "19 kg reported as 1.36 kg,
  order suppressed" bug (`outstanding-prep.ts:80-84`) shows the fragility.
  Persistent theoretical stock, usage history, and count-vs-theory variance
  remain unobtainable.
- **`stock_transfers` corrupts stock**: it inserts +/− *delta* rows into the
  *snapshot* table (`stock-transfers.ts:65-83`), so after a transfer the source
  location reads as a negative number and the destination as just the moved amount.
- **Two competing count records** (`stock_entries` vs `daily_stock_checks`),
  reconciled by newest-timestamp-wins (`orders.ts:235-248`).
- The demand number behind ordering buffers (`dpt_settings.packsSold`) is
  **hand-typed**, not derived from sales (`dpt-settings.ts:41,58`). The
  `sales_entries` table exists and is dead — nothing in planning reads it.

### Objective C — Never run out, nothing goes out of date

**Verdict: the order engine is single-day, shelf-life-blind, and waste is not
recorded anywhere.**

- The core formula (`orders.ts:437-459`) is sound in shape
  (`required + surplus + outstandingPrep − stock − inbound`, pack/case rounding,
  kanban floor) but its horizon is **one production plan** — supplier
  `leadTimeDays` predicts a delivery date but never sizes the order
  (`orders.ts:81-104` vs `:943-946`).
- **`shelf_life_days` and `perishable` are never read by the order engine** — raw
  meat is ordered on the same %-buffer rule as tinned tomatoes. The surplus buffer
  (default 10% of daily usage ≈ 2.4 hours of cover) is time-dimensionless
  (`orders.ts:415-425`).
- **The buffer is numerically wrong for processed ingredients:** `orders.ts:91`
  computes raw = cooked ÷ ratio, but `dpt-ingredient-requirements.ts:52-54` computes
  cooked = raw × ratio the other way round — the value driving `surplusTarget` at
  `orders.ts:420` is off by ratio² for any ingredient with a processing ratio.
- **Expiry warnings are unreliable**: `/expiry-warnings` scans *every* historical
  snapshot row with a use-by date, not the latest per item (`deliveries.ts:258-294`),
  so stale rows resurface as live expiring stock, and fresh counts (which insert
  `use_by_date = NULL`, `orders.ts:1153-1160`) never clear warnings.
- **No waste recording.** The only "discard" zeroes one historical snapshot row
  (`deliveries.ts:372-383`) — usually without even changing the current level — and
  captures no quantity, reason, or cost. Objective C's "tune buffers from evidence"
  has no evidence to use.
- **No ingredient lot tracking** — `fridge_stock_batches` exists for finished product
  only (`stock.ts:46-54`); there is no FEFO for raw materials and no raw-lot →
  finished-batch traceability (this also blocks Objective D).
- A missed stock count silently reads as `stockOnHand = 0` → the engine orders the
  full requirement (`orders.ts:414`).
- The order formula is **reimplemented in the frontend without the kanban floor**
  (`orders.tsx:1299-1305` vs `orders.ts:444-450`) — editing a count on a kanban line
  visibly drops the suggestion below the kanban amount.

### Objective D — HACCP / SALSA

**Verdict: strong capture, weak assembly.** The raw materials of compliance exist —
goods-in temps and supplier QC checks (`ordering.ts:103-131`), fridge/freezer temp
records per plan (`ordering.ts:32-44`) plus Govee sensors, cooking temp fields,
checklists (`checklists.ts`, 18 endpoints), Andon as corrective actions,
risk assessments, visitor log, training records. What's missing for SALSA:

- **No traceability chain**: with no ingredient lot tracking (see Objective C) the
  question "which products contain delivery batch X" cannot be answered.
- **No audit report pack**: nothing assembles temp logs + goods-in + checks +
  corrective actions for a date range into an auditor-ready output; `reports.ts`
  is operational/financial.
- **No missed-check escalation**: a skipped check is silently absent rather than
  flagged the same day (spec D.2).
- Compliance-critical tables like `fridge_stock_changes` exist **only as boot-time
  raw DDL** (`index.ts:2426-2441`) with no schema entry — fragile foundations for
  audit evidence.

### Objective E — Continuous improvement culture

**Verdict: the seeds exist and are genuinely aligned** — improvements/Kaizen
(`improvements.ts`), Andon (`andon.ts`), lean lessons (1,416-line seed,
`seed-lean-lessons.ts`), training matrix, SOPs (`standards.ts`), morning meetings.
Gaps are product-level, not code-level: improvements don't loop back into the process
artefacts they change (SOP/checklist/station notes, spec E.4), and there's no
per-person visibility/recognition surface (that lands with Objective H).

### Objective F — Effortless, trustworthy daily use

**Verdict: the architecture works against it.** The specific defect class Graeme
described ("filled it in but it didn't save") is structurally likely:

- 24 frontend files use bare `useEffect` + `fetch` + `useState` with no cache, no
  mutation state, and hand-rolled error handling; `settings.tsx` alone has 106 raw
  `fetch(` calls. Whether a given field autosaves depends entirely on which of three
  patterns its author used that day.
- Silent `.catch(() => {})` swallowing is an established idiom
  (e.g. `recipes.tsx:2367-2385`).
- No central backend error middleware; 1,101 hand-rolled `res.status(n).json({error})`
  sites; validation on ~6% of endpoints means malformed saves can 500 or silently
  no-op.
- The end-of-day batch numbers issue should be reproduced and fixed as the flagship
  case (entry points: `checklists.ts`, `station-checklist.tsx`,
  `stock-control.tsx`), then the fix pattern (autosave + visible save state)
  standardised.

### Objective G — Glanceable status

`dashboard.tsx` (1,165 LOC) already aggregates the right facts but presents numbers
first. This is a design-system task more than a code task — but it depends on §5's
frontend consolidation so status components read from one query layer instead of
per-page fetch spaghetti.

### Objective H — Personalised team experience

The ingredients exist: Planday integration (`services/planday.ts`, `employees.ts`),
per-user auth with PINs and avatars, `system-updates.ts` (in-app changelog),
improvements with submitter identity, training records. Nothing joins them: there is
no "my day" surface, and nothing targets updates by station or person. This is a
genuinely new feature, best built after the cleanup so it composes existing data
rather than adding a fourth fetch pattern.

---

## 4. Concrete defects found (fix these regardless of any refactor)

Ordered by data-damage potential:

1. **1000× nutritionals error for kg-unit ingredients.** `recipes.ts:927` treats
   every recipe-ingredient quantity as grams, ignoring `ingredients.unit` — the same
   file defines `toGrams()` for exactly this (`recipes.ts:1254-1260`). Any recipe
   using a kg ingredient gets label nutritionals understated ~1000×. **Food-label
   accuracy issue → also Objective D risk.**
2. **Stock transfers make stock levels wrong** (delta rows in a snapshot table,
   `stock-transfers.ts:65-83`) — negative stock at source, wrong level at destination.
3. **Ordering buffer off by ratio²** for processed ingredients
   (`dpt-ingredient-requirements.ts:52-54` vs `orders.ts:91,420`).
4. **Expiry warnings scan stale snapshots and can't be cleared by counts**
   (`deliveries.ts:258-294`; `orders.ts:1153-1160`).
5. **Non-atomic recipe create** can orphan recipes (`recipes.ts:230-276`).
6. **Frontend/backend order-formula drift** — frontend omits the kanban floor
   (`orders.tsx:1299-1305`).
7. **Mac-cheese calculator forked from the main calculator and missing the
   `packSize = 2` filter** its parent has (`production-plans.ts:2081-2090` vs `:752`)
   — the exact bug the comment at `:737-741` warns about.
8. **`DELETE /api/recipes/:id` has no auth guard** and cascades into plan history
   (`recipes.ts:684-687`).
9. **Placing a PO flips *all* pulled kanbans for the ingredient to `ordered`**, even
   when multiple bins are empty (`orders.ts:968-976`).
10. **API spec rejects sub-recipe marinades** (`api.ts:797-802` requires
    `marinadeIngredientId` non-null) — and the workaround, a global `.passthrough()`
    in `validate.ts:9`, disables unknown-field validation for the entire API.
11. **`/regenerate` and two recipe endpoints call their own server over HTTP
    loopback** with the user's cookie (`orders.ts:1201-1204`; `recipes.ts:1628,1812`)
    — fragile behind proxies, hard-fails without `PORT`.
12. **Spec-sheet barcodes join on product title = recipe name** — renaming a recipe
    silently loses its barcode (`recipes.ts:1782`).

---

## 5. Structural problems (the causes behind the symptoms)

1. **No service layer.** Business logic lives inline in route handlers; the plan
   calculator, order engine, and stock mutations are not importable units. Symptoms:
   `/regenerate` HTTP-calling `/calculate`; `inventory-sync.ts:20` importing from a
   *routes* file; `stock-gating.ts:265` using a dynamic import to dodge the resulting
   cycle; the same rule pasted 3–6× (category→location map ×3 with divergent keys and
   different fallbacks, `deliveries.ts:26-51` / `orders.ts:1134-1150` /
   `production-plans.ts:2854-2870`; mozzarella predicate ×6; variant-map loading ×5;
   `normalizeForMatch` twice in one file).
2. **Snapshot-based stock model.** One `stock_entries` table serving as level store,
   history, transfer log, and expiry source — it can't be all four (see §3 B/C).
   The only true ledger, `fridge_stock_changes`, covers finished product only and
   isn't even in the schema.
3. **Fridge-stock mutation has three implementations** — the documented chokepoint
   `adjustFridgeStock` (`fridge-stock.ts:83-230`), the non-chokepoint
   `syncRecipeFridgeStock` (`production-plans.ts:57-106`, no batch sync), and an
   inline FIFO re-implementation (`inventory-sync.ts:255-279`). The chokepoint's own
   docblock names this drift as the known cause of table disagreement.
4. **Two migration systems** — 2,712-line boot migration + Drizzle files, with tables
   that exist only in one (`recipe_shopify_mappings`, `fridge_stock_changes`) and a
   duplicated `0017_` sequence number.
5. **Frontend mega-files and three fetch patterns** (see §2) — the direct cause of
   Objective F unreliability and the obstacle to Objective G.
6. **No tests, no CI, no lint** on 174k LOC / 634 endpoints. Every defect in §4
   shipped silently and any refactor is currently unprotected.
7. **API spec/codegen abandoned at ~7% coverage** — the orval toolchain is paid for
   but not earning; hand-rolled fetches diverge from backend truth (§4.6 is one
   example).

---

## 6. Dead weight (delete or extract)

| Item | Evidence | Action |
|---|---|---|
| `artifacts/mockup-sandbox/` | orphaned — imports a directory that doesn't exist; referenced only by the lockfile; still installed & built by root `pnpm build` | delete package |
| `pages/ingredients.tsx` (1,550 LOC) + `pages/supplies.tsx` (630) | routes are `<Redirect>`s to `/inventory` (`App.tsx:147,158`); components never render but ship in the bundle | delete |
| `/stock`, `/sales`, `/label-live-test`, `/plans/queued` pages | routed but zero nav entries and zero inbound links | confirm with team, then delete or link |
| `sales_entries` table + `routes/sales.ts` | nothing in planning reads it | delete, or make it the sales-history store for forecasting (§7 P3) |
| `attached_assets/` (27 MB), `backups/` SQL dumps, 3 root PNGs | committed binaries; `.gitignore` guards similar dirs but not these | remove from repo, gitignore |
| `lib/api-zod` frontend usage | zero frontend imports | fold into the API-spec decision (§7) |
| Peripheral clusters: surveys (3.1k LOC), founder-* (6.8k), morning meetings (5.5k) | wired but outside objectives A–H core | freeze; extract only if they start creating drag |

---

## 7. Recommended roadmap

Each phase is shippable on its own and ordered so later phases get cheaper.

### P0 — Safety net + known defects (days, not weeks)

- Add vitest + a GitHub Actions workflow running `typecheck` and tests; add eslint.
- Fix §4 items 1–7 (each is small once located; write the first regression tests
  against them — they are perfect test seeds).
- Reproduce and fix the end-of-day batch numbers save loss; establish the
  autosave-with-visible-state pattern (Objective F.1).
- Repo hygiene: delete §6 dead code, purge committed binaries.

### P1 — One truth for stock (the keystone for B, C, D)

- Introduce a **`stock_movements` ledger** for ingredients: every delivery, count
  correction, transfer, production consumption, and waste is a typed, signed,
  attributed row. Current level = sum (materialised); counts become corrections that
  record variance instead of overwriting truth.
- Derive production consumption from plan completion via the existing
  `ingredient-resolver` (theoretical usage), reconciled by counts.
- Add **waste capture** (qty, reason, cost) as a movement type — one-tap from the
  stations and stock-control screens.
- Add **ingredient lot tracking** at goods-in (delivery line → lot with use-by),
  giving FEFO picking, reliable expiry warnings, and the SALSA traceability chain.
- Collapse `daily_stock_checks` into the ledger; fix the transfers table by making
  transfers two ledger movements.

### P2 — Extract the engines (makes everything after this cheap)

- Extract `calculatePlanData`, the order engine, and stock mutations into
  `api-server/src/services/` modules with unit tests; route files become thin.
  Kill the loopback HTTP self-calls. Single implementation for: order formula
  (backend serves the frontend its numbers), expiry logic, category→location map,
  variant-map loading.
- Converge on **one migration system** (Drizzle); freeze `runStartupMigrations` and
  port stragglers (`recipe_shopify_mappings`, `fridge_stock_changes`) into the schema.
- Frontend: one data-fetching pattern (React Query + a typed client), applied
  page-by-page starting with the daily-use screens (checks, stations, stock-control);
  split `settings.tsx` / `reports.tsx` / `production-plans.tsx` into feature folders
  as they're touched — not as a big-bang.
- Decide the API-spec question honestly: either regenerate the spec from the code
  (e.g. zod-to-openapi on the real routes) or drop orval — 7% coverage is the worst
  of both.

### P3 — Objective-level features on the new foundation

- **Ordering v2 (Objective C):** multi-day demand horizon = f(lead time + delivery
  days); shelf-life-capped order windows for perishables; both-direction risk flags
  ("runs out Thursday" / "won't be used before expiry"); buffers tuned from recorded
  waste + variance data.
- **Sales-driven demand (Objective B):** replace hand-typed `dpt_settings.packsSold`
  with rolling sales-derived figures (day-of-week profile from Shopify + case
  orders); keep manual override with a visible "overridden" state.
- **Recipe wizard (Objective A):** single guided flow covering all of §3 A's steps —
  ingredients (with completeness gates on the quick-add stub), Shopify mapping, DPT/
  core-menu status, labels — ending with an operational-readiness checklist
  ("appears on plans ✓, sales-linked ✓, deck publishable ✓"). Surface marinades/QUID
  in the UI.
- **SALSA report pack (Objective D):** date-range audit export assembling temp logs,
  goods-in QC, checklist completion (with gaps flagged), corrective actions, and
  lot-level traceability; same-day missed-check escalation.
- **Dashboard status redesign (Objective G)** and **personal start pages
  (Objective H):** Planday-driven "my day" landing, station-targeted process-change
  notices from `system-updates` + improvements, recognition surface (Objective E
  ties in here).

### Sequencing rationale

P1 before P3 because every P3 feature consumes ledger data (forecasting needs usage
history; shelf-life ordering needs lots; SALSA needs traceability; waste-tuned
buffers need waste records). P2 before P3 because building features on the current
9,400-line files means every feature pays the duplication tax again.

---

## 8. Working agreement going forward

- New daily issues get logged against an objective and, where possible, fixed at the
  cause layer named in §5 rather than patched in place.
- Every bug fix lands with a regression test (the suite grows where it hurts).
- No new code in `routes/production-plans.ts`, `settings.tsx`, or `reports.tsx` —
  new work goes in extracted modules, and touched code migrates out.
- One data-fetching pattern for all new frontend work; autosave-with-visible-state
  for every daily-entry field.
