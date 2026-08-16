# TCK Production Planner — Product Specification

**Status:** Living document — v1.3 (2026-08-16)
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

**The letters are names, not rankings.** Objectives A–I are all equally important;
no objective outranks another. Sequencing of *work* is decided by dependency and
opportunity (see the roadmap in the analysis doc), never by the letter.

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

**The engagement challenge (named honestly):** the biggest obstacle is not content —
a 12-week 2 Second Lean curriculum, a video→SOP pipeline, and a training matrix
already exist in the system. The obstacle is that all of it is **pull-based**
(a library, a lean-cave page, a meeting slide needing a confident host), and most of
the team "want to do their job and go home" — they will never pull. That is a design
constraint, not a character flaw. Design rule for everything under this objective:
**push, in tiny doses, at the point of work, using our own factory's data, with a
visible payoff.**

Design direction (the delivery system):

1. **The Daily Two** — two minutes at PIN-in, on the personal start page (Obj. H):
   one micro-lesson card (a single concept, atomised from the existing curriculum),
   one *noticing* question built from yesterday's real factory data ("4.2kg of
   mozzarella was binned — which of the 8 wastes is that?"), ending in the 2-second
   prompt: "spot one thing that bugs you today" → one tap into the Report form.
   Learning and action in the same two minutes. Personal streaks, a team streak on
   the dashboard — gentle, adult, never punitive.
2. **SOPs live in the flow, not in a library.**
   - *Point of use:* the station screen knows (Planday + training matrix) when it's
     this person's first time on a task and offers the 90-second video first.
   - *Point of change:* an improvement that changes a process isn't complete until
     the SOP is touched, and everyone scheduled on that station gets a "this changed
     since you last did it" card with the before/after.
   - *Creation is filming, not writing:* the person who does the job films it; the
     existing video→SOP pipeline builds the steps. An SOP you filmed is yours.
   - *Staleness is visible:* SOPs untouched while their process changed get flagged.
3. **New starters** get a start-page sequence: each day, the one SOP video for the
   station they're scheduled on that day, auto-ticked into the training matrix.
4. **The software makes the habit cheap; leadership makes it matter.** Morning-
   meeting celebration of improvements (the meeting module auto-pulls yesterday's
   submissions and the week's lesson) stays a human act — the system just guarantees
   there is always something ready to celebrate.

**Morning meeting redesign (the "this bit again" problem):** today's meeting is a
fixed slide template cloned daily plus a 12-week lesson loop that repeats — identical
structure, identical delivery, one host broadcasting. Design direction:

1. **Yesterday is the spine.** The meeting is assembled from what actually happened —
   improvements with names, a surprising number, an Andon story, a before/after
   photo. The factory never repeats, so the meeting can't either. The lesson is the
   garnish, not the spine.
2. **Rotating hosts.** Everyone leads on rotation (the 2 Second Lean practice). The
   existing three-page host prep mode (explanation / what to show / how to deliver)
   is the enabler; the system picks tomorrow's host from Planday and hands them
   their prep pages the afternoon before. Teaching is the deepest learning and the
   cure for non-utilised talent.
3. **Concepts repeat; formats don't.** Each pass at a concept uses a different
   delivery: story, spot-the-waste photo, guess-the-number game, myth-vs-fact,
   60-second challenge, quiz. The curriculum spirals upward (recognise → find it in
   your station → teach it) instead of looping flat.
4. **The Daily Two carries the teaching load** (see above), so the meeting shrinks to
   what a group is for: celebrate (by name), connect (one round-robin question), aim
   (today's one focus). Short and participatory beats long and thorough.
5. **Auto-drafted lessons from live data:** the existing AI lesson generator is
   pointed at yesterday's events (23 wonkies → today's 90 seconds is defects, with
   our own number on the slide).

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

### The business

#### Objective I — Founder command centre: focus, profit, and foresight

A distinct-but-integrated part of the tool: the founder's daily operating system and
the business's intelligence layer.

1. **Daily focus:** the Founder Focus page is the founder's daily planner —
   objectives, tasks, and schedule in one place, connected to the rest of the system
   (issues awaiting decisions, approvals pending, compliance flags) rather than a
   standalone to-do list.
2. **A robust profit tracker:** the most important numbers in the business —
   revenue, margin, costs, waste — assembled from live data the system already owns
   (Shopify sales, recipe cost/margin engine, labour, purchase orders) rather than
   re-keyed into spreadsheets.
3. **An intelligent forecaster:** predictions about the future (sales, cash impact,
   profit trajectory) built on recent live data — with the same explainability rule
   as everything else: every prediction can show its inputs.
4. **Recommendations, not just readouts:** the system suggests what would move the
   needle ("margin on X dropped 4pts since the cheese price change — candidates:
   re-price, re-spec, or push Y instead") — and those recommendations are traceable
   to the numbers behind them.
5. **Integrations in service of this:** Shopify (sales and sell-through — already
   integrated), Klaviyo (marketing/email performance connected to sales outcomes),
   and the internal P&L data. Marketing activity and its revenue effect should be
   visible in one place.

**Success measure:** the founder opens one page each morning and knows the state of
the business, what's at risk, and the highest-leverage action available — without
assembling it by hand from five sources.

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
- **Founder Focus, P&L tooling, Shopify & Klaviyo integrations** — the founder
  command centre and its data feeds (I).
- **Morning meetings** — the lean cadence carrier, per the Objective E redesign (E).

## 4. Peripheral modules

The codebase also carries: surveys/marketing campaigns, employee hub, visitor log,
onboarding.

Some of these earn their keep (e.g. visitor log is a SALSA site-security record;
surveys may fold into the Klaviyo/marketing loop under Objective I) — but they are
**not** allowed to:

- add coupling to the core loop's data model,
- slow down or complicate changes to core-loop code,
- compete for the same screens/navigation the production team uses daily.

Default posture: freeze feature work on these unless they directly serve objectives
A–I; extract or remove any that create drag (see the companion codebase analysis).

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

- Daily operational issues get logged against an objective (A–I) and fixed at the
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
- Atomise the existing 12-week lean curriculum into ~60 daily micro-lesson cards
  with TCK-specific examples (Objective E — Claude to draft for Graeme's review).
