# P&L: QuickBooks lines → planner costs

Written 18 Nov 2026 from Graeme's fully expanded "Profit and Loss by Month"
export (27 Oct 2026, accrual basis). Covers the last six complete months in
that file, **Apr–Sep 2026**. Objective I (finance & reporting).

This is the plan for the **predicted P&L**: what each order and each day
*should* have made from our costings, set beside what QuickBooks says
happened. Nothing here is built yet beyond the QuickBooks by-month view.

## What happened (average month, Apr–Sep 2026)

| | £ / month | % of income |
|---|---:|---:|
| **Income** (after discounts and returns, incl. shipping charged) | **117,044** | 100% |
| Food purchases | 27,807 | 23.8% |
| Packaging | 10,145 | 8.7% |
| Courier (APC) | 11,052 | 9.4% |
| Shopify payment fees | 2,297 | 2.0% |
| Production labour (productive hours, holiday, month-end adjustment) | 25,116 | 21.5% |
| Events (one-offs) | 540 | 0.5% |
| **Gross profit** | **40,087** | **34.2%** |
| Advertising | 14,820 | 12.7% |
| Other marketing | 1,961 | 1.7% |
| **Fixed overheads** (breakdown below) | **19,161** | **16.4%** |
| **Net operating income** | **4,145** | **3.5%** |
| Depreciation + interest − other income | 1,462 | 1.2% |
| **Net income** | **2,683** | **2.3%** |

### The fixed overheads

| | £ / month |
|---|---:|
| Premises: rent 2,725, utilities 2,698, rates 524, insurance 267, waste 261 | 6,476 |
| Salaried staff (Payroll Expenses → Wages, less the NI allowance credit) | 4,879 |
| Software and subscriptions (incl. Shopify apps) | 3,976 |
| Factory running: equipment under the capital limit, repairs, cleaning, uniform | 2,187 |
| Postage and delivery IN | 782 |
| Admin: accountancy, bookkeeping, phone, office, printing, bank | 374 |
| Vehicle and travel | 311 |
| People: recruitment, training, welfare, entertainment | 184 |
| **Total** | **19,161** |

The planner's overheads box holds a single line, "General £30,000 a month".
Going by the books, that's about £10,800 a month too high, or it is also
counting advertising.

## How each QuickBooks line maps to the planner

| QuickBooks line | Planner source for the prediction | Double-count risk |
|---|---|---|
| Income: TCK Delivered gross sales, discounts, returns, shipping charged, wholesale, memberships | Shopify orders (the order mirror), counted by **dispatch day**, using the same rules as the new "Orders sold vs dispatched" report | Planner P&L today uses `total_price` *including* VAT. Most of our food is zero-rated, so it's close, but the prediction should use the ex-VAT figure |
| Food Purchases (Dairy, Flour, Fruit & Veg, Meat, Other Food) | Recipe **ingredient** cost × packs dispatched | QuickBooks books food when it's **bought**, not when it's used: there is no stock adjustment (Inventory Shrinkage is £0). A month that stocks up looks worse and the next one looks better. Compare over a few months, never month by month |
| Packaging – COS | Recipe **packaging** cost (Panibois tray, film, labels: about £0.38 a pack) **plus** the per-box cost (outer box, insulation, ice: the £2.50 / £3.50 setting) | **This is the one you flagged.** QuickBooks has ONE packaging line; the planner splits it between the recipe and the box. The prediction must add the two and compare them to that one line. Never put recipe packaging inside "food" |
| Courier Services – TCKD | APC: consignments per day × cost per parcel | The planner has **no courier cost at all** today, about £5 an order |
| Shopify Fees | Shopify transaction fees per order (already fetched by the old P&L) | None. Shopify apps are a separate line, in subscriptions |
| Direct Wages (productive hours, holiday pay, month-end adjustment) | Planday actual labour by day | Recipe `labour_cost` is £0 on every live recipe, so there's no clash today. If labour is ever costed into recipes, use either that or Planday, never both |
| Events costs | Leave out | One-offs, not part of the order model |
| Advertising and Promotion | Meta + Google spend by day (already synced for the Ads page) | Treat this as a **daily variable cost**, not an overhead |
| Marketing, Market Research | Overhead (monthly) | Falling: £27 in September |
| Everything else in Expenses | **Fixed overheads**, from QuickBooks automatically (average of the last N complete months) | Replaces the typed £30,000 |
| Depreciation, Interest, Other income | Shown below the line, monthly | Not part of an order's contribution |

