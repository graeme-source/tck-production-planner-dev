# Overview

The Food Production Planner is a full-stack monorepo application designed to streamline production management for food businesses. Its primary purpose is to provide a comprehensive system for managing ingredients, recipes, production plans, stock inventory, and sales data. The application aims to optimize food production workflows, improve cost management, track profitability, and enhance operational efficiency for food businesses.

Key capabilities include:
- **Recipe Management:** Detailed tracking of ingredients, sub-recipes, and final products with a full cost/margin engine.
- **Production Planning:** Dynamic daily production plans, calculating deficits based on Shopify sales, and suggesting batch allocations.
- **Order Calculation & Supplier Forms:** Automated calculation of order requirements based on production plans, stock levels, and DPT-based surplus targets, with a workflow for placing and tracking purchase orders.
- **Deliveries & Goods In:** A weekly calendar for tracking expected deliveries, with a receiving workflow that includes temperature checks, use-by date tracking, and quality control checklists.
- **Inventory Management:** Unified `/inventory` page with "Ingredients" (perishable=true) and "Supplies" (perishable=false) tabs. Both live in the `ingredients` table with `perishable boolean` and `palletSize integer` columns. Smart form auto-switches fields by type (perishable-only: processing ratio, shelf life, cooking temps; supply-only: pallet size).
- **Sales & Dispatch:** Logging sales data and managing upcoming dispatch orders.
- **Operational Stations:** A 9-station workflow system (Mixing, Building, Prep Hub, Dough Prep, Ovens, Wrapping, Packing) with cascading completion logic to guide production.
- **Reporting & Settings:** Dashboard overview, user management, category cost defaults, and production target settings.
- **Improvements System (Kaizen):** A Kaizen-style improvement tracking system. Team members submit ideas via a persistent floating "Report" button (visible on all pages). Managers can manage submissions (tier, status, notes) in the Analytics → Improvements tab. A link card on the Lean Cave page directs users to the report.
- **Andon Issue Reporting:** Real-time issue alerting. Team members flag equipment/safety/production/product issues with yellow (minor) or red (serious) severity. Station headers show traffic-light badges. The Dashboard shows a banner for unacknowledged issues. Analytics → Andon Log shows all issues with filter/acknowledge/resolve controls.

The project envisions empowering food businesses with a robust, integrated platform to manage their entire production lifecycle, from raw materials to final dispatch, with a focus on profitability and efficiency.

# User Preferences

I prefer iterative development. Before making any major changes, please ask. I like detailed explanations for complex logic. Do not make changes to files outside of `artifacts/api-server` and `artifacts/production-planner` unless explicitly requested, or for shared utility functions in `lib/`. Do not make changes to the folder `lib/api-spec`. Do not make changes to the file `lib/api-zod/src/index.ts`.

# System Architecture

The application is structured as a pnpm workspace monorepo using TypeScript, comprising an Express.js API server and a React+Vite frontend.

