# Staging environment — setup guide

This walks you through creating a Railway staging environment alongside
the existing live (production) Railway deployment. Code-side
scaffolding is already done and merged into `master`. You just need to
do the Railway dashboard clicks + one git branch push.

Total elapsed time: **15–25 minutes** of your clicking, plus DNS
propagation you don't have to watch.

## What you'll end up with

- **Production**: current Railway service, current URL, current database,
  `APP_ENV=production`. **No change for your staff — same bookmark,
  same login.**
- **Staging**: new Railway service on a separate Railway-provided URL
  (something like `tck-planner-staging-production.up.railway.app`), its
  own Postgres, seeded from a snapshot of production. `APP_ENV=staging`.
  Shows a red "STAGING ENVIRONMENT" banner. Shopify writes, emails and
  fulfilments are no-ops.
- **Deploy flow**: push to `staging` branch → Railway auto-deploys
  staging. Merge `staging` → `master` → Railway auto-deploys production.

---

## Step 1 — create the staging environment in Railway (5 min)

1. Open the Railway dashboard, click into the project that contains
   your current live service.
2. Top-right, find the environment selector (probably says
   "production"). Click it → "New Environment".
3. Name it **`staging`**. Railway will ask whether to clone from
   production — **yes, clone**. That copies the service config, env
   vars, and build settings.
4. Important: the cloned environment will also point at the *same*
   Postgres by default. We need to fix that next.

## Step 2 — give staging its own database (5 min)

1. In the new `staging` environment, click the Postgres service.
2. Either:
   - **Easiest:** click "Add Service" → "Database" → "PostgreSQL". A
     fresh empty Postgres is created, scoped to the staging
     environment only. Copy its new `DATABASE_URL`.
   - **Or:** reuse an existing Postgres instance but on a different
     database name. Slightly cheaper but more fiddly.
3. In the staging api-server service's Variables tab, update
   `DATABASE_URL` to point at the new staging Postgres. Railway
   injects the internal URL automatically if you right-click the
   variable → "Reference" → pick the new Postgres service.
4. **Do NOT redeploy yet.** The database is empty — we'll seed it in
   step 4.

## Step 3 — set staging-only env vars (2 min)

In the staging environment's api-server service → Variables tab, set:

