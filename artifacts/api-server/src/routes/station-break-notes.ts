/**
 * Optional note on a station break (Fix queue #61). The break screen offers
 * "Anything to note?" (e.g. "called back for APC") and autosaves it here; the
 * note shows in Analytics → Breaks & Lunches. Starting/ending breaks stays in
 * routes/production-plans.ts — this focused file only owns the note
 * (Development Charter rule 4).
 *
 *   PATCH /api/station-breaks/:breakId/note   { note: string | null }
 */
import { Router, type IRouter } from "express";
import { db, stationBreaksTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import * as z from "zod";
import { validate } from "../middleware/validate";
import { resolveRole } from "../middleware/roles";
import { BREAK_NOTE_MAX_LENGTH, canEditBreakNote, normaliseBreakNote } from "../lib/break-note";

const router: IRouter = Router();

const BreakNoteBody = z.object({
  // A little headroom over the limit: normaliseBreakNote trims then cuts.
  note: z.string().max(BREAK_NOTE_MAX_LENGTH * 2).nullable(),
});

router.patch("/:breakId/note", validate(BreakNoteBody), async (req, res) => {
  const breakId = Number(req.params.breakId);
  if (!Number.isInteger(breakId) || breakId <= 0) {
    res.status(400).json({ error: "Invalid break id" });
    return;
  }
  const [row] = await db
    .select({ id: stationBreaksTable.id, userId: stationBreaksTable.userId })
    .from(stationBreaksTable)
    .where(eq(stationBreaksTable.id, breakId));
  if (!row) { res.status(404).json({ error: "Break not found" }); return; }

  const role = (await resolveRole(req)) ?? null;
  if (!canEditBreakNote(row.userId, req.session.userId ?? null, role)) {
    res.status(403).json({ error: "You can only add a note to your own break" });
    return;
  }

  const note = normaliseBreakNote((req.body as z.infer<typeof BreakNoteBody>).note);
  try {
    await db.update(stationBreaksTable).set({ note }).where(eq(stationBreaksTable.id, breakId));
    res.json({ id: breakId, note });
  } catch (err) {
    console.error("[station-break-notes] save failed:", err);
    res.status(500).json({ error: "Could not save the note" });
  }
});

export default router;
