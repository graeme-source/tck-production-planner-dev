import { Router, type IRouter, type Request, type Response } from "express";
import {
  db, improvementSubmissionsTable, improvementCommentsTable, usersTable,
  stageOf, STAGE_LABEL, canMarkDone, markDoneBlocker, canReview,
} from "@workspace/db";
import { eq, desc, asc, sql } from "drizzle-orm";
import { z } from "zod";
import type { ImprovementSubmission } from "@workspace/db";
import type Anthropic from "@anthropic-ai/sdk";
import { validate } from "../middleware/validate";
import { getClaudeClient, isClaudeConfigured, CLAUDE_MODELS } from "../lib/ai/claude";
import { shortlistDuplicates } from "../lib/improvement-similarity";
import { intArrayLiteral } from "../lib/int-array-literal";
import { stitchBeforeAfter } from "../lib/improvement-media";
import { shouldAutoStitch } from "../lib/before-after-stitch";
import { ffmpegAvailable } from "../lib/sop-video";
import { singleFileUpload } from "../middleware/upload";

const router: IRouter = Router();

// One file per upload. 100MB cap covers short demo clips; images are checked
// against a tighter 10MB limit after the fact. Stored in Postgres as bytea
// (same approach as SOP step media) so no object storage is needed.
const mediaUpload = singleFileUpload("file", 100);
const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const VIDEO_MIMES = ["video/mp4", "video/webm", "video/quicktime", "video/ogg"];

/** Attachment counts for a set of improvements, in one query — the media
 *  rule needs them on every list, and N+1 on a kitchen iPad is not free. */
async function attachmentCounts(ids: number[]): Promise<Map<number, number>> {
  if (ids.length === 0) return new Map();
  const result = await db.execute<{ improvement_id: number; n: number }>(sql`
    SELECT improvement_id, COUNT(*)::int AS n
      FROM improvement_attachments
     WHERE improvement_id = ANY(${intArrayLiteral(ids)}::int[])
     GROUP BY improvement_id
  `);
  return new Map((result.rows ?? []).map(r => [Number(r.improvement_id), Number(r.n)]));
}

/**
 * Decorate a stored row with everything the screen needs to render it
 * without knowing any of the rules: which stage it's in, what that's
 * called, and whether this particular viewer may act on it.
 */
function decorate(
  row: ImprovementSubmission,
  mediaCount: number,
  viewer: { id?: number; isManager: boolean },
  votes: { count: number; mine: boolean } = { count: 0, mine: false },
  subjectTitle: string | null = null,
) {
  const stage = stageOf(row.progressStatus);
  return {
    ...row,
    stage,
    stageLabel: STAGE_LABEL[stage],
    mediaCount,
    voteCount: votes.count,
    votedByMe: votes.mine,
    subjectTitle,
    // An AI tag is a suggestion until someone confirms it, and the screen
    // says so rather than presenting a guess as a decision.
    subjectConfirmed: row.subjectSource === "human",
    // "Mine" means work I'm carrying, not everything I've ever typed in — an
    // idea logged for someone else belongs in "up for grabs", so this keys on
    // credit and assignment rather than who submitted it.
    isMine: !!viewer.id && (row.creditedTo === viewer.id || row.assignedTo === viewer.id),
    canMarkDone: canMarkDone(row.progressStatus, mediaCount),
    markDoneBlocker: markDoneBlocker(row.progressStatus, mediaCount),
    canReview: viewer.isManager && canReview(row.progressStatus),
  };
}

async function viewerOf(req: Request): Promise<{ id?: number; isManager: boolean }> {
  const id = req.session.userId ?? undefined;
  let role: string | undefined = req.session.userRole;
  if (id && !role) {
    const [user] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, id));
    role = user?.role;
    if (role === "admin" || role === "manager" || role === "viewer") req.session.userRole = role;
  }
  return { id, isManager: role === "admin" || role === "manager" };
}

