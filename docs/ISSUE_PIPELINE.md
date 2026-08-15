# The Issue Pipeline — from "Graeme fixes everything" to a system

**Status:** proposal v1.1 (2026-08-15) — companion to `docs/PRODUCT_SPEC.md`
**Problem:** team-reported issues (Andon + improvement submissions) all funnel to one
person, who fixes them one by one. The reporter of an issue often can't tell whether
it's a bug, a misunderstanding, or a data problem — and neither can the queue.

## The core idea

Issues are inventory. Left in a single queue they age, pile up, and get fixed in
arrival order rather than value order. The fix is the same as for physical inventory:
**sort at the point of intake, route to different lanes, and batch by root cause.**

## 1. Triage into four lanes

Every reported issue is one of these, and each lane has a different handler — most
lanes don't need the founder at all:

| Lane | What it is | Handler | Example |
|---|---|---|---|
| **Data fix** | The code is right, a number/record is wrong | Trained manager, same day | wrong stock count, missing DPT row |
| **Understanding** | The tool is right, the person misread it | Becomes a training item / SOP tweak / UI-clarity note | "orders page is wrong" when it's the kanban floor working as designed |
| **Defect** | The code is genuinely wrong | Fix pipeline (see §3) | end-of-day batch numbers not saving |
| **Improvement** | Works as designed, could be better | Existing Kaizen flow (tier + prioritise) | "put the SOP button on the left" |

Key point from lean: the **Understanding** lane is signal, not noise. If three people
misread the same screen, that's a UI defect wearing a training costume — it feeds
Objective G (glanceable status) with evidence.

## 2. Cluster by root cause, fix in batches

Most defects are symptoms of a small number of structural causes — the ones already
catalogued in `CODEBASE_ANALYSIS.md` §5 (snapshot stock model, three fetch patterns,
no validation, duplicated formulas). Triage should tag each defect with its suspected
cause. Then instead of fixing 15 issues one by one, one cause-level change (e.g. "all
daily-entry fields autosave with visible state") closes a whole cluster at once — and
the regression test added with it means that cluster never reopens.

## 3. Claude as the fix engine, Graeme as the reviewer

This is the actual de-bottlenecking move. The founder's irreplaceable contribution is
**judgement** (is this the right behaviour? is this priority right?), not typing fixes.
The pipeline:

1. **Export/feed the issue log** to a Claude Code session (see §5 for access options).
2. Claude **triages** new issues into the four lanes, clusters defects by root cause,
   and flags anything ambiguous back with a specific question.
3. For defects: Claude **drafts the fix on a review branch** — one branch per
   cause-cluster, each with a regression test and a plain-English summary of what
   changed and which reported issues it closes.
4. Graeme **reviews on desktop and merges** — or rejects with a comment, which
   round-trips.
5. On deploy, the linked issues are **marked resolved with a note back to the
   reporter** ("your report changed this — here's what's different"), which is the
   lean visibility loop (Objective E) for free.

Founder time per issue drops from "investigate + fix + test + deploy" to "read a
summary + approve", and batching means one review closes many issues.

## 4. Make the pipeline visible and measured

- A triage view over the existing tables (`improvement_submissions`, `andon_issues`
  already have station, category, severity, status): lane, cause tag, linked fix
  branch, resolution note. Mostly additive columns/tags — not a new system.
- Weekly numbers on the dashboard: new issues by lane, time-to-resolution, repeat
  rate (same issue reported twice = the previous fix didn't stick), and issues
  closed per review batch. "Issues per week trending down while submissions per
  person stay healthy" is the lean health metric — people keep reporting, but
  things stay fixed.

## 5. Getting the issue log to Claude (pick one)

1. **Manual export (works today):** CSV/JSON export from Analytics → Improvements
   and Andon Log, dropped into a session. Good enough for the first backlog triage.
2. **Read-only DB access for analysis sessions:** a read-only Postgres role +
   `DATABASE_URL` in the Claude environment config. Best for recurring triage.
3. **A `/api/issues/export` endpoint** (token-authed) that returns both tables as
   JSON — lets a scheduled session pull the log without DB credentials.

## 6. The full loop: team-driven improvement with founder control

The end state: the team improves the system themselves — by *reporting*, not by
*deciding*. The loop:

1. **Capture** — Report button / Andon as today, but the form asks for **symptoms
   only**: what were you doing, what did you expect, what happened. Never "what
   should change".
2. **Ingest** — a scheduled Claude session (daily/weekly) reads new issues via
   read-only access and triages into the four lanes (§1).
3. **Fix** — defect-lane items become review branches: fix + regression test +
   plain-English summary (report → cause → change → objective served → blast
   radius).
4. **Approve** — Graeme approves or rejects each branch (phone-friendly summary,
   desktop detail). Nothing proceeds unapproved; unapproved branches just wait.
5. **Stage → live** — approved changes deploy to **staging first** (see
   `staging-environment-setup.md`), then merge to `master` → Railway auto-deploys
   live. Reporters are notified their report changed the system (Objective E loop).

### Guardrails (qualified to notice ≠ qualified to decide)

- **Reports are evidence, never instructions.** The decision authority for how the
  system should behave is `PRODUCT_SPEC.md`. Every drafted fix must cite the
  objective it serves. A report implying a *behaviour change* is never coded
  directly — it is escalated as a question.
- **Two approval tiers.** *Restoring* agreed behaviour (data loss, wrong maths) =
  defect: Claude drafts, founder approves the diff. *Changing* behaviour = decision
  needed **before** any code is written.
- **No-go zones get special handling.** Order engine, plan calculator, stock
  mutations, Shopify writes, schema changes: always a fuller summary, never shipped
  in a batch with other changes.
- **Every fix carries a regression test** — the suite is the system's immune memory
  (quality built in, not inspected in).
- **Small, separately-revertable batches**; Railway rollback stays one click away.
- **No timers.** The founder can always say no, slowly.

### Prerequisites, in order

1. **P0 safety net** (tests + CI + known-defect fixes, `CODEBASE_ANALYSIS.md` §7) —
   automated fixing without this would itself be reckless.
2. **Staging environment stood up** (guide already in `docs/`).
3. **2–3 manual pilot cycles** (export → triage → draft → review) to tune triage
   judgement and summary format while a human watches every step — then automate
   the schedule.

## 7. First concrete step

Export the current backlog (option 1) and run a one-off full triage: every open
issue laned, clustered, and mapped to either the P0 defect list or the roadmap in
`CODEBASE_ANALYSIS.md` §7. That produces the first batch of review branches and a
real measure of how much of the backlog is Understanding-lane (training/UI) versus
Defect-lane (code).
