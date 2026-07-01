/**
 * Seeds the rolling 12-week Two Second Lean curriculum that drives the
 * Morning Meeting "Learning" slide. Topics are aligned to Paul Akers'
 * Two Second Lean (8 wastes via DOWNTIME, 3S rather than 5S, kaizen as a
 * daily habit). Each lesson carries three markdown blocks so the host
 * can be taught the topic before they teach the team:
 *   - explanation_md → what it means (Page 1 of prep mode)
 *   - what_to_show_md → what the team sees on the slide (Page 2)
 *   - delivery_notes_md → talking points / discussion prompts (Page 3)
 *
 * Seeded once on startup. Re-runs are safe — ON CONFLICT DO NOTHING
 * keeps any admin edits intact.
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

interface LessonSeed {
  weekNumber: number;
  title: string;
  summary: string;
  explanationMd: string;
  whatToShowMd: string;
  deliveryNotesMd: string;
}

const LESSONS: LessonSeed[] = [
  {
    weekNumber: 1,
    title: "What is Two Second Lean?",
    summary: "Fix what bugs you. Two seconds at a time. Every day.",
    explanationMd: `Paul Akers (FastCap) built a lean culture by making one rule: **fix what bugs you, two seconds at a time, every day.**

You don't need a black belt. You don't need a project plan. You just notice friction in your work — a tool you fumble for, a step you do twice, something messy you walk past — and you remove it. Two seconds is the unit because anyone can find two seconds.

The magic is **frequency, not size.** One operator × one tiny fix × every shift × every operator = a transformed kitchen in three months.`,
    whatToShowMd: `**Two Second Lean = fix what bugs you, every day.**

- Anyone can do it
- Tiny improvements > big projects
- Daily > occasional
- Film a quick before/after when you do one`,
    deliveryNotesMd: `**Talking points:**
- Share something that's been bugging YOU this week. Be honest.
- Ask: "What bugs you in your own role?" Get one answer from each station.
- The improvement doesn't have to be glamorous — moving a bin 30cm counts.

**Prompt:** "Pick one thing today. Fix it. Tell us tomorrow what you did."`,
  },
  {
    weekNumber: 2,
    title: "The 8 Wastes — DOWNTIME",
    summary: "Defects, Overproduction, Waiting, Non-utilised talent, Transportation, Inventory, Motion, Excess processing.",
    explanationMd: `Lean has eight categories of waste. Memorise them with **DOWNTIME**:

- **D**efects — making something wrong, having to remake or scrap it
- **O**verproduction — making more than the customer ordered today
- **W**aiting — staff or product waiting on something else
- **N**on-utilised talent — people's ideas not being used
- **T**ransportation — moving product more than needed
- **I**nventory — too much raw, WIP, or finished sitting around
- **M**otion — people walking, reaching, bending unnecessarily
- **E**xcess processing — doing more to the product than the customer values`,
    whatToShowMd: `**8 Wastes — DOWNTIME**

| | |
|---|---|
| **D**efects | making it wrong |
| **O**verproduction | making more than ordered |
| **W**aiting | staff or product idle |
| **N**on-utilised talent | ideas not used |
| **T**ransportation | moving product around |
| **I**nventory | too much sitting around |
| **M**otion | unnecessary steps, reaches |
| **E**xcess processing | doing more than needed |`,
    deliveryNotesMd: `**Talking points:**
- Walk through each waste with a kitchen example as you go.
- Defects → a calzone that splits in the oven and gets binned.
- Motion → walking to the sauce fridge ten times a shift.
- Non-utilised talent is the big one — operators see everything.

**Prompt:** "Which of these eight do you see most often? Where?"`,
  },
  {
    weekNumber: 3,
    title: "3S — Sweep",
    summary: "Daily clean-as-you-go. Abnormal becomes obvious.",
    explanationMd: `Two Second Lean uses **3S** — Sweep, Sort, Standardise. Drop the last two of traditional 5S; they slow you down.

**Sweep is daily.** A clean workspace makes abnormal jump out. If the bench is always clean and one day there's flour on it, you investigate. If the bench is always grubby, you can't see anything.

Sweep is not deep-cleaning. It's the **two-minute reset** at the end of every task. It's the wipe between batches. It's the broom-pass when you finish your shift.`,
    whatToShowMd: `**Sweep — first S of 3S**

- Daily, not weekly
- 2-minute reset after each task
- Clean = abnormal stands out
- Not the same as deep clean — that's separate

**Today's question:** when did you last sweep your station?`,
    deliveryNotesMd: `**Talking points:**
- Difference between Sweep and Deep Clean — Sweep is between tasks.
- A messy station hides every problem.
- We should never end a shift on a dirty bench.

**Prompt:** "Walk to your station after this meeting. What needs sweeping right now?"`,
  },
  {
    weekNumber: 4,
    title: "3S — Sort",
    summary: "A home for every tool. Shadow boards, kanban, visible storage.",
    explanationMd: `Sort = **a clearly-marked home for everything, and nothing without a home.**

If a tool doesn't have a labelled spot, it floats around. Floating tools are lost tools. Lost tools = motion waste + frustration + sometimes safety risks.

The acid test: **can a new starter find any tool in 30 seconds without asking?** If not, you haven't Sorted.

Shadow boards, labelled drawers, colour-coded bins, kanban cards — all variations on the same idea: visible, unambiguous, obvious.`,
    whatToShowMd: `**Sort — second S of 3S**

- One home for every tool
- Labelled, visible, obvious
- New starter finds anything in 30 seconds
- No home → no place → it floats and gets lost

**Today's question:** what tool did you hunt for yesterday?`,
    deliveryNotesMd: `**Talking points:**
- Ask the team: which tool do you hunt for most?
- Shadow boards work because empty silhouettes shout "missing!"
- Sort applies to ingredients too — same shelf, same place, same time.

**Prompt:** "One thing this week — give one tool its proper home."`,
  },
  {
    weekNumber: 5,
    title: "3S — Standardise",
    summary: "The best way, written down, followed by everyone.",
    explanationMd: `Standardise = the **current best-known way** to do something, captured so everyone does it the same.

Without a standard, every operator invents their own method. Variation creeps in. Quality wobbles. New starters don't know what "good" looks like.

A standard isn't a rule for life — it's the **floor for improvement**. You can only improve from a known starting point. Today's standard is tomorrow's "old way" because someone found something better.

In the kitchen this is the SOP. Read it. Follow it. If you find a better way, change the SOP — don't just freelance.`,
    whatToShowMd: `**Standardise — third S of 3S**

- The current best way
- Captured (SOP, video, photo)
- Followed by everyone the same
- The floor for the next improvement

**Today's question:** when did you last read the SOP for your station?`,
    deliveryNotesMd: `**Talking points:**
- A standard isn't permanent — it's the baseline.
- Improving means changing the standard, not ignoring it.
- The worst case is "everyone does it slightly differently."

**Prompt:** "Pick the SOP that's most out of date. Tell me which one — I'll get it updated."`,
  },
  {
    weekNumber: 6,
    title: "Before & After",
    summary: "Film one improvement. 30 seconds. Share it.",
    explanationMd: `Paul Akers preaches **before-and-after videos** as the engine of lean culture. Why?

- Forces you to **finish** the improvement (you can't film "halfway done")
- Makes the improvement **visible** to everyone, not just the person who made it
- Builds the **muscle of noticing** — once you film one, you spot the next ten
- Creates a library of "this is how we improve here"

Format: 10 seconds of BEFORE (show the problem) + 10 seconds of AFTER (show the fix) + one sentence on what you learned.`,
    whatToShowMd: `**Before & After videos**

- 30 seconds total
- Show the problem, show the fix
- One sentence: what you learned
- Post in the team chat / pin in the office

Anyone, any improvement, any day.`,
    deliveryNotesMd: `**Talking points:**
- Show a before-and-after video if anyone has filmed one this week.
- If no one has — pick one improvement that happened recently and demo what filming would look like.
- The point isn't the video quality. It's the habit.

**Prompt:** "Whoever makes the first improvement this week — film it on your phone, send it to the team chat."`,
  },
  {
    weekNumber: 7,
    title: "Kaizen as a habit",
    summary: "Small daily improvements beat occasional big projects.",
    explanationMd: `**Kaizen** is Japanese for "change for the better." But it's not "big projects" — it's **small, continuous improvements made by the people doing the work.**

The maths is brutal: 1% better every day = **38× better in a year.** That's not a typo. Compound improvement is the most powerful force in any business.

But it only works if everyone improves a little, every day. One person making twelve big improvements a year is fine. Twelve people making one tiny improvement every shift is transformational.`,
    whatToShowMd: `**Kaizen = continuous improvement**

- Small + daily > big + occasional
- 1% per day = 38× in a year
- Done by the people doing the work
- No idea is too small

**This week's challenge:** one improvement, from every station, every day.`,
    deliveryNotesMd: `**Talking points:**
- 1% better each day compounds insanely fast — write 1.01^365 on a board if you have one.
- Big improvement projects are great but rare. Tiny ones are everyone's job.
- Every station should log one improvement this week.

**Prompt:** "Tell me one thing you'd improve at your station if you had 5 minutes today."`,
  },
  {
    weekNumber: 8,
    title: "5 Whys",
    summary: "Don't stop at the first cause. Ask Why five times.",
    explanationMd: `When something goes wrong, the obvious cause is rarely the real cause. **The 5 Whys** is a discipline: ask "Why?" five times in a row to drill past symptoms to the root.

**Example:**
1. Why did the calzone split in the oven? → Too much filling.
2. Why too much filling? → Operator filled by eye, no scale.
3. Why no scale? → It was being used on the other table.
4. Why only one scale? → We bought one and never noticed we needed two.
5. Why didn't we notice? → No one logs splits as a quality issue.

Root cause = no scale at table 2 + no logging. Two fixes, not "tell operators to fill less."`,
    whatToShowMd: `**5 Whys — finding root cause**

Ask "Why?" five times, follow the chain.

Example:
1. Why did it break? → Overfilled
2. Why? → No scale
3. Why? → Scale used elsewhere
4. Why? → Only one scale
5. Why? → No one logs this

**Root cause ≠ the first answer.**`,
    deliveryNotesMd: `**Talking points:**
- Pick a real recent issue from the Struggles slide and walk through 5 Whys live.
- Don't accept the first answer. Push.
- The fifth Why is usually a system / process, not a person.

**Prompt:** "Next time something goes wrong, before you fix it — five Whys. Then fix the real cause."`,
  },
  {
    weekNumber: 9,
    title: "Visual management",
    summary: "Can a stranger tell at a glance if everything's okay?",
    explanationMd: `Visual management means **the state of the system is obvious without asking anyone.** Walk in. Look around. Know.

- **Kanban cards** — empty space tells you to order more
- **Andon lights** — red means a problem, green means flowing
- **Shadow boards** — empty silhouette means missing tool
- **Daily dashboards** — yesterday's targets vs actuals on the wall
- **WIP shelves with quantity markings** — "minimum 5, maximum 20"

The test: a manager comes back from holiday. Can they tell within 60 seconds where the problems are without speaking to anyone? If yes, your visual management works.`,
    whatToShowMd: `**Visual management**

- State of the system, obvious at a glance
- Kanban, andon, shadow boards, dashboards
- No need to ask "how are we doing?"

**Test:** could a stranger tell what's going well and what isn't in 60 seconds?`,
    deliveryNotesMd: `**Talking points:**
- Walk through what's already visual in the kitchen (production plan board, kanban cards, etc.).
- Ask: "What's NOT visual that should be?"
- Hidden problems are the worst problems.

**Prompt:** "If you had to make ONE thing more visible, what would it be?"`,
  },
  {
    weekNumber: 10,
    title: "Mistake-proofing (poka-yoke)",
    summary: "Make the error impossible, not just unlikely.",
    explanationMd: `**Poka-yoke** = mistake-proofing. The idea is to design the work so the mistake **can't happen**, not just that it's less likely.

- USB plugs only go in one way → can't insert wrong
- Petrol vs diesel pump nozzles are different sizes → can't fill wrong
- A jig that only fits the correct way → can't assemble wrong

In the kitchen: a portioning scoop that's exactly one portion (can't over-fill). A bin labelled with the recipe colour (can't mix). A timer that buzzes when a step is overdue.

Beats "training people harder" every time. People get tired. Designs don't.`,
    whatToShowMd: `**Poka-yoke — mistake-proofing**

- Make the error physically impossible
- Don't rely on "be careful"
- Examples: USB plugs, fuel nozzles, jigs, colour codes

**Kitchen examples:**
- Portion scoop = exactly one portion
- Colour-coded bins per recipe
- Timer alarms for overdue steps`,
    deliveryNotesMd: `**Talking points:**
- "Be more careful" is not an improvement.
- Design out the error.
- Anytime you say "the operator should remember..." that's a poka-yoke opportunity.

**Prompt:** "Where do we currently rely on people remembering? Pick one — let's design the mistake out."`,
  },
  {
    weekNumber: 11,
    title: "Standard work + leader standard work",
    summary: "The host's own job is standardised too. Daily, weekly, monthly.",
    explanationMd: `**Standard work** for operators = the SOP. **Leader standard work** is the same thing for the host / manager: a documented routine of what they do and when.

- Daily: walk the floor, run the morning meeting, check yesterday's KPIs, action one improvement
- Weekly: review the andon log, talk to every operator one-on-one, update SOPs
- Monthly: deep review of recurring problems, refresh visual boards

Without it, the leader fights fires all day. With it, the system runs and the leader spots the trends.`,
    whatToShowMd: `**Leader standard work**

The host's job is standardised too.

- **Daily:** floor walk, morning meeting, KPI check, action one improvement
- **Weekly:** andon review, 1-on-1s, SOP updates
- **Monthly:** trends, board refresh

If it's not scheduled, it doesn't happen.`,
    deliveryNotesMd: `**Talking points:**
- It's not just operators who need standards. Leaders do too.
- If the leader can't say what they're doing this hour, things will drift.
- A consistent host = a consistent team.

**Prompt:** "What should be on the host's daily checklist? Tell me what I should be doing every day for you."`,
  },
  {
    weekNumber: 12,
    title: "Respect for people",
    summary: "Everyone an improver. No blame. Log the idea.",
    explanationMd: `The deepest principle in Toyota's lean is **respect for people.** Two practical meanings:

1. **The people doing the work know it best.** Their ideas are first-class. Not "suggestions for management to consider" — improvements they make and you support.
2. **Blame is wasted energy.** When something goes wrong, the question is "what in the system let this happen?" not "who screwed up?" Punish people for mistakes and you'll never hear about the next ten.

A lean kitchen is one where the operator who finds a problem says it out loud, knows it'll get logged, and trusts something will happen. The opposite is a kitchen where everyone hides issues because raising one means trouble.`,
    whatToShowMd: `**Respect for people**

- Operators know the work best — their ideas count
- No blame — investigate the system, not the person
- Surfacing a problem is a win, not a complaint
- Every idea logged, every improvement actioned

A lean culture is a **safe-to-speak** culture.`,
    deliveryNotesMd: `**Talking points:**
- Thank anyone who raised a struggle this week — by name.
- Make it clear: mistakes get investigated, not punished.
- The biggest waste is silence — ideas that never get heard.

**Prompt:** "If you saw a problem tomorrow, would you raise it? Why or why not? What would help?"`,
  },
];

interface ExampleSeed {
  orderPosition: number;
  title: string;
  summary: string;
  explanationMd: string;
  whatToShowMd: string;
  deliveryNotesMd: string;
}

/**
 * Five daily angles on the same weekly subject — 3S (Sweep, Sort,
 * Standardise). The Learning slide rotates these by weekday
 * (Mon→order 0 … Fri→order 4), so the subject is held for a full week
 * but each calendar day gets fresh content. Days 1–3 are the three Ss;
 * days 4–5 zoom out to why 3S works and how to make it a daily habit.
 */