router.get("/", async (req: Request, res: Response) => {
  try {
    const rows = await db
      .select()
      .from(improvementSubmissionsTable)
      .orderBy(desc(improvementSubmissionsTable.createdAt));
    const ids = rows.map(r => r.id);
    const counts = await attachmentCounts(ids);
    const viewer = await viewerOf(req);

    // Votes and subject names in one query each — the list is rendered on a
    // kitchen iPad and N+1 across a few hundred improvements is not free.
    const voteRows = ids.length === 0 ? { rows: [] } : await db.execute<{ improvement_id: number; n: number; mine: boolean }>(sql`
      SELECT improvement_id,
             COUNT(*)::int AS n,
             BOOL_OR(user_id = ${viewer.id ?? -1}) AS mine
        FROM improvement_votes
       WHERE improvement_id = ANY(${intArrayLiteral(ids)}::int[])
       GROUP BY improvement_id
    `);
    const votesById = new Map(
      (voteRows.rows ?? []).map(v => [Number(v.improvement_id), { count: Number(v.n), mine: !!v.mine }]),
    );

    const subjectRows = await db.execute<{ id: number; title: string }>(sql`SELECT id, title FROM lean_subjects`);
    const subjectTitles = new Map((subjectRows.rows ?? []).map(s => [Number(s.id), s.title]));

    // Media metadata rides the list so the feed can show photos and play
    // videos inline (Graeme, 2026-08-28: "like a social media news feed").
    // Stitched before/after clips sort first — one clip tells the story.
    const mediaRows = ids.length === 0 ? { rows: [] } : await db.execute<{ id: number; improvement_id: number; kind: string; phase: string | null }>(sql`
      SELECT id, improvement_id, kind, phase
        FROM improvement_attachments
       WHERE improvement_id = ANY(${intArrayLiteral(ids)}::int[])
       ORDER BY (phase = 'stitched') DESC NULLS LAST, id ASC
    `);
    const mediaById = new Map<number, Array<{ id: number; kind: string; phase: string | null }>>();
    for (const m of (mediaRows.rows ?? [])) {
      const list = mediaById.get(Number(m.improvement_id)) ?? [];
      list.push({ id: Number(m.id), kind: m.kind, phase: m.phase });
      mediaById.set(Number(m.improvement_id), list);
    }

    res.json(rows.map(r => ({
      ...decorate(
        r,
        counts.get(r.id) ?? 0,
        viewer,
        votesById.get(r.id) ?? { count: 0, mine: false },
        r.subjectId != null ? subjectTitles.get(r.subjectId) ?? null : null,
      ),
      media: mediaById.get(r.id) ?? [],
    })));
  } catch (err) {
    console.error("Error fetching improvement submissions:", err);
    res.status(500).json({ error: "Failed to fetch improvement submissions" });
  }
});

// POST /:id/done — "I've done this." The team's main action, and the point
// where the media rule bites: no photo or video, no improvement. Anyone can
// mark their own work done; a manager still has to approve it.
router.post("/:id/done", async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [row] = await db.select().from(improvementSubmissionsTable).where(eq(improvementSubmissionsTable.id, id));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }

    const counts = await attachmentCounts([id]);
    const mediaCount = counts.get(id) ?? 0;
    if (!canMarkDone(row.progressStatus, mediaCount)) {
      res.status(409).json({ error: markDoneBlocker(row.progressStatus, mediaCount) });
      return;
    }

    const userId = req.session.userId ?? null;
    let userName: string | null = null;
    if (userId) {
      const [user] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
      userName = user?.name ?? null;
    }

    const [updated] = await db.update(improvementSubmissionsTable)
      .set({
        progressStatus: "awaiting_approval",
        doneAt: new Date(),
        // Whoever says they did it gets the credit, unless it's already set.
        creditedTo: row.creditedTo ?? userId,
        creditedToName: row.creditedToName ?? userName,
        // Clear any previous send-back note; this is a fresh attempt.
        reviewNote: null,
        updatedAt: new Date(),
      })
      .where(eq(improvementSubmissionsTable.id, id))
      .returning();

    res.json(decorate(updated!, mediaCount, await viewerOf(req)));
  } catch (err) {
    console.error("Error marking improvement done:", err);
    res.status(500).json({ error: "Failed to mark it as done" });
  }
});