| Variable | Value |
|---|---|
| `APP_ENV` | `staging` |
| `ALLOWED_ORIGIN` | the new staging frontend URL (you'll know it after first deploy — come back and set this) |
| `SESSION_SECRET` | a **different** random value than production (so staging sessions can't be used on production and vice versa) |

Leave everything else as cloned from production: `SHOPIFY_*`, `KLAVIYO_API_KEY`,
etc. The app-env side-effect guard will stop those from firing anyway,
and having the real credentials means you can read real Shopify data on
staging even though writes are blocked.

Also set the same `APP_ENV=staging` on the **frontend** Railway
service for staging, if your frontend is a separate service (it
probably is, given how the repo is split into `artifacts/api-server`
and `artifacts/production-planner`).

## Step 4 — seed staging Postgres from a production snapshot (5 min)

On your local machine, with both `DATABASE_URL`s handy:

```bash
# From production Railway Postgres:
pg_dump "$PRODUCTION_DATABASE_URL" \
  --no-owner --no-acl \
  --file prod-snapshot.sql

# Into staging Railway Postgres:
psql "$STAGING_DATABASE_URL" < prod-snapshot.sql
```

Or if you prefer clicks, Railway has a "Restore from snapshot"
feature — production Postgres → snapshots tab → pick the most recent
one → restore to the staging Postgres service.

After this, staging has a point-in-time copy of production. Any writes
in staging only affect the staging DB; production is untouched.

**Rotate this monthly-ish.** Add it to your memory as a recurring
task: "every month, re-seed staging from production so it doesn't
drift too far". Not critical, just nice-to-have.

## Step 5 — wire up git branches and auto-deploy (5 min)

You already auto-deploy production from `master`. Now do the same for
staging:

1. In the staging environment, click the api-server service →
   Settings → Source → Branch: change from `master` to `staging`.
2. Do the same for the frontend service in the staging environment.
3. Locally:
   ```bash
   git checkout master
   git pull origin master
   git checkout -b staging
   git push -u origin staging
   ```
4. Railway should detect the new branch and trigger a first staging
   deploy. Watch the logs — you should see:
   ```
   [backup] staging: scheduler disabled
   [fulfilment-poller] staging: skipping scheduler start
   ```
   That confirms the env var is wired correctly.
5. Grab the frontend staging URL from Railway (e.g.
   `tck-planner-staging-production-abc123.up.railway.app`), and go
   back to Step 3 to set `ALLOWED_ORIGIN` on the staging api-server to
   that URL.

## Step 6 — smoke test staging (5 min)

1. Open the staging frontend URL in a browser.
2. You should see the big red "STAGING ENVIRONMENT" banner at the
   top of every page. If not, either `APP_ENV` isn't set or the
   frontend didn't rebuild — check Railway deploy logs.
3. Log in as yourself (same credentials as production because the
   DB was cloned).
4. Do something visible: create a plan, tick a tin, click activate.
   Everything should work.
5. **The critical check:** verify Shopify didn't get touched. Open
   your Shopify admin and confirm no unexpected fulfilment emails or
   inventory changes. Then check the staging Railway logs for lines
   like `[staging] SKIPPED shopify.adjustInventoryLevel` — if you see
   them, the guard is working.

## How to use staging going forward

Day-to-day development:

1. **Small/obvious change?** Merge straight to `master` as before. The
   risk is low enough that staging is overkill.
2. **Bigger change / touches Shopify / touches factory number?** Push
   to `staging` first. Open the staging frontend, click around for a
   minute, then merge `staging` → `master` to promote.
3. **Risky migrations / schema changes?** Always via staging. This is
   where staging earns its keep — a failed drizzle migration on
   staging is free; on production, it's a lost shift.

Command to promote a staging deploy to production:

```bash
git checkout master
git merge staging
git push origin master
```

Railway production auto-deploys in ~2 minutes.

## Cost

Railway charges per environment. Expect roughly **double your current
Railway bill**, since you'll be running two api-server + two
Postgres + two frontend services. Railway has a $5/mo starter tier
per service, so realistically +$15–30/mo. You can pause the staging
environment when not in use (Railway → environment → pause) and
unpause when you need it.

## Rolling back the setup

If you decide staging isn't worth it, just delete the staging
environment in Railway. All the code changes (`APP_ENV`,
`StagingEnvBanner`, the side-effect guards) stay harmless — they
default to `development` / `production` behaviour and cost nothing
when `APP_ENV=staging` is never set.

---

## What the code-side scaffolding does (already merged)

For reference, the scaffolding I wrote:

- **`artifacts/api-server/src/lib/app-env.ts`** — reads `APP_ENV`,
  exposes `isStaging()` / `shouldSkipSideEffect()`.
- **`artifacts/api-server/src/routes/health.ts`** — adds
  `GET /api/env` returning `{ appEnv: "production" | "staging" | "development" }`.
  Unauthenticated so the frontend banner can read it before login.
- **`artifacts/api-server/src/services/shopify.ts`** — `fulfillOrder`
  and `adjustInventoryLevel` early-return with a log line on staging.
- **`artifacts/api-server/src/lib/email.ts`** — `sendEmail` logs-and-skips
  on staging instead of hitting Klaviyo/Resend.
- **`artifacts/api-server/src/lib/backup.ts`** — backup scheduler
  skipped on staging (avoids clobbering production's backup bucket).
- **`artifacts/api-server/src/lib/fulfilment-poller.ts`** —
  fulfilment poller skipped on staging (avoids burning Shopify API
  quota on no-op work).
- **`artifacts/production-planner/src/components/staging-env-banner.tsx`**
  — red "STAGING ENVIRONMENT" banner, fetches `/api/env` on mount,
  renders only when `appEnv === "staging"`.
- **`artifacts/production-planner/src/App.tsx`** — mounts the banner
  above `NetworkStatusBanner`.

All of this defaults to production behaviour when `APP_ENV` is unset or
set to anything other than `staging`. So it's zero-risk to merge into
`master` before the Railway setup is done.
