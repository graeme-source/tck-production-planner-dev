# Calzone Club Special changeovers: how they work, and the unsolved overlap

Written 25 November 2026 from Graeme's own description, during the Philly
Cheesesteak 2.0 to 12-Hour Birchstead Beef & Mushroom changeover. Nothing in
here is built unless it says so. Graeme asked for it to be kept so the work
can be picked up later; read it before touching anything to do with the
Calzone Club Special, the cart's subscription upgrade, or how a Club Special
line is picked on the packing screen.

## The facts, in Graeme's terms

There are two separate things, and each has a first day and a last day.

**Subscriptions (the "Calzone Club Special" product, a rotating recipe).**
- A recurring order is *generated and billed* on one day and *delivered about
  7 days later*. So a changeover has a billing date and, a week on, a delivery
  date.
- This changeover: recurring orders generated up to and including **Saturday
  21 November** are Philly. On **Sunday 22 November** Graeme changed the Club
  Special's price to the beef's price and told subscribers (email sent
  Thursday 19 November) that anything generated from Sunday onwards is the
  Birchstead beef.
- So recurring orders being *delivered* this week, up to and including
  **Saturday 28 November**, are still Philly. From **Tuesday 1 December** they
  are the Birchstead beef.

**One-time (the named recipe on the menu).**
- Completely independent of the subscription dates. The Philly stopped being
  sold one-time two to three weeks earlier. The Birchstead went on the menu
  one-time on 25 November, for delivery from Friday 27 November.

**The planner's "Calzone Club Special" tick** (Recipes, On the menu) says which
recipe Club Special orders count as, for production plans and the packing
screen. It can only point at one recipe, so it has to stay on the Philly until
the last Philly subscription delivery has been made (planning for Monday 30
November's despatch is when it moves).

## The problem

While the new special is on sale one-time but subscriptions are still being
sent the old one, the cart's "upgrade to subscription" can't work for the new
special:

- The upgrade swaps the named special for the Calzone Club Special product.
  It only does that for the product the planner has marked, which is still the
  old recipe.
- If it did swap, the customer could pick a delivery date *before* the
  subscription delivery changeover (this week: Friday 27 or Saturday 28
  November). The despatch team see "Calzone Club Special" on Thursday and
  Friday, which to them is still the Philly, but this customer chose and
  expects the Birchstead.
- The customer picks the delivery date *after* the products are in the basket,
  so at the moment of the upgrade the site doesn't know which side of the
  changeover the order will fall on.
- The order still has to carry the Calzone Club Special as its subscription
  product, because that is what renews.

Graeme's instinct: keep whichever named product the customer chose when they
built their first subscription order, show them the usual "this is the
rotating Calzone Club Special" warning, and show the packing team that product
on the picking screen. What matters is that what the customer thinks they are
getting matches the delivery days that product is available for (set in Zapiet:
delivery, local delivery and pickup). Recurring orders are where "what they
chose" stops working, because nobody chooses anything on a renewal.

He would also like to stop changing the Club Special's barcode by hand at each
changeover.

## What was decided on 25 November

Do nothing. Accept that nobody can upgrade to subscription with the Birchstead
until the planner tick moves. Graeme was worried a rushed change would cause a
mis-pick.

## The proposal on the table (not approved, not built)

Decide the recipe for each Club Special *order line*, instead of one tick for
everything:

1. **First order: what they chose.** A line that came from the cart upgrade is
   the product the customer had in the basket.
2. **Renewals: the delivery date.** A dated schedule in the planner replaces the
   single tick, for example Philly for deliveries up to Saturday 28 November,
   Birchstead from Tuesday 1 December.

On the overlap days, renewals resolve to the old recipe by date and new
sign-ups resolve to the new one by choice.

What it would need:
- **Website cart upgrade:** record the product actually in the basket on the
  Club Special line, and allow the new special to be upgraded before the tick
  moves. Today the swap writes "This delivery: <name>" but takes the name from
  the planner's current special, so it would say the old recipe.
- **Zapiet:** after the swap the cart holds the Club Special product, so its
  delivery dates apply, not the named recipe's. They would have to be open for
  the overlap days for a new sign-up to choose one.
- **Planner packing screen:** show the resolved recipe on every Club Special
  line ("Calzone Club Special: PHILLY") and have the scanner expect that
  recipe's barcode. Today the packing screen does not read the line note.
- **Planner production plans:** count Club Special demand into the right recipe
  per delivery date.

Known risks:
- Subscription apps usually copy line notes onto every renewal. Rule 1 must
  only ever apply to the first checkout order, never a renewal, or a note saying
  "This delivery: Birchstead" would outlive the next changeover. How Loop
  behaves had not been checked.
- Someone who adds the Calzone Club Special itself, not a named recipe, has
  made no choice; in an overlap they would get whatever the date rule says.

Questions Graeme had not answered:
1. In an overlap, do renewals stay on the old recipe until its last delivery
   day? (Assumed yes; it matches what he described.)
2. Should buying the Club Special directly be blocked during an overlap, or
   left to the date rule?
3. Build it in one go, or packing-screen display first?

## What exists today (so nobody rebuilds it)

Planner:
- `artifacts/api-server/src/lib/special-shopify-sync.ts`: every 5 minutes,
  copies the ticked recipe to Shopify (shop metafield `tck.current_special`,
  product tag `current-special`). It only acts when the tick changes.
- `routes/production-plans.ts`: merges all Club Special sales into the ticked
  recipe, with no regard to delivery date.
- `lib/barcode-store.ts`: the Club Special scans with the ticked recipe's pack
  barcode.
- Branch `claude/special-changeover-scheduler` (5 October 2026, never deployed):
  a Club Special page that schedules a changeover with a "delivering from"
  date, switches on the billing day, sets the price and raises the two Zapiet
  to-dos. It still flips the single tick, so it does not solve the overlap.

Website theme (`graeme-source/tck-theme`):
- `snippets/tck-cart-subscription-upsell.liquid`: the upgrade and the swap onto
  the Club Special product, keyed on the `current-special` tag.
- `snippets/tck-club-changeover.liquid` and Theme settings, Calzone Club
  Special: wording that names both specials with their delivery dates during a
  changeover (menu panel, portal banner, cart note, membership page). Wording
  only.
- Theme settings, Calzone Club Special, "Show as the special on the menu":
  gives a chosen product the black and gold look before the tick moves.
  Display only; it does not enable the subscription upgrade.
