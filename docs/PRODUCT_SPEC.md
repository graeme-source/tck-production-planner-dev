# TCK Production Planner — Product Specification

**Status:** Living document — v1.1 (2026-08-15)
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
management for planning, ordering, and reporting. It is also the vehicle for two things
beyond the physical loop: **food-safety compliance** (HACCP / SALSA) and the company's
**continuous-improvement culture** (Lean Made Simple / 2 Second Lean).

## 2. Core objectives

Everything the system does ultimately serves one of these. Features that serve none of
them are candidates for removal or extraction.

### The production loop

#### Objective A — Add new recipes quickly and easily

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

#### Objective B — Manage existing stock based on sales

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

#### Objective C — Never run out, and nothing ever goes out of date

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
3. Use-by dates captured at goods-in are actively monitored: anything approaching
   expiry is surfaced in time to use it, move it, or plan production around it —
   not discovered in the bin.
4. Waste is recorded when it happens (what, how much, why) so buffer targets can be
   tuned from evidence.
5. The system flags risk in both directions: "you will run out of X on Thursday" and
   "you are ordering more X than you can use before it expires."

**Success measure:** zero production stoppages from stock-outs; zero items discovered
out of date (every expiry either used, planned around, or logged as waste *before* the
date passes).

### Compliance

#### Objective D — HACCP compliance and SALSA-ready reporting

We are working towards SALSA accreditation. The system must make compliance a
by-product of normal daily work, not a parallel paperwork exercise.

1. Every HACCP control point that the system already touches (goods-in temperature
   checks, fridge/freezer temperature records, cooking temperatures, use-by dates,
   opening/closing checks, cleaning checklists) is captured digitally, timestamped,
   and attributed to a person.
2. Records are complete: a check that was missed is *visibly* missed (flagged/escalated
   same day), never silently absent.
3. An auditor-ready report can be produced on demand for any date range: temperature
   logs, goods-in records with supplier QC checks, traceability from delivered batch →
   stock → production plan → dispatched product, corrective actions (Andon issues and
   their resolutions).
4. Traceability is the backbone: if we're told a raw-material batch is contaminated,
   the system can answer "which products, which days, which customers" in minutes.

**Success measure:** SALSA audit evidence is generated from the system in minutes, with
no retrospective form-filling; zero gaps in the daily records.

### Culture

#### Objective E — Continuous improvement built into daily work

Our operating philosophy is **Lean Made Simple** (Ryan Tierney, Seating Matters),
inspired by Paul Akers' **2 Second Lean**. The system is a vehicle for this culture,
not just a record-keeper:

1. Everyone can raise an improvement or problem in seconds, from any screen, on the
   spot (the existing Report button / Kaizen flow and Andon alerts are the seeds
   of this).
2. Improvements are visible: submitted → considered → implemented, with credit to the
   person who raised them. The team sees their ideas change the workplace.
3. Training in the lean philosophy is delivered through the system (lessons, and
   "before/after" improvement stories), so every team member learns to see waste.
4. Improvements that change a process show up where the process lives — an updated
   SOP, a changed checklist, a station-screen note — so the improvement sticks.

**Success measure:** a steady flow of improvement submissions per person per month,
visibly actioned; every team member has completed the lean training track.

### Experience

#### Objective F — Effortless and *trustworthy* daily use

The routine work — opening/closing checks, batch numbers, stock counts — must be
effortless, and above all must never lose data.

1. **Nothing entered is ever lost.** Every field saves automatically (or makes its
   save state unmissably obvious). "I filled it in but it didn't save" — e.g.
   end-of-day batch numbers — is a critical defect class, treated with the same
   severity as a stock-out.
2. Daily checks are one-tap wherever possible, pre-filled with sensible defaults,
   and completable in the order the work actually happens.
3. The system works where the work happens: station tablets, possibly with wet or
   gloved hands — big targets, minimal typing, resilient to flaky connections.
4. Management doesn't spend time "going around fixing" entries. Time spent correcting
   the system's records is measured and driven to zero.

**Success measure:** zero lost-data incidents; daily checks completed without
management chasing or re-entering.

#### Objective G — Glanceable status and progress

Anyone should be able to answer "where are we up to today?" in seconds, from across
the room.

1. The dashboard leads with *state*, not numbers: icons, colour, and progress
   indicators first; the numbers behind them one tap away.
2. Status is honest and current: what's done, what's in progress, what's blocked,
   what's at risk (late deliveries, missed checks, Andon issues).
