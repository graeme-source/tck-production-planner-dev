#!/usr/bin/env tsx
/**
 * sync-lean-lesson-media.ts
 *
 * Pushes the media fields (video_url, diagram, image_url) and quiz_json from
 * lean-curriculum-v2-content.ts onto an ALREADY-INSTALLED curriculum,
 * matching lessons by (week_position, order_position). For content tweaks —
 * swapping a video, adding a diagram — without the full archive-and-reinstall
 * of install-lean-curriculum-v2.ts, so principle/example ids (and any
 * lesson reviews or meeting pins pointing at them) stay put.
 *
 * VIDEOS ARE OPT-IN (--videos): the founder swaps videos in-app from the
 * preview page, and those choices must never be silently reverted by a
 * routine sync. Only pass --videos when the content file's video list is
 * deliberately the new truth (e.g. the Tierney-first swap).
 *
 * Dry run (default):
 *   DATABASE_URL=... pnpm --filter @workspace/api-server exec tsx \
 *     scripts/sync-lean-lesson-media.ts
 * Apply: add --apply (and --videos to include video_url changes)
 */
import { pool } from "@workspace/db";
import { LEAN_CURRICULUM_V2, LEAN_QUIZZES_V2 } from "./lean-curriculum-v2-content";

const APPLY = process.argv.includes("--apply");
const SYNC_VIDEOS = process.argv.includes("--videos");

async function main() {
  console.log(`Lean lesson media sync — ${APPLY ? "APPLY" : "DRY RUN"}\n`);
  let changed = 0, missing = 0;
  for (const [wi, week] of LEAN_CURRICULUM_V2.entries()) {
    const { rows: [p] } = await pool.query<{ id: number; quiz_json: string | null }>(
      `SELECT id, quiz_json FROM lean_principles WHERE week_position = $1 AND is_active AND week_position < 1000`,
      [wi + 1],
    );
    if (!p) { console.log(`wk ${wi + 1}: no active principle — skipped`); missing++; continue; }

    const wantQuiz = JSON.stringify(LEAN_QUIZZES_V2[wi]);
    if (p.quiz_json !== wantQuiz) {
      console.log(`wk ${wi + 1}: quiz_json differs`);
      changed++;
      if (APPLY) await pool.query(`UPDATE lean_principles SET quiz_json = $1, updated_at = NOW() WHERE id = $2`, [wantQuiz, p.id]);
    }

    for (const [li, lesson] of week.lessons.entries()) {
      const { rows: [ex] } = await pool.query<{ id: number; title: string; video_url: string | null; diagram: string | null; image_url: string | null }>(
        `SELECT id, title, video_url, diagram, image_url FROM lean_examples
         WHERE principle_id = $1 AND order_position = $2 AND is_active`,
        [p.id, li],
      );
      if (!ex) { console.log(`wk ${wi + 1} day ${li + 1}: no example — skipped`); missing++; continue; }
      const updates: string[] = [];
      const videoDiffers = (ex.video_url ?? null) !== (lesson.videoUrl ?? null);
      if (videoDiffers && SYNC_VIDEOS) updates.push(`video ${ex.video_url ?? "—"} -> ${lesson.videoUrl ?? "—"}`);
      else if (videoDiffers) console.log(`wk ${wi + 1} day ${li + 1} "${ex.title}": video differs (kept — pass --videos to sync)`);
      if ((ex.diagram ?? null) !== (lesson.diagram ?? null)) updates.push(`diagram ${ex.diagram ?? "—"} -> ${lesson.diagram ?? "—"}`);
      if ((ex.image_url ?? null) !== (lesson.imageUrl ?? null)) updates.push(`image ${ex.image_url ?? "—"} -> ${lesson.imageUrl ?? "—"}`);
      if (updates.length === 0) continue;
      changed++;
      console.log(`wk ${wi + 1} day ${li + 1} "${ex.title}": ${updates.join(" · ")}`);
      if (APPLY) {
        await pool.query(
          `UPDATE lean_examples SET video_url = $1, diagram = $2, image_url = $3, updated_at = NOW() WHERE id = $4`,
          [SYNC_VIDEOS ? (lesson.videoUrl ?? null) : ex.video_url, lesson.diagram ?? null, lesson.imageUrl ?? null, ex.id],
        );
      }
    }
  }
  console.log(`\n${changed} change(s)${APPLY ? " applied" : " (dry run)"}, ${missing} missing row(s).`);
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
