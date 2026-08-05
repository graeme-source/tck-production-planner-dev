#!/usr/bin/env tsx
/**
 * rebuild-lean-library.ts
 *
 * Rebuild the morning-meeting Lean library from the Lean Made Simple corpus
 * (Graeme, 2026-08-05: "happy to disregard anything we've done before to
 * create a new Lean learning library from the book").
 *
 * The old 42-principle curriculum mixed LMS material with generic
 * Toyota-tradition lean (Gemba, Takt, Heijunka, A3…). This replaces it with
 * a 24-week curriculum drawn ONLY from the corpus in src/lib/lean-corpus.ts:
 *
 *   wk 1      Lean at TCK — the mindset (waste / improve the process)
 *   wk 2      The 8 Wastes — learning to see (overview)
 *   wks 3–10  one waste per week, in canonical order
 *   wks 11–22 the 12 steps, one per week, in book order
 *   wk 23     3S    wk 24     Two Second Lean
 *
 * Each principle gets exactly 5 AI-written examples (the weekly-focus engine
 * shows example[weekday] Mon–Fri), generated with leanCorpusPrompt() as the
 * terminology law and briefed as a Monday→Friday teaching arc.
 *
 * What it does to existing data (atomically, in one transaction, only after
 * every generation call has succeeded):
 *   - ALL current principles: is_active=false, week_position += 1000
 *     (nothing is deleted — instant rollback is possible, and past lesson
 *     content stays browsable in the library picker's inactive set).
 *   - EXCEPT "On-demand lessons", which stays active (the rotation filters
 *     it by title; its ad-hoc examples remain usable).
 *   - New principles inserted at week_position 1..24 with their examples.
 *   - lean_curriculum_start_date set to the CURRENT week's Monday, so the
 *     new library starts at week 1 immediately.
 *   - Any lean_week_focus pins are cleared (they point at old principles).
 *
 * Run (dry run — generates nothing, prints the plan):
 *   pnpm --filter @workspace/api-server exec tsx scripts/rebuild-lean-library.ts
 *
 * Apply (generates ~24 Claude calls, then writes):
 *   ANTHROPIC_API_KEY=... DATABASE_URL=... pnpm --filter @workspace/api-server \
 *     exec tsx scripts/rebuild-lean-library.ts --apply
 */

import Anthropic from "@anthropic-ai/sdk";
import { pool } from "@workspace/db";
import { leanCorpusPrompt, LMS_EIGHT_WASTES, LMS_TWELVE_STEPS } from "../src/lib/lean-corpus";

const APPLY = process.argv.includes("--apply");
// --copy-from=<conn string>: skip generation and copy the already-generated
// (and reviewed) library from another database — used to ship the exact
// content verified on local to live, byte for byte.
const COPY_FROM = process.argv.find(a => a.startsWith("--copy-from="))?.slice("--copy-from=".length);
const MODEL = "claude-sonnet-4-6";
const ON_DEMAND_TITLE = "On-demand lessons";

interface PrincipleSpec {
  title: string;
  summary: string;
  brief: string; // generation brief for the 5-day arc
}

const ARC_NOTE =
  "The 5 examples are a Monday→Friday arc: Monday introduces the idea, " +
  "Tuesday–Thursday each take a different concrete TCK angle, Friday is a " +
  "practical do-it exercise the team runs on the spot (a hunt, a walk, a " +
  "2-second improvement, a show-and-tell for next week).";

function wasteWeek(i: number): PrincipleSpec {
  const w = LMS_EIGHT_WASTES[i];
  return {
    title: `The 8 Wastes — ${w.name}`,
    summary: `${w.definition} A whole week on spotting and removing ${w.name} at TCK.`,
    brief:
      `Deep-dive week on the waste "${w.name}" (${w.definition}). Canonical example: ${w.kitchenExample} ` +
      `Monday: meet the waste — what it is, why it drains the team, how it hides in a food factory. ` +
      `Tuesday–Thursday: three DIFFERENT TCK situations where ${w.name} shows up (stations, fridges/storage, packing/dispatch, planning) — each teaches the team to SEE it. ` +
      `Friday: a "${w.name} hunt" — the team finds one live instance before the meeting ends and names the smallest change that would remove it. ${ARC_NOTE}`,
  };
}