**Frontend (Production Planner):**
- **Frameworks:** React, Vite
- **Styling:** Tailwind CSS, shadcn/ui
- **State Management & Data Fetching:** React Query, react-hook-form
- **UI Components:** recharts, date-fns, framer-motion
- **UI/UX Decisions:**
    - **Color Scheme (TCK Brand):** Yellow (`#ffbe23`), Light Cream (`#fffdf0`), Green Primary (`#919b5f`), Black (`#231f20`), Rosemary (`#3b4317`), Champagne Gold (`#d6c38c`). Green is mapped to `--primary` CSS variable for Tailwind utility classes.
    - **Station Features:** Full-screen views for each of the 9 production stations, designed for shop floor use. Features like DnD reordering, batch counters, break trackers, filling mix displays with checklists, SOP buttons, and progress bars are integrated.
    - **Prep Hub:** Sub-station picker for Main Prep, Bases & Mozzarella, and Raw Meat, with specific UIs for ingredient grouping, tin tracking, and stock checks.
    - **Bottled Items:** Ingredients can be flagged as `isBottle=true` with an optional `bottleSize` (in the ingredient's unit). The prep station calculates bottles needed as `ceil(totalQty / bottleSize)`, displays an amber "Bottles Required" card instead of the tin grid, and uses a single "Mark Bottles as Collected" button for completion. Falls back to `packWeight` if no `bottleSize` is set.

**Backend (API Server):**
- **Framework:** Express 5
- **Database:** PostgreSQL with Drizzle ORM
- **Validation:** Zod (`zod/v4`), `drizzle-zod`
- **Authentication:** Session-based using `express-session` and `connect-pg-simple`.
- **Core Features:**
    - **Cost/Margin Engine:** Recipes include pack size, RRP, packaging cost, labour cost, and a gross margin calculation with color-coded profitability (≥60% green, 50-59% amber, <50% red).
    - **Production Plan Calculator:** Implements a 3-weekday-dispatch model, fetching Shopify sales, calculating deficits, and allocating batches using the Largest Remainder Method.
    - **Order Engine:** Calculates requirements for each supplier based on production plans, stock levels, DPT-based surplus targets, and kanban pulls.
    - **QR Code Infrastructure:** Auto-generates QR codes (PNG) for ingredients on creation and stores them in object storage (`{PRIVATE_OBJECT_DIR}/qr-codes/`). QR codes encode JSON payloads with `{ type, id }`. Kanban items support polymorphic sources (ingredient, recipe, sub_recipe) via `source_type`, `recipe_id`, `sub_recipe_id` columns. Endpoints: `POST /api/ingredients/backfill-qr` (backfill existing), `POST /api/recipes/:id/create-kanban`, `POST /api/sub-recipes/:id/create-kanban`, `GET /api/qr/:sourceType/:id` (retrieve QR image). DB uniqueness enforced via partial unique indexes on `kanban_items`.
    - **Goods In Workflow:** Specific receiving logic for purchase orders, including temperature logs, configurable quality checks, and use-by date recording for stock entries.
    - **Ingredient Resolution:** A utility (`ingredient-resolver.ts`) for recursively resolving all raw ingredients for a recipe, handling sub-recipes and scaling, with cycle detection.
    - **Station Cascade System:** Enforces a production flow where downstream stations can only complete items that have been completed by upstream stations. API validation prevents out-of-order completions (409 Conflict).
    - **Marinade System:** Flexible assignment of marinades/seasonings to raw meat ingredients within recipes, ensuring accurate cost accounting.
    - **API Routes:** Comprehensive RESTful API for CRUD operations across all entities (ingredients, recipes, production plans, stock, sales, dispatch, orders, deliveries) and specialized endpoints for station-specific data.
    - **Nutritionals & Labelling:** Ingredients store per-100g nutritional data (energy kJ/kcal, fat, saturates, carbohydrate, sugars, protein, salt), label declarations, and UK14 allergen tags. Recipe endpoints calculate aggregate nutritionals per 100g and per portion with cooking loss adjustment. Ingredient deck generation produces ordered ingredient lists with allergen bolding in `**bold**` markdown format.
    - **Product Hub:** Centralized page (`/product-hub`) with tabs for Ingredient Decks, Nutritionals, and Labels (placeholder). Includes a global "may contain" statement editor stored in `app_settings`. Accessible under the Product navigation group.
    - **Settings:** Global application settings managed via key-value store in `app_settings` table.

**Shared Components (`lib/`):**
- **API Specification:** OpenAPI spec for consistent API design.
- **Code Generation:** Orval is used to generate React Query hooks (`api-client-react`) and Zod schemas (`api-zod`) from the OpenAPI spec.
- **Database Schema:** Drizzle ORM schema definitions and database connection logic.
- **Object Storage:** `lib/object-storage-web` provides GCS-backed file upload utilities (Uppy-based).

**Monorepo Structure:**
- `artifacts/`: Deployable applications (`api-server`, `production-planner`).
- `lib/`: Shared libraries (`api-spec`, `api-client-react`, `api-zod`, `db`, `object-storage-web`).
- `scripts/`: Utility scripts (kanban import, production push, GitHub sync, nutritional population).

**Scripts:**
- `pnpm --filter @workspace/scripts run import-kanbans` — Dry-run kanban Excel import (reads `attached_assets/kanbans-*.xlsx`, classifies items as ingredients or stock_items, normalises suppliers).
- `pnpm --filter @workspace/scripts run import-kanbans:commit` — Commit mode (writes to DB within a transaction).
- `pnpm --filter @workspace/scripts run push-kanban-import` — Production push wrapper (runs migration, dry-run report, then commit with confirmation).
- `pnpm --filter @workspace/scripts run push-kanban-import:prod` — Same with `--production` flag for explicit production targeting.

# Authentication & User Features

## Quick-Switch Login / PIN Authentication
- **Login page** has two modes: "picker" (card grid for known device users) and "credential" (email/password form)
- Device user IDs stored in `localStorage` under key `"tck_device_user_ids"` - never credentials
- After email/password login, user ID is auto-added to localStorage
- If user has no PIN after first login, a PIN setup modal is shown before reaching the app
- **PIN numpad component** (`/src/components/pin-numpad.tsx`): 4-dot indicator, 3-column digit grid, auto-submits on 4th digit
- **PIN APIs**: `POST /api/auth/pin/set` (set/change), `POST /api/auth/pin/login` (verify), `GET /api/auth/devices/users?ids[]=N` (fetch device user profiles)
- Rate limiting: 5 failed PIN attempts triggers 15-minute lockout (stored in `pin_attempts`, `pin_locked_until` DB columns)

## User Avatars
- Users can upload a profile photo via the Settings page Profile & Avatar section
- Avatar stored in GCS object storage (`PRIVATE_OBJECT_DIR/avatars/`)
- `GET /api/storage/objects/*path` serves objects; `POST /api/auth/avatar` accepts multipart upload
- **UserAvatar component** (`/src/components/user-avatar.tsx`): shows image or colored initial fallback with consistent hash-based colors
- Avatar shown in: sidebar account button, login picker cards, settings profile section

## Sidebar Account Button
- Bottom-left of sidebar shows `UserAvatar` + user name + role + chevron
- Clicking opens a popup menu (framer-motion animated) with: Profile & Avatar, Change PIN, Sign out
- Links navigate to `/settings?tab=profile` and `/settings?tab=pin` which scroll to respective sections

# External Dependencies

- **Node.js:** Version 24
- **Package Manager:** pnpm
- **TypeScript:** Version 5.9
- **Database:** PostgreSQL
- **ORMs:** Drizzle ORM
- **Authentication Libraries:** `express-session`, `connect-pg-simple`, `bcryptjs`
- **File Upload:** `multer` (API server), `@google-cloud/storage` (GCS object storage)
- **Validation Library:** Zod with `drizzle-zod` integration
- **API Code Generation:** Orval
- **Frontend Frameworks/Libraries:** React, Vite, Tailwind CSS, shadcn/ui, React Query, react-hook-form, recharts, date-fns, framer-motion
- **Sales Data Integration:** Shopify (for fetching sales data for production planning)


# Code Backup — GitHub

All code is mirrored to a **private GitHub repository**:
- **Repo:** `https://github.com/graeme-source/tck-production-planner` (private)
- **Account:** `graeme-source`
- **Connected via:** Replit GitHub integration (OAuth, no PAT required)

## Syncing code to GitHub

Run the following from the workspace root whenever you want to push the latest code:

```bash
pnpm github:sync
```

This uses `scripts/github-sync.mjs` which:
1. Reads all git-tracked files (381+)
2. Creates blobs and a new tree via GitHub's Git Data API
3. Creates a timestamped commit on `main`
4. Updates the branch ref

Run this manually after any significant batch of changes. The sync takes ~60 seconds.

## Recovery

If the Replit project is lost, the entire codebase can be restored from GitHub. The database would need restoring separately from a production backup or pg_dump.
