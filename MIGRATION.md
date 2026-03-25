# TCK Production Database Migration Guide

This document explains how to seed a fresh production database with the reference/config data from the development environment.

## What is seeded?

The `prod-seed.sql` file contains all **reference and configuration data** — the tables you set up in dev that the app needs to function. Specifically:

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
- `app_users` — user accounts are created fresh in prod
- `production_plans` / `production_plan_items` — daily production data
- `stock_entries` / `stock_transfers` — live stock counts
- `dispatch_orders` / `sales` — order history
- `purchase_orders` / `delivery_records` — procurement history

---

## Step 1 — Generate the seed file

Run this on the **development** machine/environment:

```bash
pnpm --filter @workspace/api-server run export-seed
```

This writes `artifacts/api-server/scripts/prod-seed.sql`.

Re-run whenever you want to capture the latest dev state.

---

## Step 2 — Apply the seed to production

### Option A — Direct `psql` (recommended, fastest)

```bash
psql $PRODUCTION_DATABASE_URL < artifacts/api-server/scripts/prod-seed.sql
```

If you need to obtain `PRODUCTION_DATABASE_URL`:
1. Open the Replit deployment environment
2. Check the **Secrets** tab for `DATABASE_URL` (the production value)

### Option B — Admin API endpoint

The API exposes `POST /api/admin/apply-seed`, which requires an active **admin** session.

```bash
# 1. Obtain your admin session cookie (log in via the app first)
# 2. POST the SQL file:
curl -X POST https://YOUR_PRODUCTION_API_URL/api/admin/apply-seed \
     -H 'Content-Type: text/plain' \
     --data-binary @artifacts/api-server/scripts/prod-seed.sql \
     -b 'connect.sid=YOUR_SESSION_COOKIE_VALUE'
```

On success you'll receive:
```json
{ "ok": true, "message": "Seed applied successfully." }
```

---

## Step 3 — Verify

After applying the seed:

1. Log in to the production app with the default admin account:
   - Email: `admin@thecalzonekitchen.co.uk`
   - Password: `TCKAdmin2024!`
   - *(The server auto-creates this if no users exist)*
2. Navigate to **Recipes**, **Ingredients**, and **Suppliers** — all dev data should be present.
3. Create a test production plan to confirm the recipes load correctly.
4. **Change the default admin password immediately.**

---

## Notes

- The seed uses `ON CONFLICT … DO UPDATE` — it is **idempotent** and safe to re-run.
- Sequences are reset after all inserts, so new rows created in prod won't collide with seeded IDs.
- If you add or update recipes/ingredients/etc. in dev, re-export and re-apply to sync prod.
- The `storage_locations` system locations (Prep Fridge, Raw Meat Fridge, etc.) are also seeded by the server's startup migration — applying the seed is not required for those, but it won't cause conflicts if both run.