function stepWeek(i: number): PrincipleSpec {
  const s = LMS_TWELVE_STEPS[i];
  return {
    title: `Step ${s.step}: ${s.title}`,
    summary: s.nutshell,
    brief:
      `Week on Lean Made Simple step ${s.step}, "${s.title}" — ${s.nutshell} ` +
      `Teach what this step means AT TCK specifically (a ~10-person artisan calzone factory that already runs morning meetings, kanban cards, improvement ideas and 2-second improvements). ` +
      `Monday introduces the step and why it matters; Tuesday–Thursday show it in practice at TCK from different angles (what we already do, what world-class would look like, common traps); ` +
      `Friday is a practical exercise applying the step this week. ${ARC_NOTE}`,
  };
}

const CURRICULUM: PrincipleSpec[] = [
  {
    title: "Lean at TCK — What Waste Really Is",
    summary: "The foundation: waste is anything the customer wouldn't pay for, and everyone's real job is improving the work, not just doing it.",
    brief:
      "Foundation week for lean thinking at TCK. Core ideas: waste = anything that doesn't add value to the customer ('would the customer pay for this?'); everyone has the same real job — not just doing the work but improving how the work is done; small improvements from everyone, every day, beat occasional big ones; no blame — waste lives in the process, not the person. " +
      "Monday: the big idea. Tuesday: value vs waste through a customer's eyes (what makes the calzone worth it). Wednesday: 'improve the process' as part of the job. Thursday: no-blame thinking. Friday: each person names one thing that sucked energy this week — that's the improvement list. " + ARC_NOTE,
  },
  {
    title: "The 8 Wastes — Learning To See",
    summary: "Overview of all eight wastes with their canonical names — the vocabulary the whole team uses to spot waste.",
    brief:
      "Overview week for all 8 wastes (deep-dives follow one per week). Use the canonical names and order. " +
      "Monday: why naming wastes matters — you can't remove what you can't see. Tuesday: the four wastes of THINGS (Overproduction, Transportation, Inventory, Defects) in one kitchen tour. Wednesday: the four wastes of PEOPLE'S TIME AND TALENT (Motion, Overprocessing, Waiting, Waste of Skills). Thursday: how wastes trigger each other (overproduction breeds inventory breeds transportation). Friday: first waste walk — spot any waste, name it out loud with the canonical name. " + ARC_NOTE,
  },
  ...LMS_EIGHT_WASTES.map((_, i) => wasteWeek(i)),
  ...LMS_TWELVE_STEPS.map((_, i) => stepWeek(i)),
  {
    title: "3S — Sweep, Sort, Standardise",
    summary: "The daily habit of leaving every area clean, organised and set up for tomorrow.",
    brief:
      "Week on 3S (Sweep, Sort, Standardise — the LMS three, NOT generic 5S). Monday: what 3S is and why daily beats deep-clean-when-it's-bad. Tuesday: Sweep at TCK. Wednesday: Sort — a place for everything (link to kanban cards and shadow boards). Thursday: Standardise — make the good state the easy state, so anyone can see when something's off. Friday: 3S blitz of one station and photograph the standard. " + ARC_NOTE,
  },
  {
    title: "Two Second Lean — Everyone, Every Day",
    summary: "Paul Akers' habit the team already practises: one tiny 2-second improvement every day, filmed and shared.",
    brief:
      "Week on Two Second Lean (Paul Akers — the team already practises this). Monday: the idea — improvements so small they're impossible to skip, compounding daily. Tuesday: what counts (move a tool closer, label a shelf, fix the annoying thing). Wednesday: film it, share it — why showing beats telling (links to Yokoten). Thursday: fix what bugs YOU — the energy-drain test. Friday: everyone makes one 2-second improvement before the meeting ends. " + ARC_NOTE,
  },
];

// ── Generation ──────────────────────────────────────────────────────────────

interface GeneratedExample {
  title: string;
  summary: string;
  explanation_md: string;
  what_to_show_md: string;
  delivery_notes_md: string;
}

// One lesson per API call. Whole-week-in-one-call generation kept failing:
// past ~1500 tokens of tool input the model started returning the array as
// a badly-escaped JSON STRING (unescaped inner quotes → unparseable, week
// 20 failed every retry). Single-lesson outputs are short enough that the
// failure mode disappears; earlier days are fed back in so the Mon→Fri arc
// still hangs together.
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

