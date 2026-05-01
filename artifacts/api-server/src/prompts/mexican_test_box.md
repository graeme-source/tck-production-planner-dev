---
name: Mexican test box (in design)
description: Current test-box campaign. 2–4 main recipes leaning fewer. Improving on a popular older Mexican recipe.
type: project
status: in design (Claude Code conversational design phase)
priority: active
originSessionId: 8639b256-8dcb-41df-a9f2-683bbec3c0ee
---
## Scope

- **Test box size:** prefer fewer rather than more recipes.
  Past test boxes have been too big. Target 2–3 mains.
- The American Style Special running alongside is the **Don Burger**;
  Graeme has already designed it (live server has the original recipe).
  Not a focus here.

## Recipes in the box

### 1. Mexican chicken (peri-peri / fajita style)

- Improving on a Mexican recipe TCK ran a few years ago that was very
  popular.
- Wants more **punch** than the old version.
- **Jalapeños** are an explicit candidate ingredient for that punch.
- Style direction: peri-peri-ish or fajita-ish — Graeme is open on
  exactly which lane.
- Replaces the old piri-piri glaze (which Graeme has decided he doesn't
  like) with a **tagine + chilli + lime** profile (parked from earlier
  in the design profile work).

### 2. Chilli con carne style

- Graeme has a draft recipe in mind.
- The open question is **cooking method** — needs to fit TCK's process
  (Neapolitan dough, existing stations, calzone format, 2-portion pack,
  115 g dough/portion).
- Worth thinking about how a wet-ish chilli filling sits inside the
  calzone format — moisture management vs the usual filling.

### 3. (Optional) Fried chicken

- Mentioned as a possible third item but explicitly de-emphasised:
  "we don't want to do too many".
- Treat as a maybe — only add if it earns its place against the
  recipe-design rubric and adds variety the other two don't cover.

## Constraints (from `project_recipe_design.md`)

All Mexican test-box recipes must clear:
- ≥ 80% GPM ex-labour
- 115 g dough per portion (fixed)
- 2-portion pack
- 300–350 g filling per portion
- Fits existing trays
- ≥ 10 days shelf life on the test label
- No UPF ingredients (small exceptions only if they materially help)
- Existing suppliers for short-shelf raw meat; new shelf-stable
  suppliers OK on Kanban (e.g. tagine spice — already noted as
  buyable in packs of 12 from Amazon)

## Pending data lookups before quoting numbers

- Pull the **old Mexican recipe** from the live DB (read-only) so we
  can use it as the starting point for the chicken design.
- Pull **current ingredient costs** for the candidate ingredient list
  before computing GPM.
- Confirm the **filling-to-dough ratio** in the existing recipe set
  so we sanity-check 300–350 g filling : 115 g dough across the
  current core menu.

## Workflow

1. Design chicken recipe end-to-end here in Claude Code (conversational).
2. Design chilli con carne, focused on cooking method first.
3. Decide whether fried chicken earns the third slot.
4. Once the recipes are agreed, schedule the test production via the
   (still-to-be-built) test-box scheduling tool — see
   `project_test_box_tool.md`. In the meantime, schedule via the normal
   production planner with manual deadlines.