// POST /:id/review — a manager approves it or sends it back. Approval is
// what makes an improvement count for the person who did it.
router.post("/:id/review", async (req: Request, res: Response) => {
  const viewer = await viewerOf(req);
  if (!viewer.isManager) { res.status(403).json({ error: "Manager or admin access required" }); return; }

  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const approve = req.body?.approve === true;
  const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 2000) : "";
  if (!approve && !note) {
    res.status(400).json({ error: "Say what needs another look, so they know what to change." });
    return;
  }

  try {
    const [row] = await db.select().from(improvementSubmissionsTable).where(eq(improvementSubmissionsTable.id, id));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    if (!canReview(row.progressStatus)) {
      res.status(409).json({ error: "This one isn't waiting for approval." });
      return;
    }

    let reviewerName: string | null = null;
    if (viewer.id) {
      const [user] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, viewer.id));
      reviewerName = user?.name ?? null;
    }

    // A manager may move the credit — the person who did the work isn't
    // always the person who typed it in.
    let creditedTo = row.creditedTo;
    let creditedToName = row.creditedToName;
    if (approve && req.body?.creditedTo != null) {
      const creditId = parseInt(String(req.body.creditedTo), 10);
      if (isNaN(creditId)) { res.status(400).json({ error: "Invalid creditedTo" }); return; }
      const [person] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, creditId));
      if (!person) { res.status(400).json({ error: "That person isn't on the team list." }); return; }
      creditedTo = creditId;
      creditedToName = person.name;
    }

    const [updated] = await db.update(improvementSubmissionsTable)
      .set({
        progressStatus: approve ? "complete" : "rejected",
        approvedBy: viewer.id ?? null,
        approvedByName: reviewerName,
        approvedAt: approve ? new Date() : null,
        reviewNote: note || null,
        creditedTo,
        creditedToName,
        updatedAt: new Date(),
      })
      .where(eq(improvementSubmissionsTable.id, id))
      .returning();

    const counts = await attachmentCounts([id]);
    res.json(decorate(updated!, counts.get(id) ?? 0, viewer));
  } catch (err) {
    console.error("Error reviewing improvement:", err);
    res.status(500).json({ error: "Failed to save the review" });
  }
});

// ── Duplicates, votes and lean subjects (the AI lift) ────────────────────

const duplicateCheckSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(4000).optional(),
});

/**
 * POST /check-duplicate — "has someone already reported this?"
 *
 * Runs before anything is saved. Word-overlap picks a shortlist of at most
 * five open improvements, then a model is asked which of those are genuinely
 * the same problem — the shortlist keeps that question small and cheap no
 * matter how many improvements pile up.
 *
 * With no API key configured this still works: the shortlist is returned on
 * its own, marked as unconfirmed, so the obvious repeats are still caught.
 */