const LESSON_TOOL: Anthropic.Tool = {
  name: "save_lesson",
  description: "Save one day's lean lesson.",
  input_schema: {
    type: "object" as const,
    properties: {
      title: { type: "string", description: "Short lesson title (the day's angle, not the weekday name)" },
      summary: { type: "string", description: "1-2 sentence summary shown in the library list" },
      explanation_md: { type: "string", description: "The teach, in markdown. 120-220 words, host reads/retells it. TCK voice." },
      what_to_show_md: { type: "string", description: "Markdown bullets: what to physically show, point at or do in the kitchen during the meeting." },
      delivery_notes_md: { type: "string", description: "Markdown bullets: host tips — questions to ask the team, common traps, how to land it in under 5 minutes." },
    },
    required: ["title", "summary", "explanation_md", "what_to_show_md", "delivery_notes_md"],
  },
};

const SYSTEM_PROMPT = [
  leanCorpusPrompt(),
  "",
  "You write the daily 5-minute lean lesson for The Calzone Kitchen's morning meeting — a ~10-person artisan food factory (calzones and mac & cheese: dough, prep stations, ovens, wrapping, packing, fridges, kanban cards). The whole team stands together; the host teaches from your material.",
  "Write in TCK's voice per the corpus. Never reproduce passages from the book — teach the ideas in our own words.",
].join("\n");

async function generateDayOnce(
  client: Anthropic, spec: PrincipleSpec, dayIdx: number, priorDays: GeneratedExample[],
): Promise<GeneratedExample> {
  const prior = priorDays.length
    ? `Already written this week (do NOT repeat their angles):\n${priorDays.map((p, i) => `${DAY_NAMES[i]}: "${p.title}" — ${p.summary}`).join("\n")}\n\n`
    : "";
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 2500,
    system: SYSTEM_PROMPT,
    messages: [{
      role: "user",
      content: `This week's principle: "${spec.title}" — ${spec.summary}\n\nWeek brief:\n${spec.brief}\n\n${prior}Write ONLY the ${DAY_NAMES[dayIdx]} lesson using the save_lesson tool.`,
    }],
    tools: [LESSON_TOOL],
    tool_choice: { type: "tool", name: "save_lesson" },
  });
  if (res.stop_reason === "max_tokens") throw new Error(`"${spec.title}" ${DAY_NAMES[dayIdx]}: truncated at max_tokens`);
  const toolUse = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  const ex = toolUse?.input as GeneratedExample | undefined;
  if (!ex?.title || !ex.summary || !ex.explanation_md || !ex.what_to_show_md || !ex.delivery_notes_md) {
    throw new Error(`"${spec.title}" ${DAY_NAMES[dayIdx]}: incomplete lesson fields`);
  }
  for (const banned of ["non-utilised talent", "non-utilized talent", "unused creativity", "DOWNTIME"]) {
    if (`${ex.title} ${ex.summary} ${ex.explanation_md}`.toLowerCase().includes(banned.toLowerCase())) {
      throw new Error(`"${spec.title}" ${DAY_NAMES[dayIdx]}: banned term "${banned}"`);
    }
  }
  return ex;
}

/** Retries with backoff ride over malformed outputs AND transient network
 *  blips (ENOTFOUND during a DNS wobble killed a whole 24-call run once). */
