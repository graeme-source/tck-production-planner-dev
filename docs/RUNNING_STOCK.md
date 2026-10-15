# Running ("expected") stock

Approved by Graeme 15 Oct 2026. Objective B ("theoretical stock at any time,
with physical counts as a correction"). Addresses the "snapshot stock model"
in `CODEBASE_ANALYSIS.md` §5.2 — read-side only.

## The model

    expected = last real count + goods received since − usage since

Per ingredient, computed on read every time it's asked for. Nothing new is
stored and no stock row is ever changed. Freezer locations are left out, the
same scope the Orders page has always used.

It starts from each ingredient's **most recent real count** — there's no
special count day. An ingredient that has never been counted has no expected
figure (most kanban items: count them once and the figure starts).

Code: `artifacts/api-server/src/lib/stock-ledger.ts` (the sums, pure, tested),
`stock-ledger-data.ts` (reads the events), `stock-usage-rules.ts` (which recipe
line is used where — shared with the Orders page's still-to-prep).

## Counts vs receipts

Both live in `stock_entries`. A row is a **movement**, not a count, when its
note starts with one of the notes the system writes:

- `Delivery from PO #…` (goods-in, including `(edit)`) and `Undo delivery PO #…`
- `Transfer in …` / `Transfer out …`

Every other ingredient row is a count somebody typed (prep-station stock
checks, the Orders page stock box, Stock Control). `daily_stock_checks` rows
are counts too; the two copies of one prep-station count (written seconds
apart) collapse into one. A movement's quantity is its level minus the level
before it at that location.

## What usage is tracked

| Where | How | Status |
|---|---|---|
| Prep tins (main prep, veg, raw meat) | each ticked tin = that line's raw quantity ÷ tins — the same maths as still-to-prep (processing ratio, Mix +g). A marinade goes with each tin of its meat. | tracked |
| Mixing station | filling-mix lines not prepped into tins (fior di latte, bought sauces), per mixing batch | tracked |
| Building station / fried chicken | toppings, topping cheese, drizzles, per built batch (a partial batch counts its packs) | tracked |
| Bases, sauces, dough, rubs and other sub-recipes | **not recorded when made** (`sub_recipe_completions` has no quantity), so estimated from the batches that use them: filling-mix sub-recipes at mixing, the rest at building | estimated |
| Waste recorded against an ingredient (Report defect) | taken off when recorded | tracked |
| Packaging, cleaning, anything no recipe uses | nothing records their use | not tracked — no expected figure |

Each ingredient carries a coverage flag: **Tracked**, **Partly tracked** (some
of its use is inside a sub-recipe), or **Usage not tracked**.

## Where it is shown — and where it isn't

- **Never at a station or on a stock-check screen.** Counts stay blind ("I
  don't want people to just go 'yeah, that sounds right'"). The stock-check
  entry shows only the person's own count today and, after a number is typed,
  the "that's a lot more than usual" check against past *counts*.
- **Stock Accuracy** (Inventory, managers/admins, `GET /api/stock-accuracy`):
  expected now, what it's built from, each count vs what was expected at that
  moment, and flags for big or repeated gaps.
- **Orders**: with a count today the count is used as before, and a quiet
  "expected 4.2" sits beside it. Without one, the line reads
  "Expected ~X kg — last counted 12 Oct, + deliveries − usage" and the order is
  worked out from it, so an order can be placed without counting. Its box
  starts empty: typing a number records a real count.

### Orders: no double counting

Still-to-prep (`lib/outstanding-prep.ts`) takes off tins not yet inside the
stock figure. From a count: tins ticked after the count, and unticked tins.
From the expected figure the ledger has already taken off the ticked tins, so
still-to-prep counts only unticked ones (`isTinOutstanding` with "now"). The
plan being ordered for already counts its whole requirement, so its own usage
since the count is added back. Tested in `stock-ledger.test.ts`.

## Accuracy (read-only mirror of live, 6 weeks to 14 Oct 2026)

The gap is |counted − expected| as a share of the bigger of the expected stock
and the usage since the previous count (small daily items sit near zero, where
"% of expected" is meaningless).

- 25 ingredients with 3+ comparisons: median gap **15%**.
- Best where usage is prep tins: pork 4%, courgettes and mushrooms 5%,
  mozzarella 4%, fior di latte 5%.
- Sub-recipe (estimated) items: flour 12%, tomato purée 10%, passata 16%,
  diced beef 15%, beef mince 21%, whole milk 37%.
- Consistent shortfalls the page flags: fresh basil (~50% short every day —
  waste or recipe amounts), diced chicken, double cream, whole milk.

## Limits

- Sub-recipe usage is an estimate: timing follows when the batch is built,
  not when the base/sauce was made, and yield loss when making it is unseen.
- Waste only counts when someone records it against the ingredient (and a
  tin that was ticked and then binned would be taken off twice).
- Stock that arrives without being booked in, or is moved without a transfer,
  shows up as a gap at the next count — which is the point of the page.
- Loose extra packs built at building aren't counted as usage.
- Kanban items: expected figure for information; no automatic kanban pulls.
