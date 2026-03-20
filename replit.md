# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## App: Food Production Planner

A full-stack production management app for food businesses with:
- **Ingredients** — library of raw ingredients with unit and cost
- **Sub-recipes** — intermediate preparations (e.g., sauces, doughs) with ingredient lists
- **Recipes (Products)** — final products with full cost/margin engine: pack size, RRP, packaging cost, labour cost, gross margin colour-coded by profitability (≥60% green, 50-59% amber, <50% red)
- **Production Plans** — daily plans with a list of recipes and target quantities; track actual output and status (draft/active/completed)
- **Stock Inventory** — stock check entries for finished recipes and raw ingredients
- **Sales Data** — log sales per recipe by date, channel, and quantity
- **Dispatch Orders** — upcoming dispatch orders with customer, date, quantity, and status
- **Dashboard** — overview of today's plan, upcoming dispatches, low stock, and recent sales
- **Settings** — user management (admin/manager/viewer roles) + category cost defaults (packaging & labour auto-fill per category) + Default Production Targets (DPT): enter packs sold per recipe → auto-calculates sales % and default batch allocation based on a total daily batch budget
- **Category Defaults** — per-category default packaging/labour costs stored in `category_defaults` table; auto-fill recipe form when category matches
- **Authentication** — session-based login (express-session + connect-pg-simple → `sessions` table). Login page at `/login`. All `/api/*` routes except `/api/auth/*` require a valid session. Default admin: `admin@proplanner.com` / `Admin1234!`

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Frontend**: React + Vite, Tailwind CSS, shadcn/ui, React Query, react-hook-form, recharts, date-fns, framer-motion

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   ├── api-server/         # Express API server
│   └── production-planner/ # React+Vite frontend
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
└── package.json
```

## Database Schema

- `ingredients` — raw ingredients (name, unit, cost_per_unit, notes)
- `sub_recipes` — sub-recipes with yield and yield unit
- `sub_recipe_ingredients` — sub_recipe <-> ingredient junction with quantity
- `recipes` — final product recipes (name, category, servings, serving_unit)
- `recipe_ingredients` — recipe <-> ingredient junction
- `recipe_sub_recipes` — recipe <-> sub_recipe junction
- `production_plans` — daily plans (plan_date, name, status: draft/active/completed)
- `production_plan_items` — plan items (recipe, target_qty, actual_qty, status: pending/in_progress/completed)
- `stock_entries` — stock check entries (item_type: recipe|ingredient, quantity, unit)
- `sales_entries` — sales records (recipe, sale_date, quantity_sold, channel)
- `dispatch_orders` — dispatch records (recipe, dispatch_date, quantity, customer, status)
- `app_settings` — simple key-value store for admin-configurable global settings (e.g., `mixer_capacity_kg=25`)
- `batch_completions` — each station batch completion event with `station_type` column (for per-station counts and cascade validation)
- `station_breaks` — break start/end times per station
- `dpt_settings` — per-recipe DPT configuration (packsSold, isActive); used with app_settings `total_daily_batches` to compute sales-based default batch allocations
- `timing_standards` — per-station KPI targets (minBatchesPerHour, targetBatchesPerHour)

## API Routes

All routes under `/api/`:
- `/ingredients` — CRUD
- `/sub-recipes` — CRUD with nested ingredients
- `/recipes` — CRUD with nested ingredients + sub-recipes
- `/production-plans` — CRUD with nested items
- `/stock-entries` — CRUD
- `/sales-entries` — CRUD with date filtering
- `/dispatch-orders` — CRUD with date filtering
- `/production-plans/:id/dough-prep` — GET: dough breakdown, mix schedule, ball weights
- `/production-plans/:id/packing` — GET: adjusted pack counts + dispatch cross-reference
- `/production-plans/:id/ingredient-requirements?station=` — GET: full ingredient breakdown for a plan with recursive sub-recipe explosion. Returns per-ingredient totals (cooked/raw qty with processing ratio) and per-recipe breakdown. Station filter: prep_veg, prep_bases, prep_meat, all (default).
- `/production-plans/:id/items/:itemId/wonly` — POST: increment wonky; DELETE: decrement wonky
- `/production-plans/next-active` — GET: next weekday with active plan (used by prep/dough-prep stations)
- `/app-settings/:key` — GET/PUT admin-only global settings (mixer_capacity_kg)

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`.

## Station Features (9-station workflow)