async function withRetries<T>(fn: () => Promise<T>): Promise<T> {
  const delays = [0, 2000, 10_000, 30_000];
  let lastErr: unknown;
  for (const delay of delays) {
    if (delay) {
      console.log(`retrying in ${delay / 1000}s (${lastErr instanceof Error ? lastErr.message : String(lastErr)}) … `);
      await new Promise(r => setTimeout(r, delay));
    }
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

async function generateExamples(client: Anthropic, spec: PrincipleSpec): Promise<GeneratedExample[]> {
  const days: GeneratedExample[] = [];
  for (let d = 0; d < 5; d++) {
    days.push(await withRetries(() => generateDayOnce(client, spec, d, days)));
  }
  return days;
}

/** Monday (YYYY-MM-DD) of the current week, Europe/London. */
function currentMonday(): string {
  const todayIso = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
  const d = new Date(`${todayIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

async function main() {
  console.log(`\nLean library rebuild — ${CURRICULUM.length} principles × 5 lessons — ${APPLY ? "APPLY" : "DRY RUN"}\n`);
  CURRICULUM.forEach((p, i) => console.log(`  wk ${String(i + 1).padStart(2)}  ${p.title}`));

  if (!APPLY) {
    console.log("\nDry run only. Re-run with --apply to generate and write.");
    return;
  }

  // Content to write: either freshly generated, or copied verbatim from a
  // source DB where it was already generated and reviewed.
  interface WeekRow { title: string; summary: string; examples: GeneratedExample[] }
  const weeks: WeekRow[] = [];

  if (COPY_FROM) {
    // 'pg' isn't directly resolvable from this package under pnpm — borrow
    // the Pool class from the workspace pool instance instead.
    const PoolClass = pool.constructor as new (cfg: { connectionString: string }) => typeof pool;
    const src = new PoolClass({ connectionString: COPY_FROM });
    const { rows: principles } = await src.query<{ id: number; title: string; summary: string }>(
      `SELECT id, title, summary FROM lean_principles
       WHERE is_active AND week_position BETWEEN 1 AND ${CURRICULUM.length}
       ORDER BY week_position`,
    );
    if (principles.length !== CURRICULUM.length) {
      throw new Error(`source has ${principles.length} active principles at positions 1..${CURRICULUM.length}, expected ${CURRICULUM.length}`);
    }
    for (const p of principles) {
      const { rows: examples } = await src.query<GeneratedExample>(
        `SELECT title, summary, explanation_md, what_to_show_md, delivery_notes_md
         FROM lean_examples WHERE principle_id = ${p.id} AND is_active ORDER BY order_position`,
      );
      if (examples.length !== 5) throw new Error(`source "${p.title}": expected 5 examples, got ${examples.length}`);
      weeks.push({ title: p.title, summary: p.summary, examples });
      console.log(`copied: ${p.title}`);
    }
    await src.end();
  } else {
    const apiKey = process.env["ANTHROPIC_API_KEY"];
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
    const client = new Anthropic({ apiKey });

    // Generate EVERYTHING first — the DB swap only happens if all 24 succeed.
    // Weeks run 3 at a time; the 5 days inside a week stay sequential so each
    // day can see the angles already taken.
    const generated: GeneratedExample[][] = new Array(CURRICULUM.length);
    let next = 0, done = 0;
    async function worker() {
      while (next < CURRICULUM.length) {
        const i = next++;
        generated[i] = await generateExamples(client, CURRICULUM[i]);
        console.log(`wk ${i + 1}/${CURRICULUM.length} ok (${++done} done): ${CURRICULUM[i].title}`);
      }
    }
    await Promise.all([worker(), worker(), worker()]);
    CURRICULUM.forEach((spec, i) => weeks.push({ title: spec.title, summary: spec.summary, examples: generated[i] }));
  }

  const anchor = currentMonday();
  const pg = await pool.connect();
  try {
    await pg.query("BEGIN");
    await pg.query(
      `UPDATE lean_principles SET is_active = (title = $1), week_position = week_position + 1000, updated_at = NOW()`,
      [ON_DEMAND_TITLE],
    );
    await pg.query(`DELETE FROM lean_week_focus`);
    for (const [i, spec] of weeks.entries()) {
      const { rows } = await pg.query<{ id: number }>(
        `INSERT INTO lean_principles (week_position, title, summary, is_active) VALUES ($1, $2, $3, TRUE) RETURNING id`,
        [i + 1, spec.title, spec.summary],
      );
      const principleId = rows[0].id;
      for (const [j, ex] of spec.examples.entries()) {
        await pg.query(
          `INSERT INTO lean_examples (principle_id, order_position, title, summary, explanation_md, what_to_show_md, delivery_notes_md, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)`,
          [principleId, j, ex.title, ex.summary, ex.explanation_md, ex.what_to_show_md, ex.delivery_notes_md],
        );
      }
    }
    await pg.query(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ('lean_curriculum_start_date', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [anchor],
    );
    await pg.query("COMMIT");
  } catch (err) {
    await pg.query("ROLLBACK");
    throw err;
  } finally {
    pg.release();
  }

  console.log(`\nDone. ${CURRICULUM.length} principles live at week_position 1..${CURRICULUM.length}; anchor ${anchor} (week 1 = this week).`);
  console.log(`Old principles deactivated at week_position 1001+ — nothing deleted.`);
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
