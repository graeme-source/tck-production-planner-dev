#!/usr/bin/env tsx
/**
 * install-lean-curriculum-v2.ts
 *
 * Installs the "Seeing Waste" 9-week lean curriculum (Graeme, 2026-08-25:
 * week 1 = what waste is and how to see it, weeks 2–9 = the Eight Wastes
 * one per week in canonical order). Content lives in
 * lean-curriculum-v2-content.ts — authored and reviewed in the repo, so
 * the install is deterministic: no API calls, and local and live get the
 * same bytes.
 *
 * What it does (atomically, in one transaction):
 *   - ALL current principles: is_active=false, week_position += 1000
 *     (nothing deleted — instant rollback, past content stays browsable
 *     in the library picker's inactive set). "On-demand lessons" keeps
 *     is_active=true; the rotation filters it by title.
 *   - New principles inserted at week_position 1..9, each with 5 examples
 *     (Mon–Fri) carrying diagram / video_url / image_url.
 *   - lean_week_focus pins cleared (they'd point at archived principles).
 *   - lean_curriculum_start_date set to the anchor Monday.
 *   - app_settings.lean_library_version stamped — the signal that tells
 *     the boot seeder (src/lib/lean-library-guard.ts) to stand down.
 *
 * Run (dry run — prints the plan, writes nothing):
 *   pnpm --filter @workspace/api-server exec tsx scripts/install-lean-curriculum-v2.ts
 *
 * Apply:
 *   DATABASE_URL=... pnpm --filter @workspace/api-server exec tsx \
 *     scripts/install-lean-curriculum-v2.ts --apply [--anchor=YYYY-MM-DD]
 *
 * --anchor defaults to NEXT Monday (Europe/London): the curriculum starts
 * fresh the following week, and getWeekFocusPrinciple clamps earlier days
 * to week 1, so the remainder of the current week previews week 1.
 */

import { pool } from "@workspace/db";
import { LEAN_CURRICULUM_V2, LEAN_QUIZZES_V2 } from "./lean-curriculum-v2-content";

const APPLY = process.argv.includes("--apply");
const ANCHOR_ARG = process.argv.find(a => a.startsWith("--anchor="))?.slice("--anchor=".length);
const ON_DEMAND_TITLE = "On-demand lessons";
export const LIBRARY_VERSION = "v2-seeing-waste-9wk";

const BANNED_TERMS = ["non-utilised talent", "non-utilized talent", "unused creativity", "DOWNTIME"];

/** Next Monday (YYYY-MM-DD), Europe/London. A Monday resolves to the
 *  FOLLOWING Monday — "start next week" is the whole point of the default. */
