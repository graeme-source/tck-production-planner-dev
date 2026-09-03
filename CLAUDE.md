# TCK Production Planner — session guide

Read this first, every session.

## Objectives & charter

- `docs/PRODUCT_SPEC.md` — the product objectives (A–I; letters are names, not
  rankings — all equally important). Frame all advice and prioritisation against
  them; name the objective every change serves.
- `docs/DEVELOPMENT_CHARTER.md` — 12 non-negotiable rules for every change.
  Highlights: no new code in `routes/production-plans.ts` / `pages/settings.tsx` /
  `pages/reports.tsx`; schema changes via Drizzle migration files in
  `lib/db/migrations/`, never `runStartupMigrations()`; zod `validate()` on every
  new endpoint; React Query for all new data fetching; no hard-coded
  product/recipe/category names in logic; autosave with visible save state on
  every data-entry field; bug fixes ship with a regression test.
- `docs/CODEBASE_ANALYSIS.md` — known structural problems, open defects, and the
  roadmap. Check it before diagnosing anything.
- `docs/ISSUE_PIPELINE.md` — how team-reported issues flow to fixes.

## Project facts

- pnpm workspace monorepo: `artifacts/api-server` (Express 5 + Drizzle +
  PostgreSQL), `artifacts/production-planner` (React + Vite + Tailwind +
  shadcn/ui + React Query), shared packages in `lib/`.
- Deployed on Railway; `master` auto-deploys production ("live"). Never merge or
  push to a deploying branch without Graeme's explicit approval.
- `replit.md` is a LEGACY file from the original Replit build — its architecture
  notes are still a useful reference, but Replit itself is no longer used.
- Verify work with: `pnpm run typecheck` (workspace-wide) and `pnpm run test`
  (vitest; tests are colocated `*.test.ts`, pure logic only — no DB/network).
- Roles: admin > manager > viewer (`middleware/roles.ts` has the shared guards).

## Working style

- Small, separately revertable commits; plain-English messages stating what
  changed and which objective it serves.
- Fix causes, not symptoms; check for existing logic before writing new logic.
- Destructive/outward-facing actions (deletes, Shopify writes, emails, deploys)
  need explicit approval from Graeme.

## You may not be the only session in this folder

Graeme sends several jobs at once from the production area, and they can land
as separate sessions sharing ONE working tree and ONE branch. On 2026-09-03 two
sessions edited this folder at the same time, and only luck kept their work in
different files.

- Run `git status` before you start and again before you commit. Uncommitted
  changes you did not make mean another session is live right now.
- **Stage by name, never `git add -A` / `git add .` / `git commit -a`.** Commit
  only the files you wrote. Sweeping up someone else's half-built feature makes
  it impossible to revert either one on its own.
- Don't commit at the same moment as another session — a shared git index will
  jam. If a commit fails on `index.lock`, wait and retry rather than deleting
  the lock.
- Never revert, stash or "clean up" changes you don't recognise. Tell Graeme.
- Say so in your summary when you see another session's work in the tree; he
  can't see `git status` from the factory floor.