router.post("/check-duplicate", validate(duplicateCheckSchema), async (req: Request, res: Response) => {
  const { title, description } = req.body as z.infer<typeof duplicateCheckSchema>;
  try {
    // Only things still outstanding can be duplicated — an improvement that
    // was made and approved months ago is history, not a live report.
    const open = await db
      .select({
        id: improvementSubmissionsTable.id,
        title: improvementSubmissionsTable.title,
        description: improvementSubmissionsTable.description,
      })
      .from(improvementSubmissionsTable)
      .where(sql`${improvementSubmissionsTable.progressStatus} <> 'complete'`)
      .orderBy(desc(improvementSubmissionsTable.createdAt))
      .limit(300);

    const shortlist = shortlistDuplicates({ title, description }, open);
    if (shortlist.length === 0) { res.json({ matches: [] }); return; }

    if (!isClaudeConfigured()) {
      res.json({ matches: shortlist.map(c => ({ id: c.id, title: c.title, confirmed: false })) });
      return;
    }

    const response = await getClaudeClient().messages.create({
      model: CLAUDE_MODELS.haiku,
      max_tokens: 1024,
      system: `You decide whether a newly reported workplace problem is THE SAME problem as one already reported at a UK food production kitchen.

Same problem means the same thing, in the same place, needing the same fix — even if worded completely differently. Two different things that happen to share words (two separate broken items, two different benches) are NOT the same.

Be strict. A wrong match makes someone's report vanish into someone else's, which is worse than a duplicate.`,
      tools: [{
        name: "emit_matches",
        description: "Return which of the existing reports describe the same problem.",
        input_schema: {
          type: "object",
          properties: {
            matchIds: {
              type: "array",
              items: { type: "number" },
              description: "Ids of existing reports that are the SAME problem. Empty if none are.",
            },
          },
          required: ["matchIds"],
        },
      }],
      messages: [{
        role: "user",
        content: `NEW REPORT:\n${title}\n${description ?? ""}\n\nEXISTING REPORTS:\n${
          shortlist.map(c => `[${c.id}] ${c.title} — ${c.description}`).join("\n")
        }\n\nWhich existing reports are the same problem? Call emit_matches.`,
      }],
    });

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "emit_matches",
    );
    const matchIds: number[] = Array.isArray((toolUse?.input as { matchIds?: unknown })?.matchIds)
      ? ((toolUse!.input as { matchIds: unknown[] }).matchIds).map(Number).filter(Number.isInteger)
      : [];

    const byId = new Map(shortlist.map(c => [c.id, c]));
    res.json({
      matches: matchIds
        .filter(id => byId.has(id))
        .map(id => ({ id, title: byId.get(id)!.title, confirmed: true })),
    });
  } catch (err) {
    // A duplicate check failing must never stop someone reporting a problem.
    console.error("[Improvements] duplicate check failed:", err);
    res.json({ matches: [] });
  }
});

// POST /:id/vote — "this one matters to me too". Toggles, so tapping it
// again takes the vote back.
router.post("/:id/vote", async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const userId = req.session.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  try {
    const existing = await db.execute<{ id: number }>(sql`
      SELECT id FROM improvement_votes WHERE improvement_id = ${id} AND user_id = ${userId}
    `);
    const had = (existing.rows ?? []).length > 0;
    if (had) {
      await db.execute(sql`DELETE FROM improvement_votes WHERE improvement_id = ${id} AND user_id = ${userId}`);
    } else {
      await db.execute(sql`
        INSERT INTO improvement_votes (improvement_id, user_id) VALUES (${id}, ${userId})
        ON CONFLICT DO NOTHING
      `);
    }
    const counted = await db.execute<{ n: number }>(sql`
      SELECT COUNT(*)::int AS n FROM improvement_votes WHERE improvement_id = ${id}
    `);
    res.json({ voted: !had, votes: Number((counted.rows ?? [])[0]?.n ?? 0) });
  } catch (err) {
    console.error("[Improvements] vote failed:", err);
    res.status(500).json({ error: "Couldn't record your vote" });
  }
});

/**
 * Suggest which lean subject an improvement is an example of.
 *
 * Fire-and-forget: called after an improvement is created so the person
 * isn't kept waiting, and any failure is silent because a missing tag is a
 * cosmetic loss. Stored with subject_source 'ai' so it always reads as a
 * suggestion until a human confirms it.
 */