## Things to know before trusting a single month

- **Food is booked when bought.** April (22% gross margin) and June (23%)
  look bad because purchases landed then. September looks good (37%) for
  the same reason. Food is the line most likely to differ from the
  prediction. Over six months the gap is waste, over-ordering or
  under-costed recipes, and that's what's worth chasing.
- **September moved Shopify apps into Dues and Subscriptions.** Shopify
  Apps & Subscriptions shows £0 in September and Dues jumps by about £1,500,
  so the subscription total is unchanged. Group them together.
- **Payroll Month End Adj** swings either way (−£1,121 to +£1,010). It's the
  25th-to-month-end accrual, so judge labour over two or three months.
- **Employers NI** shows a credit (−£387 a month on average): the
  employment allowance. It belongs with salaried staff.

## Proposed build, in order

1. **Done (b705bf89):** QuickBooks Profit and Loss by Month at the top of
   the founder P&L page.
2. **Account mapping, stored and editable.** Each QuickBooks account goes
   into one bucket: income, food, packaging, courier, payment fees,
   production labour, advertising, fixed overhead, below the line, or
   ignore. It's pre-filled from the table above. New accounts land in
   "unmapped" and get flagged, never guessed. The mapping lives in the
   database, not in code.
3. **Overheads from QuickBooks.** The fixed-overhead bucket, averaged over
   the last 3 or 6 complete months (your choice on the page), becomes the
   monthly and daily overhead. The typed box stays only for costs that
   aren't in QuickBooks yet.
4. **Predicted P&L by day and by month.** Revenue by dispatch day, minus
   food and packaging from the costings, courier per parcel, actual
   Shopify fees, Planday labour, and that day's ad spend, gives
   **contribution**. Then the daily overhead share gives **profit**. It
   rolls up into months shaped like the QuickBooks report.
5. **Predicted vs actual.** For each bucket, the predicted and QuickBooks
   figures side by side with the gap, so you can see where the costings
   are wrong (food first).
6. Later: the same breakdown per order and per recipe.

## Decisions (Graeme, 18 Nov 2026)

1. **Packaging:** the £2.50 / £3.50 box price is the outer box, insulation
   and ice packs. The Panibois tray is in the recipe's packaging cost. The
   tracker adds the two together and compares them with QuickBooks' one
   packaging line.
2. **Courier:** a flat price per parcel: £4.72 for a small box, £5.72 for a
   large one. A few outlying Scottish postcodes cost more, and those aren't
   picked out yet. Both prices can be changed on the page.
3. **Wages:** direct wages are production labour. The overheads hold the
   directors' salaries (Payroll Expenses).
4. **Advertising:** has its own line after gross profit, because it now
   moves with the scaling spend. Gross profit still matches QuickBooks.
5. **Purpose:** show the real QuickBooks P&L, with every line, inside the
   app, plus a prediction good enough to judge the last two weeks (for
   example, whether an offer pays) without waiting for the books.

## Built (18 Nov 2026, not deployed)

- **The profit tracker** (`/api/pnl-tracker`,
  `lib/finance/profit-tracker*.ts`, migration 0379): the predicted P&L for
  any days, the order analysis (every order costed, plus summaries by size
  and by product), predicted vs QuickBooks for recent complete months, the
  box and courier prices, and an editable grouping of every QuickBooks
  account. Revenue counts on the day the order was placed, as QuickBooks
  books it.
- **Checked on September 2026 local data**, with QuickBooks' figures typed
  in from the spreadsheet (QuickBooks must not run locally):

  | | Predicted | QuickBooks |
  |---|---:|---:|
  | Income | £148,034 | £147,076 |
  | Packaging | £11,684 | £12,160 |
  | Courier | £12,984 | £13,846 |
  | Gross profit | £56,988 | £54,768 |

  Food came out at £31,696 against £35,404 bought.
- **Missing costings:** Chorizo Chilli & Fior Di Latte (589 sold in
  September) and Calzone Club Special (161) have no recipe mapping. Treats
  and sauces rely on Shopify's own cost per item.
