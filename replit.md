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
- **Settings** — user management (admin/manager/viewer roles) + category cost defaults (packaging & labour auto-fill per category)
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

## API Routes

All routes under `/api/`:
- `/ingredients` — CRUD
- `/sub-recipes` — CRUD with nested ingredients
- `/recipes` — CRUD with nested ingredients + sub-recipes
- `/production-plans` — CRUD with nested items
- `/stock-entries` — CRUD
- `/sales-entries` — CRUD with date filtering
- `/dispatch-orders` — CRUD with date filtering

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`.

## Key Commands

- `pnpm --filter @workspace/api-spec run codegen` — regenerate API client from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes
- `pnpm --filter @workspace/api-server run dev` — start API server
- `pnpm --filter @workspace/production-planner run dev` — start frontend dev server