export async function suggestLeanSubject(improvementId: number): Promise<void> {
  if (!isClaudeConfigured()) return;
  try {
    const [improvement] = await db
      .select({ title: improvementSubmissionsTable.title, description: improvementSubmissionsTable.description })
      .from(improvementSubmissionsTable)
      .where(eq(improvementSubmissionsTable.id, improvementId));
    if (!improvement) return;

    const subjects = await db.execute<{ id: number; title: string; nutshell: string }>(sql`
      SELECT id, title, nutshell FROM lean_subjects
       WHERE is_archived = FALSE AND audience = 'team'
       ORDER BY sort_order
    `);
    const options = subjects.rows ?? [];
    if (options.length === 0) return;

    const response = await getClaudeClient().messages.create({
      model: CLAUDE_MODELS.haiku,
      max_tokens: 512,
      system: `You tag workplace improvements at a UK food production kitchen with the lean subject they best illustrate, so the team can see which ideas they're putting into practice.

Pick the single closest subject. If nothing fits well, return null rather than forcing one — a wrong tag is worse than no tag.`,
      tools: [{
        name: "emit_subject",
        description: "Return the lean subject this improvement best illustrates.",
        input_schema: {
          type: "object",
          properties: {
            subjectId: { type: ["number", "null"], description: "Id of the closest subject, or null if none fit." },
          },
          required: ["subjectId"],
        },
      }],
      messages: [{
        role: "user",
        content: `IMPROVEMENT:\n${improvement.title}\n${improvement.description}\n\nSUBJECTS:\n${
          options.map(s => `[${s.id}] ${s.title} — ${s.nutshell}`).join("\n")
        }\n\nWhich subject does this best illustrate? Call emit_subject.`,
      }],
    });

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "emit_subject",
    );
    const subjectId = Number((toolUse?.input as { subjectId?: unknown })?.subjectId);
    if (!Number.isInteger(subjectId)) return;
    if (!options.some(s => Number(s.id) === subjectId)) return;

    await db.update(improvementSubmissionsTable)
      .set({ subjectId, subjectSource: "ai" })
      .where(eq(improvementSubmissionsTable.id, improvementId));
  } catch (err) {
    console.error("[Improvements] subject suggestion failed:", err);
  }
}

/**
 * POST /:id/stitch — join the before and the after into one clip.
 *
 * Stored as a normal attachment with phase 'stitched', so it streams through
 * the same endpoint as everything else and survives whatever happens to the
 * two halves. Re-running replaces the previous one rather than piling copies
 * up: the halves change as people re-shoot them.
 */
type StitchOutcome =
  | { ok: true; attachmentId: number | undefined; bytes: number }
  | { ok: false; status: number; error: string };

/** The stitch itself — shared by the manual route below and the automatic
 *  trigger in the attachment upload, so both produce identical clips. */
async function stitchImprovementClip(id: number): Promise<StitchOutcome> {
  if (!(await ffmpegAvailable())) {
    return { ok: false, status: 503, error: "Video joining isn't available on this server." };
  }

  // The most recent of each half — someone who re-shoots the after means
  // the newest one, not the first.
  const rows = toRows<{ id: number; kind: string; phase: string | null; data: Buffer }>(await db.execute(sql`
    SELECT DISTINCT ON (phase) id, kind, phase, data
      FROM improvement_attachments
     WHERE improvement_id = ${id} AND phase IN ('before', 'after')
     ORDER BY phase, id DESC
  `));
  const before = rows.find(r => r.phase === "before");
  const after = rows.find(r => r.phase === "after");
  if (!before || !after) {
    return { ok: false, status: 409, error: "Needs both a before and an after before they can be joined." };
  }

  const stitched = await stitchBeforeAfter([
    { data: Buffer.isBuffer(before.data) ? before.data : Buffer.from(before.data), kind: before.kind, label: "Before" },
    { data: Buffer.isBuffer(after.data) ? after.data : Buffer.from(after.data), kind: after.kind, label: "After" },
  ]);

  await db.execute(sql`DELETE FROM improvement_attachments WHERE improvement_id = ${id} AND phase = 'stitched'`);
  const created = toRows<{ id: number }>(await db.execute(sql`
    INSERT INTO improvement_attachments (improvement_id, kind, mime, data, file_name, phase)
    VALUES (${id}, 'video', 'video/mp4', ${stitched}, 'before-after.mp4', 'stitched')
    RETURNING id
  `));

  return { ok: true, attachmentId: created[0]?.id, bytes: stitched.length };
}

