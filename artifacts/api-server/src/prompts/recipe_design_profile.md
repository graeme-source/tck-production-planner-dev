---
name: Recipe design profile
description: Criteria for designing new TCK recipes — profitability, complexity, premium positioning. Used as the basis for a future conversational recipe-design + auto-build flow.
type: project
status: draft — parameters and ranking system still being built up with the user
originSessionId: 8639b256-8dcb-41df-a9f2-683bbec3c0ee
---
Living document. The user (Graeme) will keep adding parameters and we will
build a ranking system on top of this. Don't lock the structure down yet —
expect to extend rather than rewrite.

## Long-term vision

Graeme wants a conversational recipe-design assistant: he says what kind
of recipe he wants to make (cuisine, occasion, vibe), the assistant
advises based on the parameters in this profile, and once a design is
agreed the assistant **builds the recipe directly in the production
planner** (recipe row + ingredient lines + costs) so Graeme doesn't have
to type it in by hand.

This profile is the rubric the assistant scores designs against.

## Parameters captured so far

### 1. Profit margin (hard floor)

- Target: **≥ 80% gross profit margin**, calculated **excluding labour**.
- Labour is now stripped out of recipe creation (it's accounted for elsewhere
  in the business), so the 80% is purely on ingredient cost vs sell price.
- Recipes below this floor should be redesigned (cheaper substitutes,
  smaller portions of expensive components, or a higher sell price if the
  premium positioning supports it) before being added.

### 2. Prep complexity (soft preference)

- Default: keep recipes simple and quick to prep.
- Anything that adds significant station time (long reductions, multiple
  components, fiddly assembly) is a cost in throughput, not just margin.
- **Exceptions are allowed when the complexity is the selling point** —
  see "Premium positioning" below. The complexity becomes the story.

### 3. Premium positioning (drives price ceiling)

The price a pack can command is not just a function of ingredient cost —
how the recipe **sounds and reads** matters. Premium-sounding fusion
concepts and showcase ingredients let us charge well above the standard
calzone tier.

**Premium examples (proven):**

- **Beef Wellington calzone** — sold December at **£24/pack**.
  - 6-hour red wine reduction gravy
  - Whole centre-cut sirloin per pack (28-day aged South American steak)
  - Fusion concept (Wellington × calzone) made it sound special
  - Justified the complexity *and* the price
- **Carnizone** — sold at **£17.95/pack**.
  - Heavy on meat
  - Name + description read as premium, customers willing to pay

**Anti-example (standard tier):**

- Chicken and peppers — fine recipe but reads as "fairly standard", so
  it has to live near the baseline price and can't carry a complex prep.

### 4. Portion weight

- **Standard portion: 300–350 g** of filling per portion.
- This is the working range for a normal calzone serving.
- (Mac cheese is a separate category — different sizing rules.)

### 5. Target RRP

- **Standard tier: ~£12 / pack** (entry point).
- **Premium tier: up to ~£25 / pack** for designs that earn it via
  positioning + ingredients.
- **Above £25 is allowed** if the design genuinely justifies it
  (showcase cut + technique + story); the £25 isn't a ceiling, it's
  the upper edge of what's been priced so far.
- Used together with the 80% GPM floor to derive an ingredient-cost
  budget per pack at any given target price.

### 6. Pack format

- **Every calzone is a 2-portion pack.** RRP figures (£12 standard,
  up to £25 premium) are always per 2-portion pack.
- **Dough weight is fixed at 115 g per portion** — do not vary it.
- Pack must fit the existing trays, but there is **headroom for
  bulkier calzones** if the design pushes the price up (extra-large
  premium variants are allowed inside the existing tray footprint).
- *Filling-to-dough ratio target:* not yet locked. Derive it from the
  current recipe set when first needed (see Pending design decisions).

### 7. Dietary coverage

- **Vegetarian recipes are the current gap.** New veggie designs are
  prioritised over more meat options.
- **Allergens:** the canonical allowed/declared list lives on the
  website's labelling & nutritional section — treat that as the source
  of truth rather than a list re-stated here.

### 8. Dough constraints

- Two existing doughs, both Neapolitan-style. Adding a **third dough is
  a very high bar** — the proposal has to materially improve the
  sellability of the product, not just be different.
- Past example considered (and shelved): a high-protein dough aimed at
  gym-goers. Worth revisiting only if the marketability is strong.

