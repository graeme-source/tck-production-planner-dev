# Development Charter — rules for every change

**Status:** v1.0 (2026-08-16) — companion to `docs/PRODUCT_SPEC.md` and
`docs/CODEBASE_ANALYSIS.md`.
**Who this is for:** any person or AI agent making changes to this codebase, in any
environment (Replit, Claude Code, local). Paste it, point to it, or read it — but
follow it. The strategy is **incremental improvement of the main app** (no rebuild,
no parallel version); these rules are what keep years of increments from re-creating
the structural problems catalogued in the analysis.

## Before any code

Read `docs/PRODUCT_SPEC.md` (objectives A–I) and `docs/CODEBASE_ANALYSIS.md`
§5 (structural causes) and §8 (working agreements).

## The rules

1. **State which objective (A–I) the change serves** before building. Serves none →
   stop and ask Graeme.
2. **Fix causes, not symptoms.** If the defect lives in a known duplicated formula
   or a §5 structural problem, fix it at the source — never patch one copy.
3. **Check for existing logic before writing new logic.** Known multi-copy logic:
   the order formula, expiry/shelf-life logic, category→storage-location maps,
   Shopify variant-map loading. Reuse or consolidate; never add another copy.
4. **No new code in `routes/production-plans.ts`, `pages/settings.tsx`, or
   `pages/reports.tsx`.** New endpoints/components go in new focused files; code
   touched inside those files migrates out as part of the change.
5. **Every data-entry field autosaves or shows an unmissable save state.** Silent
   `.catch(() => {})` is banned. Data loss is always a P1 defect.
6. **New frontend data fetching uses React Query** — no bare `fetch` inside
   `useEffect`.
7. **Every new endpoint validates its body** with the zod `validate()` middleware.
8. **No hard-coded product names, recipe IDs, or category strings in logic.**
   Behaviour that varies per recipe/ingredient is a database flag, not a name match.
9. **Schema changes go through a Drizzle migration file** in `lib/db/migrations/` —
   never `runStartupMigrations()` in `api-server/src/index.ts`.
10. **Small, separately revertable commits**, each message stating what changed and
    which objective it serves.
11. **Bug fixes ship with a regression test** once the test harness exists (P0);
    until then, note the manual verification performed.
12. **Close the loop:** at the end of a session, list anything that bent these rules
    and why, and note any spec-relevant feature that landed so the spec can be
    updated (e.g. new capabilities that fulfil an objective's design direction).

## Why these specific rules

Each rule maps to a documented cause of today's problems (`CODEBASE_ANALYSIS.md`):
duplicated formulas that drifted (§5.1), mega-files nobody can safely change
(§2, §5.1), silent save failures (§3 Objective F), three fetch patterns (§5.5),
~6% validation coverage (§2), name-matched business logic (recipe-flow findings),
and the dual migration system (§5.4).