const THREE_S_EXAMPLES: ExampleSeed[] = [
  {
    orderPosition: 0,
    title: "Monday — Sweep: the daily reset",
    summary: "Clean-as-you-go, every shift. A clean bench makes the abnormal obvious.",
    explanationMd: `**Sweep** is the first S — and it's *daily*, not weekly.

A clean workspace makes abnormal jump out. If the bench is always clean and one day there's flour on it, you investigate. If the bench is always grubby, you can't see anything.

Sweep is not deep-cleaning. It's the **two-minute reset** at the end of every task — the wipe between batches, the broom-pass when you finish your shift.`,
    whatToShowMd: `**Sweep — first S of 3S**

- Daily, not weekly
- 2-minute reset after each task
- Clean = abnormal stands out
- Not the same as deep clean — that's separate

**Today's question:** when did you last sweep your station?`,
    deliveryNotesMd: `**Talking points:**
- Sweep is between tasks; deep clean is separate.
- A messy station hides every problem.
- We should never end a shift on a dirty bench.

**Prompt:** "Walk to your station after this meeting. What needs sweeping right now?"`,
  },
  {
    orderPosition: 1,
    title: "Tuesday — Sort: a home for everything",
    summary: "A clearly-marked home for every tool, and nothing without a home.",
    explanationMd: `**Sort** = a clearly-marked home for everything, and nothing without a home.

If a tool doesn't have a labelled spot, it floats around. Floating tools are lost tools — that's motion waste, frustration, and sometimes a safety risk.

The acid test: **can a new starter find any tool in 30 seconds without asking?** If not, you haven't Sorted. Shadow boards, labelled drawers, colour-coded bins — all the same idea: visible, unambiguous, obvious.`,
    whatToShowMd: `**Sort — second S of 3S**

- One home for every tool
- Labelled, visible, obvious
- New starter finds anything in 30 seconds
- No home → it floats and gets lost

**Today's question:** what tool did you hunt for yesterday?`,
    deliveryNotesMd: `**Talking points:**
- Ask: which tool do you hunt for most?
- Shadow boards work because empty silhouettes shout "missing!"
- Sort applies to ingredients too — same shelf, same place, same time.

**Prompt:** "One thing today — give one tool its proper home."`,
  },
  {
    orderPosition: 2,
    title: "Wednesday — Standardise: the best-known way",
    summary: "Capture the current best way so everyone does it the same.",
    explanationMd: `**Standardise** = the current best-known way to do something, captured so everyone does it the same.

Without a standard, every operator invents their own method. Variation creeps in, quality wobbles, and new starters don't know what "good" looks like.

A standard isn't a rule for life — it's the **floor for improvement**. You can only improve from a known starting point. In the kitchen this is the SOP: read it, follow it, and if you find a better way, change the SOP — don't just freelance.`,
    whatToShowMd: `**Standardise — third S of 3S**

- The current best way
- Captured (SOP, video, photo)
- Followed by everyone the same
- The floor for the next improvement

**Today's question:** when did you last read the SOP for your station?`,
    deliveryNotesMd: `**Talking points:**
- A standard isn't permanent — it's the baseline.
- Improving means changing the standard, not ignoring it.
- The worst case is "everyone does it slightly differently."

**Prompt:** "Pick the SOP that's most out of date. Tell me which one — I'll get it updated."`,
  },
  {
    orderPosition: 3,
    title: "Thursday — Why 3S, not 5S",
    summary: "Two Second Lean drops the last two Ss. Make problems visible, fast.",
    explanationMd: `Traditional lean teaches **5S**. Two Second Lean deliberately uses **3S** — Sweep, Sort, Standardise — and drops the last two, because they add bureaucracy that slows a small team down.

The whole point of 3S is **visual control**: a workspace so clean and organised that anything out of place screams at you. You don't need a clipboard audit to spot a problem — you can *see* it.

3S isn't about tidiness for its own sake. It's about making waste and abnormality impossible to miss, so they get fixed in seconds.`,
    whatToShowMd: `**Why 3S, not 5S?**

- Sweep · Sort · Standardise — that's it
- The last two Ss add bureaucracy
- Goal = make problems *visible*, not paperwork
- See the problem → fix it in seconds

**Today's question:** what could you *see* go wrong faster if your area was cleaner?`,
    deliveryNotesMd: `**Talking points:**
- 3S is about visual control, not just tidiness.
- A clean, sorted area is a problem-detector.
- Keep it light — no audits, no clipboards.

**Prompt:** "Name one spot in the kitchen where a problem could hide today. What would make it obvious?"`,
  },
  {
    orderPosition: 4,
    title: "Friday — 3S as a daily habit",
    summary: "3S only works if it's a rhythm, not a one-off blitz.",
    explanationMd: `3S fails when it's a one-off spring clean. It works when it's a **daily rhythm** woven into normal work.

Sweep between tasks. Return every tool to its home before you move on. Follow the standard, and tweak it the moment you find better. None of these are extra jobs — they're *how* the job is done.

The test of a 3S culture isn't how it looks right after a deep clean. It's how it looks at 2pm on a busy Wednesday. If it still holds, the habit is real.`,
    whatToShowMd: `**3S as a daily habit**

- Not a one-off blitz — a daily rhythm
- Sweep between tasks, sort as you go, follow the standard
- It's *how* we work, not extra work
- The real test: how does it look mid-shift on a busy day?

**Today's question:** which of the 3 Ss slips first when we get busy?`,
    deliveryNotesMd: `**Talking points:**
- Pull this week together — Sweep, Sort, Standardise as one habit.
- Busy days are the real test, not deep-clean days.
- Small and constant beats big and occasional.

**Prompt:** "Pick the one S you'll personally hold this week even when it's busy."`,
  },
];

