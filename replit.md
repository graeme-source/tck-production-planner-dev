# Overview

The Food Production Planner is a full-stack monorepo application designed to streamline production management for food businesses. Its primary purpose is to provide a comprehensive system for managing ingredients, recipes, production plans, stock inventory, and sales data. The application aims to optimize food production workflows, improve cost management, track profitability, and enhance operational efficiency for food businesses.

Key capabilities include:
- **Recipe Management:** Detailed tracking of ingredients, sub-recipes, and final products with a full cost/margin engine.
- **Production Planning:** Dynamic daily production plans, calculating deficits based on Shopify sales, and suggesting batch allocations.
- **Inventory Management:** Stock checks for finished recipes, raw ingredients, and non-food supplies.
- **Sales & Dispatch:** Logging sales data and managing upcoming dispatch orders.
- **Operational Stations:** A 9-station workflow system (Mixing, Building, Prep Hub, Dough Prep, Ovens, Wrapping, Packing) with cascading completion logic to guide production.
- **Reporting & Settings:** Dashboard overview, user management, category cost defaults, and production target settings.

The project envisions empowering food businesses with a robust, integrated platform to manage their entire production lifecycle, from raw materials to final dispatch, with a focus on profitability and efficiency.

# User Preferences

I prefer iterative development. Before making any major changes, please ask. I like detailed explanations for complex logic. Do not make changes to files outside of `artifacts/api-server` and `artifacts/production-planner` unless explicitly requested, or for shared utility functions in `lib/`.

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

**Backend (API Server):**
- **Framework:** Express 5
- **Database:** PostgreSQL with Drizzle ORM
- **Validation:** Zod (`zod/v4`), `drizzle-zod`
- **Authentication:** Session-based using `express-session` and `connect-pg-simple`.
- **Core Features:**
    - **Cost/Margin Engine:** Recipes include pack size, RRP, packaging cost, labour cost, and a gross margin calculation with color-coded profitability.
    - **Production Plan Calculator:** Implements a 3-weekday-dispatch model, fetching Shopify sales, calculating deficits, and allocating batches using the Largest Remainder Method.
    - **Ingredient Resolution:** A utility (`ingredient-resolver.ts`) for recursively resolving all raw ingredients for a recipe, handling sub-recipes and scaling.
    - **Station Cascade System:** Enforces a production flow where downstream stations can only complete items that have been completed by upstream stations. API validation prevents out-of-order completions.
    - **API Routes:** Comprehensive RESTful API for CRUD operations across all entities (ingredients, recipes, production plans, stock, sales, dispatch) and specialized endpoints for station-specific data (e.g., dough prep, packing, ingredient requirements).
    - **Settings:** Global application settings managed via key-value store in `app_settings` table.

**Shared Components (`lib/`):**
- **API Specification:** OpenAPI spec for consistent API design.
- **Code Generation:** Orval is used to generate React Query hooks (`api-client-react`) and Zod schemas (`api-zod`) from the OpenAPI spec.
- **Database Schema:** Drizzle ORM schema definitions and database connection logic.

**Monorepo Structure:**
- `artifacts/`: Deployable applications (`api-server`, `production-planner`).
- `lib/`: Shared libraries (`api-spec`, `api-client-react`, `api-zod`, `db`).
- `scripts/`: Utility scripts.

# External Dependencies

- **Database:** PostgreSQL
- **ORMs:** Drizzle ORM
- **Authentication Libraries:** `express-session`, `connect-pg-simple`
- **Validation Library:** Zod
- **API Code Generation:** Orval
- **Frontend Frameworks/Libraries:** React, Vite, Tailwind CSS, shadcn/ui, React Query, react-hook-form, recharts, date-fns, framer-motion
- **Sales Data Integration:** Shopify (for fetching sales data for production planning)