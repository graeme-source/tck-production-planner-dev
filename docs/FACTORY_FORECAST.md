# Factory number forecast — how it works and how accurate it is

**Added:** 15 Oct 2026 (Graeme). **Serves:** Objective C (never run out, nothing goes
out of date) and B (stock driven by sales data).

## What it answers

"If we make this plan, how many packs of calzone will be in the fridge at the end of
the plan day — once the orders that haven't come in yet have come in?"

The plan screens used to do the sum with **known orders only**. But a plan made on
Thursday for Monday still has Friday, the weekend and Monday until 2pm for people to
order for Monday's despatch. Those late orders are what this forecast adds.

Calzones only. Mac cheese and fried chicken are kept out.

## The rule

For each despatch whose orders already come out of the screen's stock figures before
the plan day ends (today's, the day before the plan day, and the plan day's own):

> **late packs = share still to come × a typical day + email adjustment**

- **Share still to come** — looking at the same delivery weekday over the last 26 weeks:
  of all the packs those days finally had, what share arrived in the last *h* hours
  before their 2pm despatch cut-off, where *h* is the hours left right now. The weekday
  matters: a Tuesday's last 96 hours include the whole weekend.
- **A typical day** — the average final packs of the last 4 delivery days on that
  weekday (the recent run-rate).
- **Email adjustment** — +20 packs for each email due before the cut-off beyond the
  number normally sent in that many hours (and −20 for each one fewer). Emails come from
  Klaviyo (sent and scheduled) plus anything planned on the email plan not yet in
  Klaviyo.

The packs already ordered for the day do **not** drive the late figure — scaling from
them was less accurate on the backtest (a slow-booking day still gets the usual late
rush).

Then, per recipe:

> **end of plan day = stock at plan start + made − 8-pack bags − the day's known orders − its share of the late packs**

(never below zero). Late packs are split by each recipe's share of the last 7 days'
sales — measured as the best of the simple rules (last 7 days 32% misallocation, last
28 days 35%, the day's own known mix 39%).

The 80% range comes from how far the same rule missed on each past day.

The curve is re-fitted from the Shopify orders cache every time the screen asks
(orders cached 15 minutes), so it always reflects the latest 26 weeks — no scheduled
job, nothing to refresh by hand.

## What we measured (130 delivery days, mid-Apr to mid-Oct 2026)

Share of a delivery day's final packs still to come, by hours before its cut-off:

| Delivery day | 24 h | 48 h | 72 h | 96 h |
|---|---|---|---|---|
| Tuesday (weekend before it) | 11% | 23% | 37% | 50% |
| Wednesday | 18% | 34% | 40% | 48% |
| Thursday | 23% | 36% | 45% | 51% |
| Friday | 19% | 34% | 43% | 51% |
| Saturday | 34% | 48% | 59% | 65% |
| **All** | **20%** | **34%** | **44%** | **52%** |

Almost nothing (0.1%) arrives after the cut-off. Plans are normally made at about
2:30pm two working days ahead, so a typical plan still has ~260 packs of late orders
to come across its despatches (Monday and Tuesday plans ~320–350, because of the
weekend).

**Emails:** each Klaviyo email brings ~120 extra calzone packs over the next 24 hours
across all delivery days (main list ~115, segments ~155). The share that lands on the
days a plan covers, beyond the usual ~2 emails in that window, fitted best at ~20
packs per extra email.

## Accuracy (backtest on 112 real plan moments, May–Oct 2026)

Each plan was re-run as if at 2:30pm two working days before, using only data
available then:

| | Mean error (packs) | Bias |
|---|---|---|
| Known orders only (before) | 261 | always too high by the full late amount |
| This forecast, all plans | **95** (37% of the late packs) | +6 |
| This forecast, held-out recent weeks (6 Aug–14 Oct) | **119** (45%) | +28 |

The "likely" range contained the real outcome 78% of the time overall (73% on the
recent weeks) — close to the 80% it aims for. Tuesday plans are the hardest (weekend
demand varies most).

## Levels (Create / Edit Plan → "Change levels", managers)

| Setting (app_settings) | Default | Meaning |
|---|---|---|
| `factory_forecast_low_red` | 500 | Red: too low |
| `factory_forecast_low_amber` | 600 | Amber: running low (recommends more batches) |
| `factory_forecast_target_low` | 800 | Target range from |
| `factory_forecast_target_high` | 1,000 | Target range to (recommendations aim here) |
| `factory_forecast_warn_at` | 1,250 | Orange warning |
| `factory_forecast_max_at` | 1,500 | Red: freezing stock — saving needs a second tap |

## Recommendation

Over 1,000: take batches off one at a time from the flavour with the most cover
(packs left ÷ its share of sales), never below its orders + safety margin
(lib/plan-margin) and never so it would run out, until the forecast is at or under
1,000. Under 600: add batches to the flavours with the least cover, up to 800, within
the day's capacity. One tap applies it; it's a suggestion — you can ignore it.

## Where the code lives

- Maths (pure, tested): `lib/stock-prediction/src/late-orders.ts`,
  `lib/stock-prediction/src/factory-forecast.ts`
- Data + API: `artifacts/api-server/src/lib/factory-forecast-data.ts`,
  `artifacts/api-server/src/routes/factory-forecast.ts` (`GET /api/factory-forecast`,
  `GET|PUT /api/factory-forecast/settings`)
- Screen: `artifacts/production-planner/src/components/factory-forecast-panel.tsx`,
  `src/lib/factory-forecast-rows.ts`, `src/hooks/use-factory-forecast.ts`

## Known limits

- Orders are counted by Shopify variants linked to calzone recipes; the Calzone Club
  Special and F2F variants aren't linked that way (~3% of packs), so late orders are
  slightly under-predicted.
- A delivery date changed on an order after it was placed can't be timed, so it counts
  as if it was always on the new date.
- Bank holidays: days with fewer than 50 packs are left out of the history.