/**
 * Curriculum expansion — a deep bench of lean lessons so the daily
 * rotation runs for months before anything repeats. Each entry becomes
 * one principle (weekPosition) carrying a single example with the same
 * three-block content shape as the originals. Drawn from Two Second Lean
 * (Paul Akers) and Lean Made Simple (Ryan Tiani), all grounded in the
 * kitchen. Seeded idempotently in Step 2e — ON CONFLICT (week_position)
 * leaves any admin edits intact.
 */
const ADDITIONAL_LESSONS: LessonSeed[] = [
  {
    weekNumber: 14,
    title: "Total Ownership",
    summary: "It's mine to sort. No \"not my job\", no waiting to be told.",
    explanationMd: `In **Lean Made Simple**, Ryan Tiani puts *total ownership* at the heart of a lean culture: when you see a problem, **it becomes yours** — to fix, or to make sure the right person does.

The opposite is "that's not my job." A spill someone walks past. An empty roll of labels no one flags. A dull knife passed to the next shift. Each one is a small refusal to own.

Ownership isn't about blame — it's the opposite. It means **you don't wait for permission** to make things better. You see it, you own it, you act or you escalate. A kitchen where everyone owns everything has no cracks for problems to fall through.`,
    whatToShowMd: `**Total Ownership — it's mine to sort**

- See a problem → it's now *yours*
- Fix it, or make sure the right person does
- No "not my job", no waiting to be told
- Ownership ≠ blame — it's permission to act

**Today's question:** what did you walk past yesterday that you could have owned?`,
    deliveryNotesMd: `**Talking points:**
- Tell a story of someone here who owned something that wasn't strictly theirs.
- "Not my job" is one of the most expensive sentences in any kitchen.
- Owning a problem can just mean flagging it loudly — escalation is ownership too.

**Prompt:** "Name one thing in the building that currently belongs to nobody. Who'll own it?"`,
  },
  {
    weekNumber: 15,
    title: "Go and See — the Gemba",
    summary: "The truth is on the floor, not in the office. Go look.",
    explanationMd: `**Gemba** means "the real place" — where the work actually happens. Lean says the best decisions are made *there*, watching the real thing, not guessing from a desk or a spreadsheet.

If a step is slow, don't theorise — stand at the bench and watch it run three times. You'll see the truth in minutes: the reach that's too far, the fridge door that sticks, the queue that builds at the ovens.

Going to the gemba also shows respect: it says *I trust what you see doing this job every day.*`,
    whatToShowMd: `**Go and See — the Gemba**

- Gemba = "the real place", where work happens
- Don't guess from the office — go and watch
- Watch a step run 2-3 times; the waste shows itself
- It respects the people doing the work

**Today's question:** what problem are we *guessing* about that we could just go and watch?`,
    deliveryNotesMd: `**Talking points:**
- The answer to most "why is this slow?" questions is visible in 5 minutes of watching.
- Managers who never leave the office make decisions on stale information.
- Invite the team: pull me to the gemba any time something looks off.

**Prompt:** "Pick one slow step. Who'll go and watch it run today?"`,
  },
  {
    weekNumber: 16,
    title: "Customer-Defined Value",
    summary: "Value is only what the customer would happily pay for. The rest is waste.",
    explanationMd: `Lean starts with one brutal question: **what would the customer actually pay for?** That — and only that — is *value*. Everything else is waste, even if it feels like work.

The customer pays for a perfect calzone, well-made, on time. They do **not** pay for us walking to the far fridge ten times, re-stacking trays, or remaking a split one.

This reframes every task. Before you do something, ask: *does this add what the customer values, or am I just busy?* Busy isn't the same as valuable.`,
    whatToShowMd: `**Customer-Defined Value**

- Value = what the customer would gladly pay for
- A perfect calzone, on time — yes
- Walking, re-stacking, remakes — no (that's waste)
- Busy ≠ valuable

**Today's question:** name one thing you do daily that the customer would *not* pay for.`,
    deliveryNotesMd: `**Talking points:**
- Most of a working day is non-value steps — that's normal, and it's the gold to go after.
- The point isn't to work harder, it's to cut the steps the customer doesn't value.
- Quality the customer can taste = value. Effort they can't = candidate for the bin.

**Prompt:** "If the customer watched your station for an hour, which bits would make them think 'why are they doing that?'"`,
  },
  {
    weekNumber: 17,
    title: "One-Piece Flow",
    summary: "Move one at a time, finished, rather than big batches that pile up.",
    explanationMd: `**Flow** means work moves smoothly from step to step with as little waiting as possible. The ideal is **one-piece flow** — one item moving through, complete, rather than huge batches sitting between stations.

Big batches *feel* efficient — "I'll fill fifty, then build fifty." But batches hide problems (you don't spot a fault until item 50), create piles of half-done work, and clog the bench.

Smaller batches mean problems show up fast, less work-in-progress sits around, and the line keeps moving instead of lurching.`,
    whatToShowMd: `**One-Piece Flow**

- Move work step-to-step, not in big piles
- Big batches *feel* fast but hide faults
- Smaller batches → problems show up sooner
- Less half-done work clogging the bench

**Today's question:** where do we build the biggest pile of half-finished work?`,
    deliveryNotesMd: `**Talking points:**
- Batch of 50 = you find the fault on number 50, after making 50 wrong.
- Piles between stations are inventory waste — and they hide the queue building up.
- We won't go to a literal batch of one, but smaller and steadier beats big and lumpy.

**Prompt:** "Where does product pile up waiting for the next step? Could that pile be smaller?"`,
  },
  {
    weekNumber: 18,
    title: "Pull, Not Push",
    summary: "Make what the next step actually needs, when it needs it — not what's easy to push.",
    explanationMd: `In a **push** system, each station makes as much as it can and shoves it downstream. In a **pull** system, you only make what the next step is **ready to take**.

Push creates piles: a station races ahead, and product stacks up waiting at the next bench, going cold or getting in the way. Pull keeps the whole line in step — you produce to the real signal of demand, not to "keeping busy."

A kanban card is a pull signal: empty space says "make more," full says "stop." Pull stops us drowning the next station in work it can't use yet.`,
    whatToShowMd: `**Pull, Not Push**

- Push = make all you can, shove it downstream
- Pull = make only what the next step is ready for
- Push builds piles; pull keeps the line in step
- The signal to make = real demand, not "look busy"

**Today's question:** where do we push product onto a station that isn't ready for it?`,
    deliveryNotesMd: `**Talking points:**
- Racing ahead at your station can actually slow the whole line by burying the next one.
- "I was being productive" can still create waste if it's the wrong thing at the wrong time.
- Kanban cards are pull in action — make to the empty space, not to a guess.

**Prompt:** "Where does one station get ahead and bury the next? How would we signal 'ready'?"`,
  },
  {
    weekNumber: 19,
    title: "Just-in-Time",
    summary: "The right thing, in the right amount, exactly when it's needed.",
    explanationMd: `**Just-in-Time (JIT)** is making or supplying exactly what's needed, in the amount needed, at the moment it's needed — no sooner, no more.

Make too early and you get piles of work-in-progress and stock tying up space and going off. Make too late and the line stalls. JIT is the narrow path between the two.

In the kitchen it's marinades ready as building starts, dough sheeted just ahead of building, ingredients pulled for today's plan — not a fridge full of "just in case" that turns into waste.`,
    whatToShowMd: `**Just-in-Time**

- Right thing, right amount, right moment
- Too early → piles, stock going off
- Too late → the line stalls
- The aim: smooth supply, minimal "just in case"

**Today's question:** what do we prep too early and end up wasting?`,
    deliveryNotesMd: `**Talking points:**
- "Just in case" is comforting but it's inventory waste — and it hides real demand.
- JIT only works if the upstream step is reliable, so it drives quality too.
- We're not chasing zero stock — we're chasing *no waste from making too early*.

**Prompt:** "Where do we make 'just in case' and bin the leftovers? Could we make it later?"`,
  },
  {
    weekNumber: 20,
    title: "Takt Time — the pace of demand",
    summary: "The heartbeat the kitchen should run to, set by what the customer needs.",
    explanationMd: `**Takt time** is the steady pace you'd need to run at to exactly meet demand — total time available ÷ how many you need to make. It's the kitchen's **heartbeat**.

If we need 240 calzones in an 8-hour day, that's one every 2 minutes. Run faster and you build piles ahead of the next step; slower and you fall behind dispatch.

Knowing the takt turns "are we doing okay?" into a clear number. You can glance at the clock and the count and instantly know if you're ahead, behind, or bang on pace.`,
    whatToShowMd: `**Takt Time — the pace of demand**

- Takt = time available ÷ units needed
- It's the kitchen's heartbeat
- Faster → piles; slower → behind dispatch
- Turns "are we okay?" into a number

**Today's question:** do you know the pace your station needs to hit today?`,
    deliveryNotesMd: `**Talking points:**
- Work out today's takt out loud: target ÷ hours = one every X minutes.
- Running ahead of takt isn't winning if it buries the next station.
- A visible count vs. clock lets anyone see the pace at a glance.

**Prompt:** "What's today's target, and what pace does that mean per hour?"`,
  },
  {
    weekNumber: 21,
    title: "Muda, Mura, Muri — the three enemies",
    summary: "Waste, unevenness, and overburden. Beat all three, not just waste.",
    explanationMd: `Lean fights **three** enemies, not one:

- **Muda** — waste: anything the customer wouldn't pay for (the 8 wastes).
- **Mura** — unevenness: a frantic morning then a dead afternoon; lumpy, stop-start work.
- **Muri** — overburden: people or equipment pushed too hard, which causes breakdowns and mistakes.

They feed each other. **Mura** (a lumpy plan) creates **muri** (a mad rush to catch up), which creates **muda** (mistakes, remakes, injuries). Smooth the unevenness and a lot of the waste and strain vanish on their own.`,
    whatToShowMd: `**The three enemies**

| | |
|---|---|
| **Muda** | waste — what the customer won't pay for |
| **Mura** | unevenness — lumpy, stop-start work |
| **Muri** | overburden — people/kit pushed too hard |

Mura → Muri → Muda. They feed each other.

**Today's question:** which one bites us hardest — waste, unevenness, or overburden?`,
    deliveryNotesMd: `**Talking points:**
- Most teams only chase muda (waste) and ignore the lumpiness that causes it.
- A peak-and-trough day is mura — and it's exhausting and error-prone.
- Smoothing the plan is often the biggest single win available.

**Prompt:** "When in the day do we go from dead to frantic? What makes it so lumpy?"`,
  },
  {
    weekNumber: 22,
    title: "PDCA — the improvement cycle",
    summary: "Plan a small change, Do it, Check what happened, Act on what you learned.",
    explanationMd: `**PDCA** is the loop behind every good improvement:

- **Plan** — decide a small change and what you expect.
- **Do** — try it, small and quick.
- **Check** — did it actually work? Look at the result honestly.
- **Act** — keep it and standardise, or bin it and try again.

Most failed "improvements" skip **Check** — we change something, assume it worked, and move on. PDCA forces honesty: did it really help, or did it just feel better? Then you go round again. Small loops, often.`,
    whatToShowMd: `**PDCA — the improvement cycle**

- **Plan** a small change + what you expect
- **Do** it, small and fast
- **Check** — did it really work?
- **Act** — keep & standardise, or try again

Round and round, small and often.

**Today's question:** what's an improvement we made but never *checked*?`,
    deliveryNotesMd: `**Talking points:**
- The skipped step is almost always Check — we assume, we don't measure.
- Small loops beat one big project — you learn faster and risk less.
- "Act" means lock in the win (standardise) so it doesn't slip back.

**Prompt:** "Pick one change we made recently. Did we ever check it actually worked?"`,
  },
  {
    weekNumber: 23,
    title: "A3 Thinking — one page to solve a problem",
    summary: "Background, problem, root cause, plan, check — all on one sheet.",
    explanationMd: `An **A3** is a single sheet of paper (the A3 size) used to think a problem all the way through: what's the background, what *exactly* is the problem, what's the root cause, what's the plan, and how will we know it worked.

The power isn't the paper — it's the **discipline of fitting it on one page.** You can't waffle. You're forced to be clear about the real problem and the real cause before jumping to a fix.

We don't need formal A3s every day, but the *thinking* applies to any struggle: define it sharply, find the root, plan, check.`,
    whatToShowMd: `**A3 Thinking**

One page, in order:
- Background → why it matters
- Problem → exactly what's wrong
- Root cause → the real why
- Plan → what we'll do
- Check → how we'll know it worked

**Today's question:** are we fixing symptoms because we never defined the real problem?`,
    deliveryNotesMd: `**Talking points:**
- Fitting it on one page kills waffle and forces clarity.
- Half the battle is stating the problem precisely — most are stated too vaguely.
- You don't need the form; you need the order: problem → cause → plan → check.

**Prompt:** "Take our biggest recurring struggle — can anyone state the *exact* problem in one sentence?"`,
  },
  {
    weekNumber: 24,
    title: "Quick Changeover (SMED)",
    summary: "Cut the time lost switching from one job to the next.",
    explanationMd: `**SMED** — Single-Minute Exchange of Die — is about slashing the time lost **switching** from one product or task to the next. Every changeover is time the line isn't producing.

The trick: split the switch into what you can prep **while the current job still runs** (external) versus what can only happen once you stop (internal). Move as much as possible to "while running." Have the next job's ingredients, trays and tools ready *before* you finish the current one.

A changeover that drops from 15 minutes to 3 is pure found time, every single switch.`,
    whatToShowMd: `**Quick Changeover (SMED)**

- Changeover = time the line isn't producing
- Prep what you can *while the current job runs*
- Only the unavoidable bit happens after you stop
- 15 min → 3 min = found time, every switch

**Today's question:** what's our slowest change-over between products?`,
    deliveryNotesMd: `**Talking points:**
- Watch a changeover: how much faffing could've been done beforehand?
- "Get the next job ready while this one finishes" is the whole secret.
- Small setup times let us run smaller batches — which helps flow too.

**Prompt:** "Which switch between jobs costs us most time? What could we set up in advance?"`,
  },
  {
    weekNumber: 25,
    title: "Jidoka — build quality in",
    summary: "Stop the moment something's wrong. Never pass a defect on.",
    explanationMd: `**Jidoka** means *automation with a human touch* — but its heart is simple: **stop the moment something goes wrong**, and don't pass a defect down the line.

The expensive mistake is carrying on. A split calzone built, wrapped, packed and dispatched costs ten times what it costs to catch at the bench. Quality is **built in at each step**, not inspected at the end.

So the rule is: if it's not right, stop. Fix it or flag it. A stopped line that surfaces a problem is cheaper than a flowing line quietly making scrap.`,
    whatToShowMd: `**Jidoka — build quality in**

- See something wrong → stop, don't pass it on
- Catch it at the bench, not at dispatch
- Quality is built in at each step, not inspected at the end
- A stop that surfaces a problem beats quiet scrap

**Today's question:** where do we currently pass on a "not quite right" and hope?`,
    deliveryNotesMd: `**Talking points:**
- A defect caught at the bench is pennies; caught by the customer it's the relationship.
- Stopping to fix feels like it slows us — it's far cheaper than the remake downstream.
- Build quality in: every station checks its own work before it moves on.

**Prompt:** "Where do we 'let it go and hope'? What would 'stop and fix' look like there?"`,
  },
  {
    weekNumber: 26,
    title: "Andon — pull the cord",
    summary: "Call for help the instant you hit a problem. Asking is strong, not weak.",
    explanationMd: `**Andon** is the signal a worker uses to say *"I've hit a problem, I need help — now."* On a Toyota line it's a cord you pull that lights a board and brings help running.

The deep idea: **surfacing a problem immediately is celebrated, not punished.** The worst thing isn't stopping for help — it's struggling in silence while scrap piles up or a small issue becomes a big one.

We have our own andon — the issue log, a shout to a manager. The culture matters more than the tool: *pulling the cord must always be the right call.*`,
    whatToShowMd: `**Andon — pull the cord**

- Hit a problem → signal for help *now*
- Surfacing problems early is celebrated
- Struggling in silence is the real failure
- Our andon = the issue log / shout a manager

**Today's question:** is it genuinely safe here to stop and shout for help?`,
    deliveryNotesMd: `**Talking points:**
- Thank anyone who raised an issue this week — by name.
- A problem flagged at minute one is tiny; flagged at minute sixty it's a crisis.
- If people don't pull the cord, ask why — usually they fear the reaction.

**Prompt:** "Last time something went wrong, did you feel able to stop and ask? What would help?"`,
  },
  {
    weekNumber: 27,
    title: "Heijunka — level the load",
    summary: "Spread the work evenly so the day isn't a rush then a lull.",
    explanationMd: `**Heijunka** means *levelling* — smoothing the work so it flows evenly instead of arriving in lumps. A level day is calmer, safer and produces better quality than a peak-and-trough one.

Unlevelled work — everything due at once, then nothing — forces overburden (muri) and waste (muda). People rush, mistakes creep in, equipment gets hammered, then sits idle.

Levelling can mean staggering when products start, mixing the order of jobs through the day, or smoothing how orders hit the bench — so the load is steady from open to close.`,
    whatToShowMd: `**Heijunka — level the load**

- Spread work evenly, no lumps
- Level day = calmer, safer, better quality
- Lumpy day = rush → mistakes → idle → repeat
- Stagger starts, mix the order, smooth the flow

**Today's question:** what time of day are we slammed, and what time are we idle?`,
    deliveryNotesMd: `**Talking points:**
- A flat, steady day beats a heroic morning and a dead afternoon.
- Levelling is often a planning change, not a working-harder change.
- Smoothing the peaks protects both people and equipment.

**Prompt:** "If we could move one job to a quieter part of the day, which would it be?"`,
  },
  {
    weekNumber: 28,
    title: "Kanban — the pull signal",
    summary: "A simple card or space that says 'make/order more' at exactly the right moment.",
    explanationMd: `A **kanban** is a simple visual signal that triggers replenishment: when stock drops to the card, you order or make more. No spreadsheets, no guessing — the card *is* the instruction.

It works because it's **visual and self-managing.** An empty space or a flipped card shouts "top me up" without anyone having to remember or calculate. It paces supply to real use (pull), not to a forecast.

We already use kanban for ordering. The same idea works anywhere: a min/max line on a shelf, a card behind the last tray — anything that makes "time to refill" obvious at a glance.`,
    whatToShowMd: `**Kanban — the pull signal**

- A card/space that says "make or order more"
- Visual + self-managing — no remembering
- Triggers on real use, not a forecast
- Empty space shouts "top me up"

**Today's question:** what do we run out of that a simple kanban would fix?`,
    deliveryNotesMd: `**Talking points:**
- Point at the kanban cards we already use — that's the principle in action.
- The best signal needs zero thinking: you just *see* it's time.
- It applies to tools and consumables, not just ingredients.

**Prompt:** "What do we keep running out of unexpectedly? Where would a card or min-line help?"`,
  },
  {
    weekNumber: 29,
    title: "Quality at the Source",
    summary: "Each person checks their own work, so no defect travels.",
    explanationMd: `**Quality at the source** means the person doing a step is responsible for getting it right *there* — not relying on a final inspector to catch problems at the end.

Inspection at the end is slow, expensive and demoralising: you've already built the fault into everything. Catching it at the source means one item, one moment, fixed before it spreads.

It also builds pride and ownership: *my station, my standard.* When everyone owns the quality of their own work, the whole line gets reliable — and the "final check" becomes a formality, not a safety net.`,
    whatToShowMd: `**Quality at the Source**

- Check your own work *as you do it*
- End-inspection is slow, costly, too late
- Catch a fault at one item, not after a hundred
- "My station, my standard"

**Today's question:** what do we currently rely on a *final* check to catch?`,
    deliveryNotesMd: `**Talking points:**
- A final inspector is a sign quality isn't built in upstream.
- Catching your own slip is quicker and cheaper than anyone downstream catching it.
- This is ownership made concrete — your work leaves your bench right.

**Prompt:** "What's one thing you could check at your own station before it moves on?"`,
  },
  {
    weekNumber: 30,
    title: "Lower the Water Level",
    summary: "Too much stock hides problems. Reduce it and the rocks appear.",
    explanationMd: `Picture a boat on water, with rocks below. The **water is your inventory** — raw stock, half-done work, buffers. High water hides the rocks (the problems). Everything looks fine because the piles cover for every hiccup.

Lower the water — carry less stock — and the rocks start to show: the unreliable supplier, the slow changeover, the step that keeps jamming. That's uncomfortable, but those rocks were always there. Now you can actually fix them.

So excess inventory isn't safety — it's a blindfold. Carefully lowering it is how you *find* the problems worth solving.`,
    whatToShowMd: `**Lower the Water Level**

- Inventory = water; problems = rocks beneath
- High stock hides every hiccup
- Lower it → the real problems surface
- Excess stock is a blindfold, not safety

**Today's question:** where do we keep a big buffer that's hiding a problem?`,
    deliveryNotesMd: `**Talking points:**
- Big buffers feel safe but they let real problems hide for months.
- Don't slash stock recklessly — lower it a bit, see what breaks, fix that.
- The discomfort of a surfaced problem is the point.

**Prompt:** "What pile do we keep 'just in case'? What problem might it be covering up?"`,
  },
  {
    weekNumber: 31,
    title: "The True Cost of Overproduction",
    summary: "Making more than today's order is the worst waste — it breeds all the others.",
    explanationMd: `Of the eight wastes, **overproduction** is the one lean treats as the worst — because it *creates* the others. Make more than the customer ordered today and you now have extra inventory, extra motion to store it, extra waiting, and often extra defects (it sits and spoils).

It's seductive because it feels productive — "we got ahead!" But ahead of *what*? Product no one ordered is just cost dressed up as achievement.

Make to today's actual plan. Getting ahead by making tomorrow's guess fills the fridge with risk, not value.`,
    whatToShowMd: `**The True Cost of Overproduction**

- Making more than ordered = the *worst* waste
- It breeds the others: inventory, motion, waiting, spoilage
- Feels productive — but ahead of *what*?
- Make to today's plan, not tomorrow's guess

**Today's question:** where do we make more than the order, just to feel ahead?`,
    deliveryNotesMd: `**Talking points:**
- "We got ahead" is only a win if someone actually ordered it.
- Overproduction is sneaky because it looks like hard work and good intentions.
- Every extra unit drags storage, handling and spoilage behind it.

**Prompt:** "Where do we make extra 'to be safe'? What does that extra actually cost us?"`,
  },
  {
    weekNumber: 32,
    title: "Servant Leadership",
    summary: "The leader's job is to clear the path so the team can do great work.",
    explanationMd: `In a lean culture the leader is **upside down**: not the person barking orders, but the person whose job is to **remove the obstacles** in the team's way and give them what they need to succeed.

The question a servant leader asks all day is *"what's stopping you doing great work, and how do I clear it?"* Broken kit, missing tools, an unclear plan, a daft process — the leader's job is to go and fix those.

It's not soft. It's demanding: it means the leader is accountable for the *conditions*, and the team is trusted with the *work*.`,
    whatToShowMd: `**Servant Leadership**

- Leader's job = clear the path, not bark orders
- Daily question: "what's stopping you, and how do I fix it?"
- Removes obstacles: kit, tools, unclear plans
- Accountable for *conditions*; team owns the *work*

**Today's question (for the host):** what's one obstacle I could clear for you today?`,
    deliveryNotesMd: `**Talking points:**
- Ask the room directly: what's slowing you that I should be fixing?
- A leader's best output is a team with nothing in their way.
- This flips "managing" from telling to enabling.

**Prompt:** "Tell me one thing that gets in your way most days. I'll own clearing it."`,
  },
  {
    weekNumber: 33,
    title: "The Daily Huddle",
    summary: "A short, sharp stand-up beats long meetings — exactly what we're doing now.",
    explanationMd: `The **daily huddle** — a short, standing meeting at the start of the day — is the engine of a lean culture. It's *this*: ten minutes to align on the plan, surface struggles, learn one thing, and say thanks.

Why daily and short? Because problems caught today are cheap; problems left a week are dear. And because a quick daily rhythm beats a long monthly meeting nobody remembers.

It only works if it stays **sharp**: start on time, keep it standing, keep it focused, finish on time. A huddle that drags becomes a thing people dread instead of value.`,
    whatToShowMd: `**The Daily Huddle**

- Short, standing, same time every day
- Align on the plan, surface struggles, learn, thank
- Daily + short beats long + occasional
- Problems caught today are cheap

**Today's question:** is this huddle sharp and useful, or does it drag?`,
    deliveryNotesMd: `**Talking points:**
- This meeting *is* the lesson — point at it.
- Ask honestly: what would make this 10 minutes more useful to you?
- Protect the format: on time, standing, focused, finished on time.

**Prompt:** "What's one thing we could change about this meeting to make it more useful?"`,
  },
  {
    weekNumber: 34,
    title: "Catchball — goals that go both ways",
    summary: "Pass goals and ideas back and forth until they're realistic and shared.",
    explanationMd: `**Catchball** is the lean way of setting goals: instead of targets thrown down from the top, a goal is **tossed back and forth** — leader to team to leader — like a ball, until it's both ambitious *and* realistic, and everyone genuinely owns it.

A target dictated from above gets nodded at and ignored. A target the team helped shape gets believed in. The "catch" is the team pushing back with reality from the floor — *that won't work because…, but this would.*

It's slower to set a goal this way. It's far faster to actually hit it.`,
    whatToShowMd: `**Catchball — goals both ways**

- Goals tossed back and forth, not thrown down
- Leader proposes → team reshapes → repeat
- Ends ambitious *and* realistic *and* owned
- Floor reality beats a number from above

**Today's question:** which of our targets did the floor actually help shape?`,
    deliveryNotesMd: `**Talking points:**
- A goal handed down is obeyed; a goal shaped together is believed.
- The team's pushback isn't resistance — it's the reality check that makes it work.
- Invite challenge to targets openly; that's the catch coming back.

**Prompt:** "Here's a target I'm thinking about — throw it back. What's wrong with it from where you stand?"`,
  },
  {
    weekNumber: 35,
    title: "Hansei — honest reflection",
    summary: "Look back honestly at what went wrong, without excuses, to do better.",
    explanationMd: `**Hansei** is honest reflection — the discipline of looking back at what didn't go well and owning it squarely, *even when things basically went fine.*

It's not beating yourself up, and it's not blame. It's the grown-up habit of saying "here's what I'd do differently" without excuses or defensiveness. Toyota does hansei even after a success — *especially* after a success, because that's when complacency creeps in.

A team that can reflect honestly improves fast. A team that explains away every problem is doomed to repeat it.`,
    whatToShowMd: `**Hansei — honest reflection**

- Look back honestly, own it, no excuses
- Not blame, not beating yourself up
- Do it even after things go *well*
- "Here's what I'd do differently"

**Today's question:** what went okay yesterday that could honestly have gone better?`,
    deliveryNotesMd: `**Talking points:**
- Model it: share something *you'd* do differently, plainly, no defensiveness.
- Reflecting after a good day is the real skill — that's when we get sloppy.
- Honest beats comfortable; excuses guarantee a repeat.

**Prompt:** "Think about yesterday. One thing you'd do differently — no excuses?"`,
  },
  {
    weekNumber: 36,
    title: "Coaching, Not Telling",
    summary: "Ask questions that help people see it themselves — it sticks far better.",
    explanationMd: `When someone hits a problem, the fast move is to **tell** them the answer. The lean move is to **coach** — ask the questions that help them work it out themselves.

Telling fixes today's problem and creates dependence. Coaching ("what do you think is causing it?", "what would you try?") builds someone who can solve the next ten problems without you. It's slower once, faster forever.

This isn't only for managers. Anyone showing a new starter the ropes can ask instead of dictate — and watch how much faster it sticks when they reach the answer themselves.`,
    whatToShowMd: `**Coaching, Not Telling**

- Telling = fast today, dependence tomorrow
- Coaching = ask questions, they work it out
- "What's causing it? What would you try?"
- Slower once, faster forever

**Today's question:** when did you last *tell* someone the answer you could have asked them toward?`,
    deliveryNotesMd: `**Talking points:**
- Telling feels efficient but it stops people thinking.
- A good question ("what would you try?") teaches; an answer just patches.
- New-starter training is the easiest place to practise asking over dictating.

**Prompt:** "Next time someone asks you 'what do I do?', try a question back. What would you ask?"`,
  },
  {
    weekNumber: 37,
    title: "Problems Are Treasure",
    summary: "A surfaced problem is a gift — it's the next improvement, found.",
    explanationMd: `Toyota has a saying: **"problems are treasure."** Every problem you can see is a chance to improve — a gift, not a failure. The danger isn't the problem you found; it's the ten you can't see.

This flips the instinct to hide mistakes. In a treasure culture, the person who surfaces a problem is the hero, because they've just handed everyone the next improvement. Hidden problems fester; surfaced ones get fixed.

So we *want* the struggles slide full. An empty problem log doesn't mean no problems — it usually means people have stopped telling us.`,
    whatToShowMd: `**Problems Are Treasure**

- A visible problem = the next improvement, found
- The danger is the problems you *can't* see
- Surfacing one makes you the hero, not the culprit
- An empty problem log = people stopped telling us

**Today's question:** what problem do you know about that we haven't written down?`,
    deliveryNotesMd: `**Talking points:**
- Reframe it out loud: finding a problem is winning, not losing.
- Thank the people who raised struggles — they handed us improvements.
- A quiet problem log is a warning sign, not a victory.

**Prompt:** "What's one problem you've noticed but never mentioned? Let's treasure it — what is it?"`,
  },
  {
    weekNumber: 38,
    title: "Batch Size of One",
    summary: "The smaller the batch, the faster problems show and the smoother the flow.",
    explanationMd: `The ideal batch in lean is **one** — make one, finish it, move it on. We rarely reach a literal one, but every step *toward* smaller batches pays off.

Big batches delay feedback (you find the fault late), tie up space and cash, and make the line lurch. Halve a batch and problems show up twice as fast, work flows more smoothly, and changeovers force you to get good at switching quickly (which is its own win).

So whenever you catch yourself thinking "I'll do a big run to be efficient," ask: would a smaller run actually flow better and surface problems sooner?`,
    whatToShowMd: `**Batch Size of One**

- Ideal batch = one; smaller is always closer
- Big batch → late feedback, piles, lurching
- Smaller batch → faster feedback, smoother flow
- "Big run = efficient" is often a trap

**Today's question:** where do we do a big run that a smaller one would flow better?`,
    deliveryNotesMd: `**Talking points:**
- The efficiency of a big batch is usually an illusion once you count the piles.
- Smaller batches are scary only if changeovers are slow — so fix those (see SMED).
- Find the fault at item 2, not item 200.

**Prompt:** "Where do we batch big 'for efficiency'? What would a smaller batch cost or save?"`,
  },
  {
    weekNumber: 39,
    title: "Spaghetti Diagrams — map the motion",
    summary: "Draw the path you actually walk. The tangle reveals the wasted steps.",
    explanationMd: `A **spaghetti diagram** is dead simple: draw a plan of the area, then trace the *actual path* a person (or a product) walks during a task. The line ends up looking like spaghetti — and that tangle is your motion waste, made visible.

We don't notice our own walking; it feels like just doing the job. But trace it and you'll see the same trip to the far fridge fifteen times, the criss-cross between two benches, the detour round a badly-placed bin.

Once the tangle is on paper, the fix is usually obvious: move the thing closer, reorder the steps, relocate the bin.`,
    whatToShowMd: `**Spaghetti Diagrams**

- Draw the area, trace the path you actually walk
- The tangle = motion waste, made visible
- We don't notice our own walking
- Tangle on paper → fix is usually obvious

**Today's question:** which task sends you back and forth across the kitchen most?`,
    deliveryNotesMd: `**Talking points:**
- Offer to trace one job this week — it's eye-opening every time.
- The fix is nearly always "move the thing closer" or "reorder the steps."
- Motion feels like work but it's pure waste — the customer doesn't pay for our steps.

**Prompt:** "Which job has you walking the most? Let's map it and cut the trips."`,
  },
  {
    weekNumber: 40,
    title: "Why We Improve — more time for what matters",
    summary: "Lean isn't about squeezing people. It's about freeing time and removing frustration.",
    explanationMd: `It's worth saying plainly: **we don't do lean to squeeze more out of people.** Paul Akers is clear — the point is to remove the frustrating, pointless, exhausting parts of work so the day is *better*, and there's more time for what actually matters.

Every bit of walking, hunting for tools, redoing work and waiting around that we remove is time and energy handed back — to do good work calmly, to go home less knackered, to grow the business so there's more for everyone.

If "improvement" ever feels like it's just making people run faster, we've lost the plot. It should make the work *lighter*.`,
    whatToShowMd: `**Why We Improve**

- Not to squeeze people — to make work *better*
- Remove the frustrating, pointless, tiring bits
- Time and energy handed back to the team
- If it feels like "run faster", we've lost the plot

**Today's question:** what frustrating part of your day would you most love gone?`,
    deliveryNotesMd: `**Talking points:**
- Be explicit: this is about removing frustration, not cracking the whip.
- The wins go back to the team — calmer days, less wasted effort.
- If anyone feels lean = speed-up, address it head on. That's a culture risk.

**Prompt:** "What's the single most frustrating, time-wasting part of your day? That's our target."`,
  },
  {
    weekNumber: 41,
    title: "Standardise the Win — hold the gain",
    summary: "An improvement isn't done until it's the new normal everyone follows.",
    explanationMd: `Making an improvement is only half the job. If it isn't **standardised** — written down, shown, made the new normal — it quietly slips back to the old way within weeks. The win evaporates.

The lean sequence is: improve, then **lock it in** as the new standard, then improve again from there. Without the lock-in step, you're forever re-fixing the same things, sliding back down the hill you just climbed.

So when something works, don't just celebrate — capture it. Update the SOP, retrain, make it the obvious default. *Then* go find the next improvement.`,
    whatToShowMd: `**Standardise the Win**

- An improvement not locked in slips back in weeks
- Sequence: improve → standardise → improve again
- No lock-in = forever re-fixing the same thing
- Capture it: update the SOP, retrain, make it default

**Today's question:** what improvement did we make that's quietly slipped back?`,
    deliveryNotesMd: `**Talking points:**
- The slide-back is silent — one day you notice you're doing the old way again.
- Standardising is the boring step that protects all the exciting ones.
- Celebrate a win by capturing it, not just by cheering it.

**Prompt:** "Name an improvement we made that's drifted back. How do we lock it in for good?"`,
  },
];