The station page (`/station`) provides a full-screen view with:
- **Mixing & Cooking** — DnD reordering of recipe queue (pending items only; admin can reorder any); batch +/− counters; break tracker; EOD summary with avg mins/batch
- **Building Line 1 & 2** — show fill weight, base type, base weight chips from recipe; batch counters; EOD summary; SOP button on recipe header (opens sopUrl in new tab)
- **Prep Hub** (stationType="prep") — 3-tile sub-station picker: Raw Veg, Bases & Mozzarella, Raw Meat. Shows "Prep for [Day], [Date]" banner using next active plan lookup.
  - **Raw Veg** (prep_veg) — fetches prep requirements for the next active plan; full-screen one-item-at-a-time mode with Done→Next + overview list toggle
  - **Bases & Mozzarella** (prep_bases) — per-recipe tin counts (green badge), full-screen + overview modes
  - **Raw Meat** (prep_meat) — per-ingredient tray counts with per-tray kg breakdown, full-screen (rose badge) + overview modes
- **Dough Prep** (dough_prep) — fetches `/api/production-plans/:id/dough-prep`; shows total dough kg, mixer capacity (from `app_settings`), number of mixes, per-ingredient breakdown (Flour/Water/Oil/Salt/Yeast) per mix, dough ball weights per recipe, batch counters
- **Dough Sheeting** (dough_sheeting) — shows ordered sheeting queue with ball weight (from dough sub-recipe) and per-item "Ready" checkbox toggle
- **Ovens** (ovens) — batch counters using per-station oven counts + cascade indicator showing "Built: X" from building; Wonky button; session totals: gross packs, total wonky, net packs; blast chiller tray count (`ceil(netPacks/10)`); per-recipe table with snowflake icon column
- **Wrapping** (wrapping) — per-recipe pack counts (gross/net from oven stationCompletions); 2 storage locations: Production Fridge (`fridgeQty`), Product Freezer (`freezerQty`); tabbed storage controls with "Add 24" quick-add + custom + undo per location; wrapping-complete toggle per recipe
- **Packing** (packing) — fetches `/api/production-plans/:id/packing`; per-recipe cards with net packs + dispatch order cross-reference (surplus/short indicator); packed checkbox toggle; session gross/wonky/net pack totals
- **Next-plan lookup**: `GET /api/production-plans/next-active` endpoint — finds next weekday (Mon-Fri) with `status='active'` within 7 days from **tomorrow** (i=1, not today). Used by PrepHub and DoughPrepStation to display "Prep for [Day], [Date]" on tiles and banners.

Recipe fields added for station cards: `fill_weight_grams`, `base_type`, `base_weight_grams`, `sop_url`.

## Station Cascade System

Stations enforce a cascade: downstream stations can only complete as many batches as the upstream station has done.
- **Dependencies**: mixing → building_1/building_2 → ovens → wrapping
- **API**: `stationCompletions` map returned per plan item (e.g., `{ mixing: 5, building_1: 3, ovens: 2 }`)
- **Validation**: POST batch completion returns 409 if previous station hasn't completed enough
- **UI helpers**: `getStationCount(item, stationType)`, `getPrevStationCount(item, stationType)`, `getAvailableFromPrev(item, stationType)` in station.tsx
- **Storage**: `production_plan_items` has `fridge_qty`, `freezer_qty`, `prep_fridge_qty` columns with POST/DELETE endpoints for each

## Ingredient Resolver

`artifacts/api-server/src/lib/ingredient-resolver.ts` — Shared utility for recursively resolving all raw ingredients for a recipe, including through sub-recipes and nested sub-recipes. Used by `prep-requirements`, `prep-requirements-by-recipe`, and `ingredient-requirements` endpoints. Uses path-based cycle detection (not global dedup) so the same sub-recipe appearing in multiple sibling branches is correctly counted. Scaling: `quantity_used / sub_recipe_yield` at each nesting level.

## Codegen Critical Notes

- **After every `cd lib/api-spec && npm run codegen`**: rewrite `lib/api-zod/src/index.ts` to ONLY `export * from "./generated/api";` (codegen always adds extra lines causing TS2308 duplicate export errors), then rebuild declarations with `cd lib/api-client-react && npx tsc -p tsconfig.json`
- Orval config (`lib/api-spec/orval.config.ts`) has no `schemas` option to avoid generating a `types/` directory

## Key Commands

- `pnpm --filter @workspace/api-spec run codegen` — regenerate API client from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes
- `pnpm --filter @workspace/api-server run dev` — start API server
- `pnpm --filter @workspace/production-planner run dev` — start frontend dev server
