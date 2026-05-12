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

export async function seedLeanLessonsIfNeeded() {
  for (const l of LESSONS) {
    await db.execute(sql`
      INSERT INTO lean_lessons (week_number, title, summary, explanation_md, what_to_show_md, delivery_notes_md, is_active)
      VALUES (${l.weekNumber}, ${l.title}, ${l.summary}, ${l.explanationMd}, ${l.whatToShowMd}, ${l.deliveryNotesMd}, TRUE)
      ON CONFLICT (week_number) DO NOTHING
    `);
  }
}
