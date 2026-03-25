# TCK Production Database Migration Guide

This document explains how to seed a fresh production database with the reference/config data from the development environment.

> **!! IMPORTANT !!**
> The seed file uses `TRUNCATE … CASCADE`. It is designed for a **freshly-provisioned production database** that contains no live operational data.
> Do **not** apply it to a database that already holds production plans, purchase orders, or dispatch records — CASCADE will wipe those tables.

---

## What is seeded?

| Table | Contents |
|---|---|
| `suppliers` | All supplier records |
| `storage_locations` | System storage locations (fridge, freezer, dry store, etc.) |
| `storage_racks` | Racks within each storage location |
| `stock_item_categories` | Packaging, Cleaning Materials, Chemicals |
| `category_defaults` | Default packaging/labour costs per recipe category |
| `timing_standards` | Station batches-per-hour targets |
| `app_settings` | App-level settings (e.g. `apc_test_mode`) |
| `page_permissions` | Role-based page access controls |
| `postcode_validations` | Cached APC postcode validation results |
| `sku_locations` | Shopify SKU → storage zone mappings |
| `ingredients` | All ingredients |
| `sub_recipes` | Sub-recipes (sauces, doughs, etc.) |
| `sub_recipe_ingredients` | Ingredients within sub-recipes |
| `sub_recipe_sub_recipes` | Sub-recipe nesting |
| `recipes` | All product recipes |
| `recipe_ingredients` | Ingredient quantities per recipe |
| `recipe_sub_recipes` | Sub-recipe usage per recipe |
| `recipe_meat_marinades` | Marinade configurations per recipe |
| `recipe_shopify_mappings` | Recipe → Shopify variant mappings |
| `stock_items` | Non-ingredient stock items (packaging, cleaning supplies) |
| `dpt_settings` | Daily production targets per recipe |
| `delivery_check_configs` | Supplier-specific delivery checklist items |
| `kanban_items` | Kanban pull cards |
| `ingredient_storage_locations` | Ingredient bin locations |

**Not seeded** (kept separate per environment):
- `app_users` — user accounts (the server auto-creates the default admin)
- `production_plans` / `production_plan_items` — daily production data
- `stock_entries` / `stock_transfers` — live stock counts
- `dispatch_orders` / `sales` — order history
- `purchase_orders` / `delivery_records` — procurement history

---

## Step 1 — Generate the seed file

Run this on the **development** machine/environment to capture the latest state:

```bash
pnpm --filter @workspace/api-server run export-seed
```

Output: `artifacts/api-server/scripts/prod-seed.sql`

Re-run whenever you want to capture the latest dev reference data.

---

## Step 2 — Apply the seed to production

### Option A — Direct `psql` (recommended, fastest)

Obtain the production `DATABASE_URL` from the deployment environment's Secrets tab, then run:

```bash
psql "$PRODUCTION_DATABASE_URL" < artifacts/api-server/scripts/prod-seed.sql
```

### Option B — Admin API endpoint (`MIGRATION_TOKEN`)

The API exposes `POST /api/admin/apply-seed`.  
It is authenticated via a `MIGRATION_TOKEN` secret — **no browser session is required**.

#### 2B-1: Set the secret

In the production deployment environment, add the secret:

```
MIGRATION_TOKEN = <a strong random string you choose>
```

If `MIGRATION_TOKEN` is not set, the endpoint returns `404` (disabled).

#### 2B-2: Apply the seed

```bash
export MIGRATION_TOKEN=your-secret-value
export PROD_API=https://YOUR_PRODUCTION_API_URL

curl -X POST "$PROD_API/api/admin/apply-seed" \
     -H "Authorization: Bearer $MIGRATION_TOKEN"
```

On success:
```json
{ "ok": true, "message": "Seed applied successfully." }
```

On failure (the transaction is automatically rolled back):
```json
{ "error": "Seed failed — transaction rolled back", "detail": "..." }
```

---

## Step 3 — Verify

After applying the seed:

1. Log in with the default admin account:
   - **Email**: `admin@thecalzonekitchen.co.uk`
   - **Password**: `TCKAdmin2024!`
   - *(The server auto-creates this account if the `app_users` table is empty)*
2. Navigate to **Recipes**, **Ingredients**, and **Suppliers** — all dev data should be present.
3. Create a test production plan to confirm the recipes load correctly.
4. **Change the default admin password immediately.**

---

## Updating production after dev changes

When you add or update recipes/ingredients/etc. in dev:

1. Re-run the export: `pnpm --filter @workspace/api-server run export-seed`
2. Commit `scripts/prod-seed.sql`
3. Re-apply via psql or the API endpoint

Because the file uses `TRUNCATE … CASCADE`, re-applying on a DB that already has production plan data will **wipe that data**. For incremental updates to a live prod DB, apply individual SQL changes manually instead.