router.post("/:id/stitch", async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  try {
    const outcome = await stitchImprovementClip(id);
    if (!outcome.ok) {
      res.status(outcome.status).json({ error: outcome.error });
      return;
    }
    res.json({ ok: true, attachmentId: outcome.attachmentId, bytes: outcome.bytes });
  } catch (err) {
    console.error("[Improvements] stitch failed:", err);
    res.status(500).json({ error: "Couldn't join those two clips together." });
  }
});

// GET /scoreboard — approved improvements per person. The number that makes
// the whole thing worth doing (Objective E: improvements per person).
router.get("/scoreboard", async (_req: Request, res: Response) => {
  try {
    // `signed_off` counts only what a manager actually approved. Everything
    // completed before sign-off existed was retro-credited by migration 0059
    // so the tallies started from real history — but it was never approved by
    // anyone, and a screen that calls it "approved" is telling a small lie
    // (Graeme spotted exactly this, 2026-08-26).
    const result = await db.execute<{ user_id: number | null; name: string | null; n: number; signed_off: number; last_at: Date | null }>(sql`
      SELECT credited_to AS user_id,
             COALESCE(credited_to_name, 'Unknown') AS name,
             COUNT(*)::int AS n,
             COUNT(approved_at)::int AS signed_off,
             MAX(approved_at) AS last_at
        FROM improvement_submissions
       WHERE progress_status = 'complete' AND credited_to IS NOT NULL
       GROUP BY credited_to, credited_to_name
       ORDER BY n DESC, name ASC
    `);
    res.json((result.rows ?? []).map(r => ({
      userId: r.user_id,
      name: r.name,
      count: Number(r.n),
      signedOff: Number(r.signed_off),
      lastAt: r.last_at,
    })));
  } catch (err) {
    console.error("Error building improvement scoreboard:", err);
    res.status(500).json({ error: "Failed to load the scoreboard" });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    // `claim` false = "it needs doing", logged for whoever picks it up. It
    // stays unassigned so it surfaces as up for grabs rather than sitting on
    // the reporter's own list. Defaults true (the old behaviour) so existing
    // callers — the Report modal, the station screens — are unaffected.
    const { title, description, station, type, reportContext, claim } = req.body;
    const claimed = claim !== false;
    if (!title || !description || !station) {
      res.status(400).json({ error: "title, description, and station are required" });
      return;
    }

    const submissionType = type === "struggle" ? "struggle" : "improvement";

    const userId = req.session.userId;
    let submittedByName: string | null = null;
    if (userId) {
      const [user] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
      submittedByName = user?.name ?? null;
    }

    const [row] = await db
      .insert(improvementSubmissionsTable)
      .values({
        title,
        description,
        station,
        type: submissionType,
        submittedBy: userId ?? null,
        submittedByName,
        // Claimed submissions start assigned to whoever raised them; managers
        // can reassign from the Improvements table.
        assignedTo: claimed ? userId ?? null : null,
        assignedToName: claimed ? submittedByName : null,
        reportContext: reportContext || null,
      })
      .returning();

    // Tag it with the lean subject it illustrates, without keeping anyone
    // waiting — a missing tag is cosmetic, a slow submit is not.
    if (row) void suggestLeanSubject(row.id);

    res.status(201).json(row);
  } catch (err) {
    console.error("Error creating improvement submission:", err);
    res.status(500).json({ error: "Failed to create improvement submission" });
  }
});

