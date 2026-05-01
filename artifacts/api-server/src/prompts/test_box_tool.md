---
name: Test box scheduling tool (planned)
description: Internal admin feature to mark recipes as test-box recipes, schedule a test box, and work backwards from the delivery date through ordering / prep / production deadlines.
type: project
status: planned — not yet started, but Graeme wants Phase 1 (basic scheduling) soon
priority: medium-high (after the immediate recipe design work)
originSessionId: 8639b256-8dcb-41df-a9f2-683bbec3c0ee
---
## What Graeme wants

A repeatable, template-driven way to run a test box. Each test box has
2–4 main recipes (preference: fewer rather than more), a target delivery
day, and a set of deadlines that fall out from that delivery day:

- "Sell the test box" by date
- "Orders in for the first delivery date" by date
- Ordering deadline for ingredients (works back from supplier lead time)
- Prep / dough dates
- Production day(s)
- A **bigger buffer** than a normal production plan because demand is
  uncertain on test products

The output is a **to-do list** for the upcoming test delivery — what to
order, when, what to prep — that's like a production plan but with
extra checks specific to test boxes. The page should focus on the
*next* test delivery day and the deadlines around it.

It's iterative: run a test, find the gaps in the template, fix the
template, run the next one.

## Phased approach

### Phase 1 — Schedule + tag (the immediate ask)

Smallest version that's still useful:
- New `test_boxes` table: id, name, deliveryDate, status, notes,
  bufferPct (default e.g. 20%).
- Recipes can be **assigned** to a test box (many-to-many or a single
  FK on the recipe — single FK is simpler if a recipe only ever
  belongs to one test box at a time).
- New admin page **/test-boxes**: list of upcoming test boxes,
  delivery dates, recipes in each, basic checklist of derived dates
  (order-by, prep, production) computed from existing supplier lead
  times + the production planner's prep/dough scheduling rules.
- Existing production plans can be **tagged** as part of a test box
  (so they show up on both the normal planner and the test-box page).
- Buffer applied as: suggested batches × (1 + bufferPct).

Reuses everything that already exists in the planner. Doesn't try to
be clever yet.

### Phase 2 — Dynamic from sales

Once real sales are coming in for the test products:
- Pull Shopify / DPT sales for the test recipes' delivery days into
  the test-box page (we already pull these for normal calc).
- Recompute the to-do list as orders arrive, surface deltas vs what
  was originally scheduled.
- Configurable rules: "if sales > X by date Y, increase production
  by Z", "if orders not in by date W, alert", etc.

### Phase 3 — Template feedback loop

- After a test box ships, capture what went well / badly.
- Refine the template — defaults for buffer, ordering deadline buffers,
  etc. — so the next test box uses the better numbers.

## Open design questions (defer until we start)

- Single FK `recipes.test_box_id` (recipe only in one test box at a
  time) vs join table (recipe could be in multiple)? Single FK is
  almost certainly fine — test recipes are point-in-time.
- Does a test-box production plan replace the normal plan for that
  day, or sit alongside it? Probably "is part of" the normal plan,
  with the plan tagged.
- How do "specials" relate to test boxes? They feel similar but
  aren't identical — a special is a one-off live SKU; a test box is
  a research vehicle. May want both `is_special` and `test_box_id`.

## How to apply

When Graeme is ready to start this:
1. Confirm Phase 1 scope above with him before any code.
2. Schema first, then admin page, then deadline derivation logic —
   each in its own commit.
3. Don't build Phase 2/3 until Phase 1 has run a real test box
   end-to-end and we know what the gaps are.