3. Each audience gets its own glance: floor (today's production state), management
   (orders/stock/compliance risk), founder (trend and exceptions).

**Success measure:** the daily "where are we up to?" question is answered by looking,
not by interrogating someone or decoding a grid of numbers.

#### Objective H — A personal, positive experience for every team member

Using the Planday integration (we know who is scheduled, where, and when), the system
greets each person with *their* day:

1. Log-in lands on a personal start page: welcome by name, today's station(s), and
   what's different today.
2. Process changes and recent improvements that affect *their* station are surfaced
   to them specifically — nobody discovers a changed process mid-shift.
3. Recognition is built in: improvements they raised, training they completed,
   milestones — the system should feel like it's on the team's side.
4. Bespoke ≠ restricted: personalisation adds relevance; it never hides things
   people need.

**Success measure:** every team member starts their shift from their personal page and
learns about relevant changes there — not by word of mouth after something goes wrong.

## 3. Supporting capabilities (in service of the objectives)

- **Production stations** (mixing, building, prep, dough, ovens, wrapping, packing)
  with cascade logic — how plans become product, stock is consumed, and HACCP cooking
  records are captured (A, B, D).
- **Goods in / deliveries** — temperature checks, use-by capture, supplier QC (C, D).
- **Dispatch & fulfilment** (APC, case orders) — demand leaving the building,
  finished-goods relief, traceability end-point (B, D).
- **Costing/margin engine and labelling/nutritionals** — recipe-attached data that
  makes Objective A "one sitting" (A).
- **Kaizen/improvements, Andon, lean lessons, training matrix** — the CI culture
  toolkit (E), and Andon doubles as corrective-action evidence (D).
- **Checklists and temperature monitoring (incl. Govee)** — daily-check backbone
  (D, F).
- **Planday integration** — scheduling data that powers personalisation (H).

## 4. Peripheral modules

The codebase also carries: surveys/marketing campaigns, founder focus/P&L tools,
morning meetings, employee hub, visitor log, onboarding.

Some of these earn their keep (e.g. visitor log is a SALSA site-security record;
morning meetings can carry the lean cadence) — but they are **not** allowed to:

- add coupling to the core loop's data model,
- slow down or complicate changes to core-loop code,
- compete for the same screens/navigation the production team uses daily.

Default posture: freeze feature work on these unless they directly serve objectives
A–H; extract or remove any that create drag (see the companion codebase analysis).

## 5. Product principles

1. **One source of truth per fact.** A stock level, a sale, a cost, a temperature
   reading lives in exactly one place; everything else derives from it. No re-keying
   between modules.
2. **Derive, then verify.** Prefer computing state from events (sales, production,
   deliveries) and using human counts to correct drift — not as the primary input.
3. **The floor comes first.** Station screens must stay fast, obvious, and hard to
   mis-tap. Management complexity never leaks onto station screens.
4. **Never lose an entry.** Autosave by default; explicit save states where autosave
   is impossible. Data loss is a P1 defect, always.
5. **Every number can explain itself.** Any suggested order quantity or plan number
   must be traceable to its inputs ("14 packs = forecast 120 portions − stock 40 +
   surplus 10%…"). Black-box numbers destroy trust and cause manual overrides.
6. **Compliance is a by-product.** If a HACCP/SALSA record requires extra work beyond
   doing the job, the design is wrong — capture it in the flow of the work.
7. **New recipes are configuration, not code.** If adding a product requires a
   developer, hard-coded name/ID, or a deploy, that is a defect.
8. **State over numbers on first glance.** Icons, colour, and progress convey status;
   numbers are the drill-down, not the headline.
9. **Boring plumbing.** Fewer patterns, applied consistently, beat clever one-offs.
   New code follows the established route → service → schema layering (see analysis).

## 6. How we work against this spec

- Daily operational issues get logged against an objective (A–H) and fixed at the
  *cause* layer (data model / engine / UI), not patched at the symptom.
- Refactors are justified by objective impact ("this makes recipe-add one step
  shorter", "this makes order maths explainable"), not by aesthetics.
- The companion document `docs/CODEBASE_ANALYSIS.md` maps the current code to these
  objectives and holds the prioritised change backlog.

## 7. Open items to capture (running list)

Graeme is compiling further objectives/daily issues. Known items awaiting detail:

- Specific daily issues encountered by the team (to be logged against objectives).
- End-of-day batch numbers not saving automatically (Objective F defect — investigate
  and fix).
- Dashboard readability rework with icons/status-first design (Objective G).