router.patch("/:id", async (req: Request, res: Response) => {
  const role = req.session.userRole;
  if (role !== "admin" && role !== "manager") {
    res.status(403).json({ error: "Manager or admin access required" });
    return;
  }

  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const { approvalTier, progressStatus, notes, title, description, assignedTo } = req.body;

    type UpdatePayload = Partial<Pick<ImprovementSubmission, "approvalTier" | "progressStatus" | "notes" | "title" | "description" | "assignedTo" | "assignedToName" | "updatedAt">>;
    const updates: UpdatePayload = { updatedAt: new Date() };
    if (approvalTier !== undefined) updates.approvalTier = approvalTier;
    if (progressStatus !== undefined) {
      // Two-status model: anything that isn't complete is simply submitted.
      updates.progressStatus = progressStatus === "complete" ? "complete" : "submitted_for_review";
    }
    if (notes !== undefined) updates.notes = notes;
    if (title !== undefined) {
      if (!String(title).trim()) { res.status(400).json({ error: "title cannot be empty" }); return; }
      updates.title = String(title).trim();
    }
    if (description !== undefined) {
      if (!String(description).trim()) { res.status(400).json({ error: "description cannot be empty" }); return; }
      updates.description = String(description).trim();
    }
    if (assignedTo !== undefined) {
      if (assignedTo === null || assignedTo === "") {
        updates.assignedTo = null;
        updates.assignedToName = null;
      } else {
        const assigneeId = parseInt(String(assignedTo), 10);
        if (isNaN(assigneeId)) { res.status(400).json({ error: "Invalid assignedTo" }); return; }
        const [assignee] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, assigneeId));
        if (!assignee) { res.status(400).json({ error: "Assignee not found" }); return; }
        updates.assignedTo = assigneeId;
        updates.assignedToName = assignee.name;
      }
    }

    const [row] = await db
      .update(improvementSubmissionsTable)
      .set(updates)
      .where(eq(improvementSubmissionsTable.id, id))
      .returning();

    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    res.json(row);
  } catch (err) {
    console.error("Error updating improvement submission:", err);
    res.status(500).json({ error: "Failed to update improvement submission" });
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  const role = req.session.userRole;
  if (role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const [row] = await db
      .delete(improvementSubmissionsTable)
      .where(eq(improvementSubmissionsTable.id, id))
      .returning({ id: improvementSubmissionsTable.id });

    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    res.status(204).send();
  } catch (err) {
    console.error("Error deleting improvement submission:", err);
    res.status(500).json({ error: "Failed to delete improvement submission" });
  }
});

// Comments
router.get("/:id/comments", async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const rows = await db
      .select()
      .from(improvementCommentsTable)
      .where(eq(improvementCommentsTable.improvementId, id))
      .orderBy(asc(improvementCommentsTable.createdAt));
    res.json(rows);
  } catch (err) {
    console.error("Error fetching comments:", err);
    res.status(500).json({ error: "Failed to fetch comments" });
  }
});

router.post("/:id/comments", async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const { comment } = req.body;
    if (!comment || !comment.trim()) { res.status(400).json({ error: "comment is required" }); return; }

    const userId = req.session.userId;
    let userName: string | null = null;
    if (userId) {
      const [user] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
      userName = user?.name ?? null;
    }

    const [row] = await db
      .insert(improvementCommentsTable)
      .values({ improvementId: id, userId: userId ?? null, userName, comment: comment.trim() })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    console.error("Error creating comment:", err);
    res.status(500).json({ error: "Failed to create comment" });
  }
});

// ── Attachments (photos & videos) ────────────────────────────────────────

interface AttachmentRow { id: number; kind: string; mime: string; file_name: string | null; created_at: Date | string; }
const toRows = <T,>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[]));

// List attachment metadata for an improvement (no bytes).
router.get("/:id/attachments", async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const rows = toRows<AttachmentRow & { phase: string | null }>(await db.execute(sql`
    SELECT id, kind, mime, file_name, created_at, phase
    FROM improvement_attachments WHERE improvement_id = ${id} ORDER BY created_at ASC
  `));
  res.json(rows.map(a => ({
    id: a.id, kind: a.kind, mime: a.mime, fileName: a.file_name, phase: a.phase,
    createdAt: a.created_at instanceof Date ? a.created_at.toISOString() : a.created_at,
  })));
});