### 9. Station / process flexibility

- Default is to fit existing stations.
- **Bespoke processes are allowed if the price + sellability earn it.**
  Example: the Beef Wellington's 5–6 hr red-wine gravy reduction was a
  shared-responsibility task across stations through the day — fine
  because the £24 pack supported it.
- Don't artificially restrict the design; if a really good idea needs a
  new step, evaluate it on whether the recipe can carry the cost.

### 10. Shelf life targets

- **Standard core menu: 13 days** on label.
- **Test calzones (customer trials): 10 days** on label, assuming the
  same cooking method each time.
- Already validated up to **16 days** on 5–6 recipes — calzone is a
  dry product, shelf life is generally strong.
- **Mac & cheese is the outlier: ~6 days** because it's wet and heavy
  — actively a challenge, not a target to match.
- New designs need to clear ≥10 days easily and ideally ≥13 to fit the
  core menu.

### 11. Sourcing

- **Default: stay with existing suppliers**, especially for short-shelf
  raw meat. Brakes and NFS cover most needs and have a strong product
  range.
- **New supplier OK if** the ingredient is shelf-stable / stockpileable
  — e.g. tagine spice from Amazon or specialist mix sites in packs of
  12, enough for ~a month, manage on Kanban. Low operational cost.
- **Avoid** new short-shelf-life raw-meat suppliers unless the value is
  exceptional.
- We can make our own rubs / spice blends from herbs & spices when
  helpful.

### 12. UPF avoidance (Nova classification)

- **Strong preference: no ultra-processed ingredients (UPF) on the Nova
  scale.**
- **Long-term goal: a fully UPF-free menu.**
- Small exceptions accepted today for a new recipe if the ingredient
  genuinely makes a real difference, but the default answer is "find
  a cleaner alternative".
- Already paying a premium on cleaner sauces etc. to keep UPFs out —
  this is a real cost we accept on purpose. Factor it into ingredient
  cost when assessing GPM.

### 13. Naming

- **No template** — names must be exciting and distinctive.
- *Carnizone* is a one-off pun (carne + calzone = "the meat zone"); it
  isn't a pattern to replicate.
- LLMs historically produce cheesy / try-hard names — be careful, lean
  towards confident and concise rather than punny unless the pun
  actually lands.
- Story-ability is a nice-to-have, not required at this stage.

### 14. Seasonal slots

- Seasonal specials are already part of the rhythm — e.g. Beef
  Wellington calzone at Christmas.
- **Upcoming focus: American barbecue, tied to the World Cup.** Suggest
  designs in this lane proactively.
- Otherwise: when proposing recipes, flag any that fit imminent
  seasonal events / cultural moments — it's a useful nudge, not a
  hard requirement.

### 15. (placeholder — to be filled in by Graeme)

Future parameters expected:
- Cuisine balance / variety across the menu
- Allergen / dietary tags (V, VG, GF coverage)
- Seasonality
- Ingredient overlap with existing recipes (shared prep saves labour)
- Customer feedback / sales velocity from existing similar recipes
- Anything else Graeme wants to add

## Ranking system (to be designed)

Not yet defined. Likely shape:
- Hard gates (must pass): GPM ≥ 80%, no banned ingredients, etc.
- Weighted score across the soft parameters above to compare candidate
  recipes.
- Premium positioning unlocks complexity tolerance and a higher price
  ceiling, so it should multiply rather than add.

## Pending design decisions / data to gather

- **Mexican recipe glaze swap**: replace the piri piri glaze with a
  tagine + chilli + lime profile. Graeme doesn't like the piri piri.
- **Derive filling-to-dough ratio** from existing recipes the first
  time we need it for a design. Dough is fixed at 115 g per portion,
  portions are 300–350 g, so the ratio is implicitly ~2.6×–3.0× by
  weight — but confirm against the actual recipe table before quoting.
- **American BBQ × World Cup** is the next active seasonal slot to
  brainstorm into.

## How to apply

When Graeme brings a recipe idea (existing or new):
1. Check it against the hard gate — GPM ≥ 80% ex-labour.
2. Assess prep complexity; flag if high.
3. Assess premium positioning — does the name + key ingredients earn a
   price that absorbs any complexity?
4. Suggest substitutions / portion changes / price moves to bring it
   over the line.
5. Once Graeme agrees the design, build the recipe in the system rather
   than asking him to add it manually.
