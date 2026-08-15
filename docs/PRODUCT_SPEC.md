# TCK Production Planner — Product Specification

**Status:** Living document — v1.0 (2026-08-15)
**Owner:** Graeme (The Calzone Kitchen)
**Purpose of this document:** This is the north star for the production planning / ERP
system. Every feature request, refactor, and daily-issue fix should be evaluated against
the objectives below. When we discuss a change, the first question is: *which objective
does this serve, and does it move us closer or add drag?*

---

## 1. What this system is

A production planning and lightweight ERP system for The Calzone Kitchen — a fresh-food
production business selling via Shopify (D2C) and wholesale/case orders. It runs the
whole physical loop:

> **Sales → production planning → ingredient ordering → goods in → stock → prep &
> production stations → wrapping/packing → dispatch → back to sales.**

It is used daily by a small team on the shop floor (tablet/station screens) and by
management for planning, ordering, and reporting.

## 2. The three core objectives

Everything the system does ultimately serves one of these. Features that serve none of
them are candidates for removal or extraction.

### Objective A — Add new recipes quickly and easily

A new recipe (or a variant/special) should go from idea to *fully operational* in one
sitting, without engineering help. "Fully operational" means the recipe:

1. Has ingredients, sub-recipes, and quantities with live cost/margin feedback.
2. Is automatically priced into the cost/margin engine (packaging, labour, RRP).
3. Flows into production plans (batch sizes, station checklists, assembly order).
4. Is linked to its Shopify product(s) so sales drive its production numbers.
5. Has its label data (ingredient deck, allergens, nutritionals) generated, not re-keyed.
6. Has its ingredient demand visible to the ordering engine immediately.

**Success measure:** a competent manager can add a new special end-to-end in under
30 minutes with zero developer involvement and zero "it silently doesn't appear in X"
surprises.

### Objective B — Manage existing stock based on sales

Stock levels should be *driven by data we already have* — Shopify sales, dispatch
orders, production plans, goods-in records — rather than by manual counting alone.

1. Sales (Shopify + wholesale/case orders) are the primary demand signal.
2. Production consumes ingredient stock; goods-in adds it. The system should know
   theoretical stock at any time, with physical counts as a *correction*, not the
   only source of truth.
3. Finished-goods stock (fridge/freezer product) is tracked against dispatch demand.
4. Discrepancies between theoretical and counted stock are surfaced (shrinkage,
   yield problems, recipe drift) instead of silently absorbed.

**Success measure:** stock counts become a fast verification exercise (minutes, on
exceptions) instead of the primary bookkeeping mechanism; the team trusts the numbers
on screen enough to order from them.

### Objective C — Never run out, never over-stock perishables

The ordering engine's job is to hold the line between two failure modes:

- **Stock-out:** production stops or a product is unavailable because an ingredient
  ran out.
- **Over-stock/waste:** fresh produce (raw meat especially) passes its use-by date
  and is binned.

Requirements:

1. Order suggestions account for: forward production demand, current stock, incoming
   purchase orders, supplier lead times and delivery days, shelf life, and case sizes.
2. Perishables are ordered against a *dated* demand window no longer than their
   shelf life; long-life goods can carry buffer stock.
3. Waste is recorded when it happens (what, how much, why) so buffer targets can be
   tuned from evidence.
4. The system flags risk in both directions: "you will run out of X on Thursday" and
   "you are ordering more X than you can use before it expires."

**Success measure:** zero production stoppages from stock-outs, and measured perishable
waste trending down month-on-month.

## 3. Supporting capabilities (in service of A–C)

These exist to serve the core loop and are kept:

- **Production stations** (mixing, building, prep, dough, ovens, wrapping, packing)
  with cascade logic — this is how plans become product and how stock is consumed.
- **Goods in / deliveries** — temperature checks, use-by capture, QC — this is how
  stock arrives with the data Objective C needs.
- **Dispatch & fulfilment** (APC, case orders) — this is how demand leaves the
  building and how finished-goods stock is relieved.
- **Costing/margin engine and labelling/nutritionals** — recipe-attached data that
  makes Objective A "one sitting" instead of a week of spreadsheets.
- **Food-safety records** (temp logs, checklists) where they piggyback on the flow
  above.

## 4. Peripheral modules (explicitly *not* core)

The codebase also carries: Kaizen/improvements, Andon issue reporting, morning
meetings, surveys/marketing campaigns, founder focus/P&L tools, training matrix,
lean lessons, employee hub, visitor log, Govee monitoring, onboarding.

These may be useful, but they are **not** allowed to:

- add coupling to the core loop's data model,
- slow down or complicate changes to core-loop code,
- compete for the same screens/navigation the production team uses daily.

Default posture: freeze feature work on these unless they directly serve A–C; extract
or remove any that create drag (see the companion codebase analysis).

## 5. Product principles

1. **One source of truth per fact.** A stock level, a sale, a cost lives in exactly one
   place; everything else derives from it. No re-keying between modules.
2. **Derive, then verify.** Prefer computing state from events (sales, production,
   deliveries) and using human counts to correct drift — not as the primary input.
3. **The floor comes first.** Station screens must stay fast, obvious, and hard to
   mis-tap. Management complexity never leaks onto station screens.
4. **Every number can explain itself.** Any suggested order quantity or plan number
   must be traceable to its inputs ("14 packs = forecast 120 portions − stock 40 +
   surplus 10%…"). Black-box numbers destroy trust and cause manual overrides.
5. **New recipes are configuration, not code.** If adding a product requires a
   developer, hard-coded name/ID, or a deploy, that is a defect.
6. **Boring plumbing.** Fewer patterns, applied consistently, beat clever one-offs.
   New code follows the established route → service → schema layering (see analysis).

## 6. How we work against this spec

- Daily operational issues get logged against an objective (A, B, or C) and fixed at
  the *cause* layer (data model / engine / UI), not patched at the symptom.
- Refactors are justified by objective impact ("this makes recipe-add one step
  shorter", "this makes order maths explainable"), not by aesthetics.
- The companion document `docs/CODEBASE_ANALYSIS.md` maps the current code to these
  objectives and holds the prioritised change backlog.