// Upload a photo or video to an improvement.
router.post("/:id/attachments", mediaUpload, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }
  const mime = req.file.mimetype;
  const isImage = IMAGE_MIMES.includes(mime);
  const isVideo = VIDEO_MIMES.includes(mime);
  if (!isImage && !isVideo) {
    res.status(400).json({ error: "Unsupported file type. Use JPEG/PNG/WebP/GIF or MP4/WebM/MOV/OGG." });
    return;
  }
  if (isImage && req.file.size > 10 * 1024 * 1024) {
    res.status(400).json({ error: "Image too large (max 10MB)." });
    return;
  }
  const exists = toRows<{ id: number }>(await db.execute(sql`SELECT id FROM improvement_submissions WHERE id = ${id}`));
  if (exists.length === 0) { res.status(404).json({ error: "Improvement not found" }); return; }
  // "before" = what it looked like when the problem was spotted, "after" =
  // once it was fixed. Anything else is just a photo (migration 0060).
  const phase = req.body?.phase === "before" || req.body?.phase === "after" ? req.body.phase : null;
  const rows = toRows<{ id: number }>(await db.execute(sql`
    INSERT INTO improvement_attachments (improvement_id, kind, mime, data, file_name, phase)
    VALUES (${id}, ${isImage ? "image" : "video"}, ${mime}, ${req.file.buffer}, ${req.file.originalname ?? null}, ${phase})
    RETURNING id
  `));

  // An upload that completes a before/after pair with a video in it
  // re-stitches the joined clip in the background — the feed leads with the
  // stitched clip, so it should exist without anyone hunting for the button
  // (Graeme, 2026-09-01: his card showed only the after half).
  if (phase) {
    const halves = toRows<{ kind: string; phase: string | null }>(await db.execute(sql`
      SELECT DISTINCT ON (phase) kind, phase
        FROM improvement_attachments
       WHERE improvement_id = ${id} AND phase IN ('before', 'after')
       ORDER BY phase, id DESC
    `));
    if (shouldAutoStitch(halves)) {
      stitchImprovementClip(id).then(
        outcome => { if (!outcome.ok) console.warn(`[Improvements] auto-stitch skipped for ${id}: ${outcome.error}`); },
        err => console.error(`[Improvements] auto-stitch failed for ${id}:`, err),
      );
    }
  }

  res.status(201).json({ id: rows[0]?.id, kind: isImage ? "image" : "video", mime, phase });
});

// Stream the bytes of a single attachment.
router.get("/attachments/:attId", async (req: Request, res: Response) => {
  const attId = parseInt(String(req.params.attId), 10);
  if (isNaN(attId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const rows = toRows<{ mime: string; data: Buffer; kind: string }>(await db.execute(sql`
    SELECT mime, data, kind FROM improvement_attachments WHERE id = ${attId}
  `));
  const row = rows[0];
  if (!row || !row.data || !row.mime) { res.status(404).json({ error: "Not found" }); return; }
  res.setHeader("Content-Type", row.mime);
  res.setHeader("Cache-Control", "private, max-age=300");
  if (row.kind === "video") res.setHeader("Accept-Ranges", "bytes");
  res.send(row.data);
});

// Delete an attachment (manager/admin).
router.delete("/attachments/:attId", async (req: Request, res: Response) => {
  const role = req.session.userRole;
  if (role !== "admin" && role !== "manager") { res.status(403).json({ error: "Manager or admin access required" }); return; }
  const attId = parseInt(String(req.params.attId), 10);
  if (isNaN(attId)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.execute(sql`DELETE FROM improvement_attachments WHERE id = ${attId}`);
  res.json({ ok: true });
});

export default router;