function nextMonday(): string {
  const todayIso = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
  const d = new Date(`${todayIso}T00:00:00Z`);
  const daysAhead = 7 - ((d.getUTCDay() + 6) % 7);
  d.setUTCDate(d.getUTCDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

function validate(): string[] {
  const problems: string[] = [];
  if (LEAN_CURRICULUM_V2.length !== 9) {
    problems.push(`expected 9 weeks, got ${LEAN_CURRICULUM_V2.length}`);
  }
  LEAN_CURRICULUM_V2.forEach((week, wi) => {
    if (week.lessons.length !== 5) {
      problems.push(`week ${wi + 1} "${week.title}": expected 5 lessons, got ${week.lessons.length}`);
    }
    week.lessons.forEach((l, li) => {
      const where = `week ${wi + 1} day ${li + 1} "${l.title}"`;
      for (const field of ["title", "summary", "explanationMd", "whatToShowMd", "deliveryNotesMd"] as const) {
        if (!l[field]?.trim()) problems.push(`${where}: empty ${field}`);
      }
      const everything = `${l.title} ${l.summary} ${l.explanationMd} ${l.whatToShowMd} ${l.deliveryNotesMd}`;
      for (const banned of BANNED_TERMS) {
        if (everything.toLowerCase().includes(banned.toLowerCase())) {
          problems.push(`${where}: banned term "${banned}"`);
        }
      }
      if (l.videoUrl && !/^https:\/\/(www\.)?youtu(\.be|be\.com)\//.test(l.videoUrl)) {
        problems.push(`${where}: videoUrl is not a YouTube URL: ${l.videoUrl}`);
      }
    });
  });
  if (LEAN_QUIZZES_V2.length !== LEAN_CURRICULUM_V2.length) {
    problems.push(`expected ${LEAN_CURRICULUM_V2.length} quizzes, got ${LEAN_QUIZZES_V2.length}`);
  }
  LEAN_QUIZZES_V2.forEach((quiz, wi) => {
    if (quiz.length < 3) problems.push(`week ${wi + 1} quiz: expected at least 3 questions, got ${quiz.length}`);
    quiz.forEach((q, qi) => {
      const where = `week ${wi + 1} quiz q${qi + 1}`;
      if (!q.question?.trim()) problems.push(`${where}: empty question`);
      if (!Array.isArray(q.options) || q.options.length < 2) problems.push(`${where}: needs at least 2 options`);
      if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.options.length) {
        problems.push(`${where}: answer index ${q.answer} out of range`);
      }
    });
  });
  return problems;
}

async function main() {
  const anchor = ANCHOR_ARG ?? nextMonday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor)) throw new Error(`bad --anchor "${anchor}" (want YYYY-MM-DD)`);
  const anchorDay = new Date(`${anchor}T00:00:00Z`).getUTCDay();
  if (anchorDay !== 1) throw new Error(`--anchor ${anchor} is not a Monday`);

  console.log(`\nLean curriculum v2 install — ${LEAN_CURRICULUM_V2.length} weeks — ${APPLY ? "APPLY" : "DRY RUN"}`);
  console.log(`anchor (week 1 starts): ${anchor}\n`);
  LEAN_CURRICULUM_V2.forEach((w, i) => {
    const media = w.lessons.map(l => (l.videoUrl ? "▶" : l.diagram ? "◆" : "·")).join("");
    console.log(`  wk ${i + 1}  [${media}]  ${w.title}`);
  });

  const problems = validate();
  if (problems.length) {
    console.error(`\nContent validation FAILED:\n${problems.map(p => `  - ${p}`).join("\n")}`);
    process.exit(1);
  }
  console.log("\nContent validation passed (9 weeks × 5 lessons, no banned terms).");

  if (!APPLY) {
    console.log("\nDry run only. Re-run with --apply to install.");
    return;
  }

  const pg = await pool.connect();
  try {
    await pg.query("BEGIN");
    await pg.query(
      `UPDATE lean_principles SET is_active = (title = $1), week_position = week_position + 1000, updated_at = NOW()`,
      [ON_DEMAND_TITLE],
    );
    await pg.query(`DELETE FROM lean_week_focus`);
    for (const [i, week] of LEAN_CURRICULUM_V2.entries()) {
      const { rows } = await pg.query<{ id: number }>(
        `INSERT INTO lean_principles (week_position, title, summary, quiz_json, is_active) VALUES ($1, $2, $3, $4, TRUE) RETURNING id`,
        [i + 1, week.title, week.summary, JSON.stringify(LEAN_QUIZZES_V2[i])],
      );
      const principleId = rows[0].id;
      for (const [j, l] of week.lessons.entries()) {
        await pg.query(
          `INSERT INTO lean_examples
             (principle_id, order_position, title, summary, explanation_md, what_to_show_md, delivery_notes_md, diagram, video_url, image_url, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, TRUE)`,
          [principleId, j, l.title, l.summary, l.explanationMd, l.whatToShowMd, l.deliveryNotesMd,
           l.diagram ?? null, l.videoUrl ?? null, l.imageUrl ?? null],
        );
      }
    }
    for (const [key, value] of [
      ["lean_curriculum_start_date", anchor],
      ["lean_library_version", LIBRARY_VERSION],
    ]) {
      await pg.query(
        `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [key, value],
      );
    }
    await pg.query("COMMIT");
  } catch (err) {
    await pg.query("ROLLBACK");
    throw err;
  } finally {
    pg.release();
  }

  console.log(`\nDone. ${LEAN_CURRICULUM_V2.length} weeks live at week_position 1..${LEAN_CURRICULUM_V2.length}; anchor ${anchor}.`);
  console.log(`Marker '${LIBRARY_VERSION}' stamped — the boot seeder now stands down.`);
  console.log(`Old principles archived at week_position 1001+ — nothing deleted.`);
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