/**
 * The 12 seeded slide rows for the default Morning Meeting template.
 * Matches the slide order the runner used to hardcode in the frontend.
 * For yesterday_kpis the host's selected KPIs default to the three the
 * kitchen actually cares about — building rate, packing rate, wonkies.
 */
const DEFAULT_TEMPLATE_SLIDES = [
  { kind: "special_prep",        title: "Special Prep" },
  { kind: "stretches",           title: "Stretches" },
  { kind: "yesterday_kpis",      title: "Yesterday's Numbers", config: { kpis: ["builder_rate", "packing_rate", "wonkies"] } },
  { kind: "order_of_production", title: "Order of Production" },
  { kind: "local_delivery",      title: "Local Delivery" },
  { kind: "bag_orders",          title: "Bag Orders" },
  { kind: "safety_issues",       title: "Safety Issues" },
  { kind: "new_sops",            title: "New & Updated SOPs" },
  { kind: "struggles",           title: "Improvements Required" },
  { kind: "lesson",              title: "Today's Lean Lesson" },
  { kind: "gratitude",           title: "Gratitude" },
] as const;

export async function seedLeanLessonsIfNeeded() {
  // Step 1: seed/update the legacy lean_lessons rows (kept for older code paths)
  for (const l of LESSONS) {
    await db.execute(sql`
      INSERT INTO lean_lessons (week_number, title, summary, explanation_md, what_to_show_md, delivery_notes_md, is_active)
      VALUES (${l.weekNumber}, ${l.title}, ${l.summary}, ${l.explanationMd}, ${l.whatToShowMd}, ${l.deliveryNotesMd}, TRUE)
      ON CONFLICT (week_number) DO NOTHING
    `);
  }

  // Step 2: mirror each legacy lesson into a (principle, example) pair.
  // Principles match the lesson's week_number → week_position so today's
  // lesson rotation lands on the same topic the old code did. Each
  // principle starts with exactly one example carrying the lesson's
  // body content; admins add more examples per principle over time.
  for (const l of LESSONS) {
    await db.execute(sql`
      INSERT INTO lean_principles (week_position, title, summary, is_active)
      VALUES (${l.weekNumber}, ${l.title}, ${l.summary}, TRUE)
      ON CONFLICT (week_position) DO NOTHING
    `);
    // Look up the principle id we just ensured exists.
    const principleRows = await db.execute<{ id: number }>(sql`
      SELECT id FROM lean_principles WHERE week_position = ${l.weekNumber}
    `);
    const principleId = (principleRows.rows ?? principleRows)[0]?.id;
    if (!principleId) continue;
    // Only seed the starter example if no examples exist for this
    // principle yet — preserves any examples an admin has added.
    const existing = await db.execute<{ count: number }>(sql`
      SELECT COUNT(*)::int AS count FROM lean_examples WHERE principle_id = ${principleId}
    `);
    const existingCount = Number((existing.rows ?? existing)[0]?.count ?? 0);
    if (existingCount === 0) {
      await db.execute(sql`
        INSERT INTO lean_examples (principle_id, order_position, title, summary, explanation_md, what_to_show_md, delivery_notes_md, is_active)
        VALUES (${principleId}, 0, ${l.title}, ${l.summary}, ${l.explanationMd}, ${l.whatToShowMd}, ${l.deliveryNotesMd}, TRUE)
      `);
    }
  }

  // Step 2b: consolidate 3S into a single week with one fresh example
  // per weekday. The curriculum originally split 3S across three
  // single-example weeks (Sweep / Sort / Standardise), so the slide
  // showed the same content every day of a week. The team wants one
  // subject held for a full week with a different angle each calendar
  // day. We keep week 3 as the "3S" week, give it five daily examples
  // (the selector rotates by weekday), and retire the now-duplicate
  // standalone Sort/Standardise weeks. Idempotent: the rename is a
  // straight UPDATE, examples are only inserted when missing by title,
  // and the original auto-seeded starter is removed once.
  await db.execute(sql`
    UPDATE lean_principles
    SET title = '3S', summary = 'Sweep, Sort, Standardise — the daily habits that make problems visible.'
    WHERE week_position = 3
  `);
  await db.execute(sql`
    UPDATE lean_principles SET is_active = FALSE WHERE week_position IN (4, 5)
  `);
  const threeSRows = await db.execute<{ id: number }>(sql`
    SELECT id FROM lean_principles WHERE week_position = 3
  `);
  const threeSId = (threeSRows.rows ?? threeSRows)[0]?.id;
  if (threeSId) {
    // Remove the lone auto-seeded starter ("3S — Sweep") so the five
    // daily examples below become the full set. Only touches the exact
    // seeded row, so any admin-added example is left alone.
    await db.execute(sql`
      DELETE FROM lean_examples
      WHERE principle_id = ${threeSId} AND order_position = 0 AND title = '3S — Sweep'
    `);
    for (const ex of THREE_S_EXAMPLES) {
      await db.execute(sql`
        INSERT INTO lean_examples (principle_id, order_position, title, summary, explanation_md, what_to_show_md, delivery_notes_md, is_active)
        SELECT ${threeSId}, ${ex.orderPosition}, ${ex.title}, ${ex.summary}, ${ex.explanationMd}, ${ex.whatToShowMd}, ${ex.deliveryNotesMd}, TRUE
        WHERE NOT EXISTS (
          SELECT 1 FROM lean_examples WHERE principle_id = ${threeSId} AND title = ${ex.title}
        )
      `);
    }
  }

  // Step 2c: attach code-drawn diagrams to the examples where a visual
  // lands harder than text. Keys map to the LessonDiagram bank on the
  // frontend. Guarded by `diagram IS NULL` so admin choices are kept and
  // re-runs are no-ops.
  await db.execute(sql`
    UPDATE lean_examples SET diagram = 'eight-wastes'
    WHERE diagram IS NULL
      AND principle_id = (SELECT id FROM lean_principles WHERE week_position = 2)
  `);
  await db.execute(sql`
    UPDATE lean_examples SET diagram = '3s-cycle'
    WHERE diagram IS NULL
      AND principle_id = (SELECT id FROM lean_principles WHERE week_position = 3)
  `);
  await db.execute(sql`
    UPDATE lean_examples SET diagram = 'compound-growth'
    WHERE diagram IS NULL
      AND principle_id = (SELECT id FROM lean_principles WHERE week_position = 7)
  `);

  // Step 2d: the headline "Power of Compound Improvements" lesson, with
  // the compound-growth chart. Lives at week_position 13 so it joins the
  // rotation and the shuffle pool. Idempotent.
  await db.execute(sql`
    INSERT INTO lean_principles (week_position, title, summary, is_active)
    VALUES (13, 'The Power of Compound Improvements', '1% better every day compounds to ~37× in a year. Tiny daily fixes win.', TRUE)
    ON CONFLICT (week_position) DO NOTHING
  `);
  const compoundRows = await db.execute<{ id: number }>(sql`
    SELECT id FROM lean_principles WHERE week_position = 13
  `);
  const compoundId = (compoundRows.rows ?? compoundRows)[0]?.id;
  if (compoundId) {
    const explanationMd = `Small improvements feel pointless in the moment. The maths says otherwise.

If you get **1% better every day**, you don't end the year 365% better — you end up **~37× better**, because each day's gain builds on the last. That's *compounding*.

The flip side is brutal: **1% worse every day** leaves you at about **3% of where you started** — basically nothing.

- 1.01³⁶⁵ ≈ **37.8**
- 0.99³⁶⁵ ≈ **0.03**

A calzone made two seconds faster, a tool given a home, one less walk to the fridge — on their own, nothing. Compounded across every person, every shift, every day — a different kitchen by Christmas.`;
    const whatToShowMd = `**1% better every day = ~37× in a year**

- Tiny gains *compound* — each one builds on the last
- 1% better/day → **37.8×**
- 1% worse/day → **0.03×** (almost nothing)
- The win is the **daily habit**, not the size of any single fix

**Today:** one 1% improvement, from every station.`;
    const deliveryNotesMd = `**Talking points:**
- Point at the curve: flat for weeks, then it explodes. Improvements feel slow — until they don't.
- The gap between the green and the red line is the difference between improving and drifting.
- It only works if it's *everyone, every day* — twelve people × one tiny fix per shift.

**Prompt:** "What's one 1% fix you could make at your station today?"`;
    await db.execute(sql`
      INSERT INTO lean_examples (principle_id, order_position, title, summary, explanation_md, what_to_show_md, delivery_notes_md, diagram, is_active)
      SELECT ${compoundId}, 0, 'The Power of Compound Improvements',
             '1% better every day = ~37× in a year. 1% worse = nearly nothing.',
             ${explanationMd}, ${whatToShowMd}, ${deliveryNotesMd}, 'compound-growth', TRUE
      WHERE NOT EXISTS (
        SELECT 1 FROM lean_examples WHERE principle_id = ${compoundId} AND title = 'The Power of Compound Improvements'
      )
    `);
  }

  // Step 2e: the curriculum expansion — a deep bench of lessons so the
  // daily rotation runs for months before repeating. Each becomes a
  // principle (week_position) with one starter example. Idempotent:
  // ON CONFLICT (week_position) keeps admin edits, and the example is
  // only inserted when the principle has none yet.
  for (const l of ADDITIONAL_LESSONS) {
    await db.execute(sql`
      INSERT INTO lean_principles (week_position, title, summary, is_active)
      VALUES (${l.weekNumber}, ${l.title}, ${l.summary}, TRUE)
      ON CONFLICT (week_position) DO NOTHING
    `);
    const principleRows = await db.execute<{ id: number }>(sql`
      SELECT id FROM lean_principles WHERE week_position = ${l.weekNumber}
    `);
    const principleId = (principleRows.rows ?? principleRows)[0]?.id;
    if (!principleId) continue;
    const existing = await db.execute<{ count: number }>(sql`
      SELECT COUNT(*)::int AS count FROM lean_examples WHERE principle_id = ${principleId}
    `);
    const existingCount = Number((existing.rows ?? existing)[0]?.count ?? 0);
    if (existingCount === 0) {
      await db.execute(sql`
        INSERT INTO lean_examples (principle_id, order_position, title, summary, explanation_md, what_to_show_md, delivery_notes_md, is_active)
        VALUES (${principleId}, 0, ${l.title}, ${l.summary}, ${l.explanationMd}, ${l.whatToShowMd}, ${l.deliveryNotesMd}, TRUE)
      `);
    }
  }

  // Step 3: ensure there's a default meeting template with the 12
  // slide rows. New meetings clone these into meeting_slides.
  let templateId: number | null = null;
  const existingTpl = await db.execute<{ id: number }>(sql`
    SELECT id FROM meeting_templates WHERE is_default = TRUE LIMIT 1
  `);
  templateId = (existingTpl.rows ?? existingTpl)[0]?.id ?? null;
  if (!templateId) {
    const inserted = await db.execute<{ id: number }>(sql`
      INSERT INTO meeting_templates (name, is_default) VALUES ('Default morning meeting', TRUE) RETURNING id
    `);
    templateId = (inserted.rows ?? inserted)[0]?.id ?? null;
  }
  if (templateId) {
    const slideRows = await db.execute<{ count: number }>(sql`
      SELECT COUNT(*)::int AS count FROM template_slides WHERE template_id = ${templateId}
    `);
    const slideCount = Number((slideRows.rows ?? slideRows)[0]?.count ?? 0);
    if (slideCount === 0) {
      for (let i = 0; i < DEFAULT_TEMPLATE_SLIDES.length; i++) {
        const s = DEFAULT_TEMPLATE_SLIDES[i];
        const cfg = "config" in s ? JSON.stringify(s.config) : null;
        await db.execute(sql`
          INSERT INTO template_slides (template_id, kind, title, order_position, config_json)
          VALUES (${templateId}, ${s.kind}, ${s.title}, ${i}, ${cfg}::jsonb)
        `);
      }
    }
  }
}
