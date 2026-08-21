/**
 * Standards & SOPs — multi-step SOPs, each step has a description + an
 * optional image. Images are stored directly in Postgres as BYTEA so the
 * feature works identically on local dev and production without needing
 * object storage configuration. Served via a dedicated streaming route.
 *
 * Keep the main list/get queries light — never SELECT image_data on rows
 * that go into a list payload. Only the /image endpoint reads the bytes.
 */

import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { buildSopFromVideo, ffmpegAvailable } from "../lib/sop-video";
import { isClaudeConfigured } from "../lib/ai/claude";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
// Videos can run to a few minutes — bump the cap to 100MB so short demo
// clips (mp4/webm/quicktime) fit without re-encoding.
const videoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  next();
}

// Type alias (not interface) so it satisfies db.execute's
// `Record<string, unknown>` constraint — interfaces have no implicit
// index signature.
type SopRow = {
  id: number;
  title: string;
  stations: string[] | null;
  tags: string[] | null;
  author_id: number | null;
  created_at: Date;
  updated_at: Date;
  author_name: string | null;
  step_count: number;
  first_image_step_id: number | null;
  steps_per_page: number | null;
};

function shapeSop(row: SopRow) {
  return {
    id: row.id,
    title: row.title,
    stations: row.stations ?? [],
    tags: row.tags ?? [],
    authorId: row.author_id,
    authorName: row.author_name ?? "(imported)",
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    stepCount: Number(row.step_count) || 0,
    coverImageStepId: row.first_image_step_id,
    stepsPerPage: row.steps_per_page ?? null,
  };
}

// List SOPs — optional ?station=<key> filter. No image bytes included.
router.get("/", requireAuth, async (req, res) => {
  try {
    const station = typeof req.query.station === "string" ? req.query.station : null;
    const rows = station
      ? await db.execute<SopRow>(sql`
          SELECT s.id, s.title, s.stations, s.tags, s.author_id, s.created_at, s.updated_at, s.steps_per_page,
                 u.name AS author_name,
                 (SELECT COUNT(*)::int FROM sop_steps st WHERE st.sop_id = s.id) AS step_count,
                 (SELECT st.id FROM sop_steps st WHERE st.sop_id = s.id AND st.image_mime IS NOT NULL ORDER BY st.position ASC LIMIT 1) AS first_image_step_id
          FROM standards_sops s
          LEFT JOIN app_users u ON u.id = s.author_id
          WHERE COALESCE(array_length(s.stations, 1), 0) = 0 OR ${station} = ANY(s.stations)
          ORDER BY s.updated_at DESC
        `)
      : await db.execute<SopRow>(sql`
          SELECT s.id, s.title, s.stations, s.tags, s.author_id, s.created_at, s.updated_at, s.steps_per_page,
                 u.name AS author_name,
                 (SELECT COUNT(*)::int FROM sop_steps st WHERE st.sop_id = s.id) AS step_count,
                 (SELECT st.id FROM sop_steps st WHERE st.sop_id = s.id AND st.image_mime IS NOT NULL ORDER BY st.position ASC LIMIT 1) AS first_image_step_id
          FROM standards_sops s
          LEFT JOIN app_users u ON u.id = s.author_id
          ORDER BY s.updated_at DESC
        `);
    const list = ((rows.rows ?? rows) as SopRow[]).map(shapeSop);
    res.json(list);
  } catch (err) {
    console.error("[standards] list failed:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load SOPs" });
  }
});

type StepRow = {
  id: number;
  sop_id: number;
  position: number;
  description: string;
  has_image: boolean;
  has_video: boolean;
  video_mime: string | null;
};

// Get one SOP with its steps.
router.get("/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const sopRows = await db.execute<SopRow>(sql`
    SELECT s.id, s.title, s.stations, s.tags, s.author_id, s.created_at, s.updated_at, s.steps_per_page,
           u.name AS author_name,
           (SELECT COUNT(*)::int FROM sop_steps st WHERE st.sop_id = s.id) AS step_count,
           (SELECT st.id FROM sop_steps st WHERE st.sop_id = s.id AND st.image_mime IS NOT NULL ORDER BY st.position ASC LIMIT 1) AS first_image_step_id
    FROM standards_sops s
    LEFT JOIN app_users u ON u.id = s.author_id
    WHERE s.id = ${id}
  `);
  const sop = ((sopRows.rows ?? sopRows) as SopRow[])[0];
  if (!sop) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const stepsRows = await db.execute<StepRow>(sql`
    SELECT id, sop_id, position, description,
           (image_mime IS NOT NULL) AS has_image,
           (video_mime IS NOT NULL) AS has_video,
           video_mime
    FROM sop_steps
    WHERE sop_id = ${id}
    ORDER BY position ASC, id ASC
  `);
  const steps = ((stepsRows.rows ?? stepsRows) as StepRow[]).map(s => ({
    id: s.id,
    position: s.position,
    description: s.description,
    hasImage: s.has_image,
    hasVideo: s.has_video,
    videoMime: s.video_mime,
  }));
  res.json({ ...shapeSop(sop), steps });
});

// Build a PostgreSQL array literal for a list of free-form strings.
// Values that contain whitespace, commas, or quotes are double-quoted
// with inner quotes/backslashes escaped. Tags can legitimately contain
// spaces ("Stop rotation") so we can't rely on the no-quoting-needed
// shortcut used for station keys.
function arrayLiteral(values: string[]): string {
  if (values.length === 0) return "{}";
  const quoted = values.map(v => {
    if (/^[A-Za-z0-9_]+$/.test(v)) return v;
    const esc = v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `"${esc}"`;
  });
  return `{${quoted.join(",")}}`;
}

function parseTagList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const cleaned: string[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    const trimmed = String(value).trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(trimmed);
  }
  return cleaned;
}

// Create empty SOP.
router.post("/", requireAuth, async (req, res) => {
  try {
    const title = String(req.body?.title ?? "").trim();
    const stationsRaw = req.body?.stations;
    const stations: string[] = Array.isArray(stationsRaw) ? stationsRaw.map(s => String(s)).filter(Boolean) : [];
    const tags = parseTagList(req.body?.tags);
    const stationLiteral = arrayLiteral(stations);
    const tagsLiteral = arrayLiteral(tags);
    const result = await db.execute<{ id: number }>(sql`
      INSERT INTO standards_sops (title, stations, tags, author_id)
      VALUES (${title}, ${stationLiteral}::text[], ${tagsLiteral}::text[], ${req.session.userId ?? null})
      RETURNING id
    `);
    const inserted = ((result.rows ?? result) as { id: number }[])[0];
    res.status(201).json({ id: inserted.id });
  } catch (err) {
    console.error("[standards] create failed:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to create SOP" });
  }
});

// Update SOP metadata (title, stations).
router.put("/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const title = typeof req.body?.title === "string" ? req.body.title : null;
  const stationsRaw = req.body?.stations;
  const stations: string[] | null = Array.isArray(stationsRaw) ? stationsRaw.map(s => String(s)).filter(Boolean) : null;
  const tags: string[] | null = Array.isArray(req.body?.tags) ? parseTagList(req.body.tags) : null;
  if (title !== null) {
    await db.execute(sql`UPDATE standards_sops SET title = ${title}, updated_at = NOW() WHERE id = ${id}`);
  }
  if (stations !== null) {
    const stationLiteral = arrayLiteral(stations);
    await db.execute(sql`UPDATE standards_sops SET stations = ${stationLiteral}::text[], updated_at = NOW() WHERE id = ${id}`);
  }
  if (tags !== null) {
    const tagsLiteral = arrayLiteral(tags);
    await db.execute(sql`UPDATE standards_sops SET tags = ${tagsLiteral}::text[], updated_at = NOW() WHERE id = ${id}`);
  }
  // steps_per_page: manual override for the print layout. Absent key = leave
  // unchanged; null = clear (auto-detect); 1-6 = fixed steps per printed page.
  if (Object.prototype.hasOwnProperty.call(req.body ?? {}, "stepsPerPage")) {
    const raw = req.body.stepsPerPage;
    let value: number | null;
    if (raw === null) {
      value = null;
    } else {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > 6) {
        res.status(400).json({ error: "stepsPerPage must be an integer 1-6 or null" });
        return;
      }
      value = n;
    }
    await db.execute(sql`UPDATE standards_sops SET steps_per_page = ${value}, updated_at = NOW() WHERE id = ${id}`);
  }
  res.json({ ok: true });
});

router.delete("/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  // Steps are deleted explicitly, not left to the FK cascade — the FK was
  // missing entirely on tables that pre-dated the bootstrap DDL, and the
  // orphaned steps carried BYTEA image/video blobs. The startup migration
  // retrofits the constraint; this keeps deletes correct regardless.
  await db.execute(sql`DELETE FROM sop_steps WHERE sop_id = ${id}`);
  await db.execute(sql`DELETE FROM standards_sops WHERE id = ${id}`);
  res.json({ ok: true });
});

// Add a step to an SOP. Returns the new step id; position is appended.
router.post("/:id/steps", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const description = String(req.body?.description ?? "");
  const posRows = await db.execute<{ max_pos: number | null }>(sql`
    SELECT MAX(position) AS max_pos FROM sop_steps WHERE sop_id = ${id}
  `);
  const maxPos = ((posRows.rows ?? posRows) as { max_pos: number | null }[])[0]?.max_pos;
  const nextPos = (maxPos ?? -1) + 1;
  const inserted = await db.execute<{ id: number }>(sql`
    INSERT INTO sop_steps (sop_id, position, description)
    VALUES (${id}, ${nextPos}, ${description})
    RETURNING id
  `);
  await db.execute(sql`UPDATE standards_sops SET updated_at = NOW() WHERE id = ${id}`);
  const newStep = ((inserted.rows ?? inserted) as { id: number }[])[0];
  res.status(201).json({ id: newStep.id, position: nextPos, description, hasImage: false, hasVideo: false, videoMime: null });
});

// Update a step's description.
router.put("/steps/:stepId", requireAuth, async (req, res) => {
  const stepId = Number(req.params.stepId);
  if (!Number.isFinite(stepId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const description = typeof req.body?.description === "string" ? req.body.description : null;
  if (description === null) {
    res.status(400).json({ error: "description required" });
    return;
  }
  await db.execute(sql`UPDATE sop_steps SET description = ${description}, updated_at = NOW() WHERE id = ${stepId}`);
  await db.execute(sql`UPDATE standards_sops SET updated_at = NOW() WHERE id = (SELECT sop_id FROM sop_steps WHERE id = ${stepId})`);
  res.json({ ok: true });
});

router.delete("/steps/:stepId", requireAuth, async (req, res) => {
  const stepId = Number(req.params.stepId);
  if (!Number.isFinite(stepId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const sopRows = await db.execute<{ sop_id: number }>(sql`SELECT sop_id FROM sop_steps WHERE id = ${stepId}`);
  const sopId = ((sopRows.rows ?? sopRows) as { sop_id: number }[])[0]?.sop_id;
  await db.execute(sql`DELETE FROM sop_steps WHERE id = ${stepId}`);
  if (sopId) await db.execute(sql`UPDATE standards_sops SET updated_at = NOW() WHERE id = ${sopId}`);
  res.json({ ok: true });
});

// Upload / replace the image on a step.
router.post("/steps/:stepId/image", requireAuth, upload.single("image"), async (req, res) => {
  const stepId = Number(req.params.stepId);
  if (!Number.isFinite(stepId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: "No image uploaded" });
    return;
  }
  const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  if (!allowedTypes.includes(req.file.mimetype)) {
    res.status(400).json({ error: "Invalid file type. Use JPEG, PNG, WebP, or GIF." });
    return;
  }
  await db.execute(sql`
    UPDATE sop_steps
    SET image_mime = ${req.file.mimetype}, image_data = ${req.file.buffer}, updated_at = NOW()
    WHERE id = ${stepId}
  `);
  await db.execute(sql`UPDATE standards_sops SET updated_at = NOW() WHERE id = (SELECT sop_id FROM sop_steps WHERE id = ${stepId})`);
  res.json({ ok: true, hasImage: true });
});

// Remove a step's image (but keep the step itself).
router.delete("/steps/:stepId/image", requireAuth, async (req, res) => {
  const stepId = Number(req.params.stepId);
  if (!Number.isFinite(stepId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await db.execute(sql`
    UPDATE sop_steps
    SET image_mime = NULL, image_data = NULL, updated_at = NOW()
    WHERE id = ${stepId}
  `);
  res.json({ ok: true });
});

// Upload / replace the video on a step. Videos live in their own column
// pair (video_mime + video_data) so a step can carry both a still and a
// clip if useful. Allowed mime types are the formats every recent browser
// can decode natively without us shipping ffmpeg in the container.
router.post("/steps/:stepId/video", requireAuth, videoUpload.single("video"), async (req, res) => {
  const stepId = Number(req.params.stepId);
  if (!Number.isFinite(stepId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: "No video uploaded" });
    return;
  }
  const allowedTypes = ["video/mp4", "video/webm", "video/quicktime", "video/ogg"];
  if (!allowedTypes.includes(req.file.mimetype)) {
    res.status(400).json({ error: "Invalid file type. Use MP4, WebM, MOV, or OGG." });
    return;
  }
  await db.execute(sql`
    UPDATE sop_steps
    SET video_mime = ${req.file.mimetype}, video_data = ${req.file.buffer}, updated_at = NOW()
    WHERE id = ${stepId}
  `);
  await db.execute(sql`UPDATE standards_sops SET updated_at = NOW() WHERE id = (SELECT sop_id FROM sop_steps WHERE id = ${stepId})`);
  res.json({ ok: true, hasVideo: true, videoMime: req.file.mimetype });
});

// Remove a step's video (but keep the step itself).
router.delete("/steps/:stepId/video", requireAuth, async (req, res) => {
  const stepId = Number(req.params.stepId);
  if (!Number.isFinite(stepId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await db.execute(sql`
    UPDATE sop_steps
    SET video_mime = NULL, video_data = NULL, updated_at = NOW()
    WHERE id = ${stepId}
  `);
  res.json({ ok: true });
});

// Stream the video bytes. Uses the stored mime type so <video src="..."> works
// directly. We don't currently honour Range requests — videos are <100MB so
// the browser loading the full clip is acceptable for our scale.
router.get("/steps/:stepId/video", requireAuth, async (req, res) => {
  const stepId = Number(req.params.stepId);
  if (!Number.isFinite(stepId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const rows = await db.execute<{ video_mime: string | null; video_data: Buffer | null }>(sql`
    SELECT video_mime, video_data FROM sop_steps WHERE id = ${stepId}
  `);
  const row = ((rows.rows ?? rows) as { video_mime: string | null; video_data: Buffer | null }[])[0];
  if (!row || !row.video_data || !row.video_mime) {
    res.status(404).json({ error: "No video" });
    return;
  }
  res.setHeader("Content-Type", row.video_mime);
  res.setHeader("Cache-Control", "private, max-age=300");
  res.setHeader("Accept-Ranges", "bytes");
  res.send(row.video_data);
});

// Stream the image bytes for a step. Served as raw bytes with the stored
// MIME type so an <img src="/api/standards/steps/123/image" /> works directly.
router.get("/steps/:stepId/image", requireAuth, async (req, res) => {
  const stepId = Number(req.params.stepId);
  if (!Number.isFinite(stepId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const rows = await db.execute<{ image_mime: string | null; image_data: Buffer | null }>(sql`
    SELECT image_mime, image_data FROM sop_steps WHERE id = ${stepId}
  `);
  const row = ((rows.rows ?? rows) as { image_mime: string | null; image_data: Buffer | null }[])[0];
  if (!row || !row.image_data || !row.image_mime) {
    res.status(404).json({ error: "No image" });
    return;
  }
  res.setHeader("Content-Type", row.image_mime);
  res.setHeader("Cache-Control", "private, max-age=300");
  res.send(row.image_data);
});

// Reorder steps. Body: { stepIds: [id1, id2, ...] } — positions assigned
// in the given order. Rows not in the list are left alone (shouldn't happen
// in practice, but harmless).
router.patch("/:id/reorder", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const stepIds = Array.isArray(req.body?.stepIds) ? req.body.stepIds.map((n: unknown) => Number(n)).filter(Number.isFinite) : null;
  if (!stepIds || stepIds.length === 0) {
    res.status(400).json({ error: "stepIds array required" });
    return;
  }
  for (let i = 0; i < stepIds.length; i++) {
    await db.execute(sql`UPDATE sop_steps SET position = ${i}, updated_at = NOW() WHERE id = ${stepIds[i]} AND sop_id = ${id}`);
  }
  await db.execute(sql`UPDATE standards_sops SET updated_at = NOW() WHERE id = ${id}`);
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Build SOP from video — AI drafting.
//
// Takes the video already uploaded on one step, extracts keyframes with
// ffmpeg (plus an audio transcript when OPENAI_API_KEY is configured),
// asks Claude to break the process into steps, and inserts the drafted
// steps — each with an extracted photo — directly AFTER the source step.
// The original video stays untouched on its step; the team then reviews
// and polishes the draft with the normal step editor.
//
// Synchronous like /api/upf/analyze: the request runs the whole pipeline
// (typically 30-90s) and the client waits with a spinner. One build per
// SOP at a time.
// ─────────────────────────────────────────────────────────────────────────────
const sopBuildsInFlight = new Set<number>();

router.post("/:id/steps/:stepId/build-from-video", requireAuth, async (req, res) => {
  const sopId = Number(req.params.id);
  const stepId = Number(req.params.stepId);
  if (!Number.isFinite(sopId) || !Number.isFinite(stepId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  if (!isClaudeConfigured()) {
    res.status(503).json({ error: "AI drafting requires the Anthropic API key. Ask an admin to set ANTHROPIC_API_KEY." });
    return;
  }
  if (!(await ffmpegAvailable())) {
    res.status(503).json({ error: "ffmpeg is not installed on the server — video analysis unavailable." });
    return;
  }
  if (sopBuildsInFlight.has(sopId)) {
    res.status(409).json({ error: "A build is already running for this SOP — wait for it to finish." });
    return;
  }

  const rows = await db.execute<{ video_mime: string | null; video_data: Buffer | null; position: number }>(sql`
    SELECT video_mime, video_data, position FROM sop_steps WHERE id = ${stepId} AND sop_id = ${sopId}
  `);
  const step = ((rows.rows ?? rows) as { video_mime: string | null; video_data: Buffer | null; position: number }[])[0];
  if (!step) { res.status(404).json({ error: "Step not found" }); return; }
  if (!step.video_mime || !step.video_data || step.video_data.length === 0) {
    res.status(400).json({ error: "This step has no video to build from — upload one first." });
    return;
  }

  sopBuildsInFlight.add(sopId);
  try {
    const result = await buildSopFromVideo(Buffer.from(step.video_data), step.video_mime);

    // Insert drafted steps immediately after the source step: shift every
    // later step down by the number of drafted steps, then fill the gap.
    const n = result.steps.length;
    await db.execute(sql`
      UPDATE sop_steps SET position = position + ${n}, updated_at = NOW()
      WHERE sop_id = ${sopId} AND position > ${step.position}
    `);
    const createdIds: number[] = [];
    for (const [i, s] of result.steps.entries()) {
      const timeRef = `(${Math.floor(s.startSec / 60)}:${String(Math.round(s.startSec % 60)).padStart(2, "0")}–${Math.floor(s.endSec / 60)}:${String(Math.round(s.endSec % 60)).padStart(2, "0")} in the video)`;
      const inserted = await db.execute<{ id: number }>(sql`
        INSERT INTO sop_steps (sop_id, position, description, image_mime, image_data)
        VALUES (${sopId}, ${step.position + 1 + i}, ${`${s.description}\n\n${timeRef}`}, ${"image/jpeg"}, ${s.photoJpeg})
        RETURNING id
      `);
      createdIds.push((((inserted.rows ?? inserted) as { id: number }[])[0]).id);
    }
    await db.execute(sql`UPDATE standards_sops SET updated_at = NOW() WHERE id = ${sopId}`);

    res.json({
      ok: true,
      stepsCreated: n,
      createdStepIds: createdIds,
      suggestedTitle: result.suggestedTitle,
      transcriptUsed: result.transcriptUsed,
    });
  } catch (err) {
    console.error("[standards] build-from-video failed:", err);
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `Video analysis failed: ${msg}` });
  } finally {
    sopBuildsInFlight.delete(sopId);
  }
});

// ─────────────────────────────────────────────────────────────────────────
// SOP links — attach SOPs to the places work happens (2026-08-19).
// Target shapes: checklist_template(a) · ingredient(a) ·
// recipe_ingredient(a=recipe, b=ingredient) · recipe(a) ·
// station(target_text). The per-surface GET endpoints return everything a
// surface needs in ONE call so list rows never fan out into N requests.
// Attach/detach is requireAuth like SOP editing itself — the whole point
// is that anyone who spots a wrong or missing SOP can fix it on the spot.
// ─────────────────────────────────────────────────────────────────────────

const parseIdsParam = (raw: unknown): number[] =>
  String(raw ?? "")
    .split(",")
    .map(s => parseInt(s.trim()))
    .filter(n => Number.isInteger(n) && n > 0);

// GET /links/for-checklist?ids=1,2,3 → { [templateId]: [{linkId,sopId,title}] }
router.get("/links/for-checklist", requireAuth, async (req, res) => {
  const ids = parseIdsParam(req.query.ids);
  if (ids.length === 0) { res.json({}); return; }
  const rows = await db.execute<{ link_id: number; target_a: number; sop_id: number; title: string }>(sql`
    SELECT l.id AS link_id, l.target_a, l.sop_id, s.title
    FROM sop_links l JOIN standards_sops s ON s.id = l.sop_id
    WHERE l.target_type = 'checklist_template' AND l.target_a = ANY(${`{${ids.join(",")}}`}::int[])
    ORDER BY s.title
  `);
  const out: Record<number, Array<{ linkId: number; sopId: number; title: string }>> = {};
  for (const r of rows.rows ?? []) {
    (out[r.target_a] ??= []).push({ linkId: r.link_id, sopId: r.sop_id, title: r.title });
  }
  res.json(out);
});

// GET /links/for-ingredients?ids=1,2 → per-ingredient links, both scopes:
// ingredient-level plus every recipe-scoped link (labelled with the recipe
// name so "burger beef in The Don" and "burger beef in the Special" can
// carry different SOPs side by side).
router.get("/links/for-ingredients", requireAuth, async (req, res) => {
  const ids = parseIdsParam(req.query.ids);
  if (ids.length === 0) { res.json({}); return; }
  const rows = await db.execute<{
    link_id: number; target_type: string; target_a: number; target_b: number | null;
    sop_id: number; title: string; recipe_name: string | null;
  }>(sql`
    SELECT l.id AS link_id, l.target_type, l.target_a, l.target_b, l.sop_id, s.title,
           r.name AS recipe_name
    FROM sop_links l
    JOIN standards_sops s ON s.id = l.sop_id
    LEFT JOIN recipes r ON l.target_type = 'recipe_ingredient' AND r.id = l.target_a
    WHERE (l.target_type = 'ingredient' AND l.target_a = ANY(${`{${ids.join(",")}}`}::int[]))
       OR (l.target_type = 'recipe_ingredient' AND l.target_b = ANY(${`{${ids.join(",")}}`}::int[]))
    ORDER BY s.title
  `);
  const out: Record<number, Array<{
    linkId: number; sopId: number; title: string;
    scope: "ingredient" | "recipe"; recipeId: number | null; recipeName: string | null;
  }>> = {};
  for (const r of rows.rows ?? []) {
    const ingredientId = r.target_type === "ingredient" ? r.target_a : (r.target_b as number);
    (out[ingredientId] ??= []).push({
      linkId: r.link_id,
      sopId: r.sop_id,
      title: r.title,
      scope: r.target_type === "ingredient" ? "ingredient" : "recipe",
      recipeId: r.target_type === "recipe_ingredient" ? r.target_a : null,
      recipeName: r.recipe_name,
    });
  }
  res.json(out);
});

// GET /links/for-recipes?ids=1,2 → { [recipeId]: [{linkId,sopId,title}] }
//
// Recipe-level SOPs: the process for making THIS recipe, wherever that recipe
// shows up. First consumer is the wrapping station (the cream cheese icing
// step on Cinnamon Buns), but nothing here is station-specific — the ovens,
// building and dough screens can hang chips off the same links.
router.get("/links/for-recipes", requireAuth, async (req, res) => {
  const ids = parseIdsParam(req.query.ids);
  if (ids.length === 0) { res.json({}); return; }
  const rows = await db.execute<{ link_id: number; target_a: number; sop_id: number; title: string }>(sql`
    SELECT l.id AS link_id, l.target_a, l.sop_id, s.title
    FROM sop_links l JOIN standards_sops s ON s.id = l.sop_id
    WHERE l.target_type = 'recipe' AND l.target_a = ANY(${`{${ids.join(",")}}`}::int[])
    ORDER BY s.title
  `);
  const out: Record<number, Array<{ linkId: number; sopId: number; title: string }>> = {};
  for (const r of rows.rows ?? []) {
    (out[r.target_a] ??= []).push({ linkId: r.link_id, sopId: r.sop_id, title: r.title });
  }
  res.json(out);
});

const LINK_TYPES = new Set(["checklist_template", "ingredient", "recipe_ingredient", "recipe", "station"]);

// POST /links {sopId, targetType, a?, b?, text?} — attach (idempotent).
router.post("/links", requireAuth, async (req, res) => {
  const sopId = Number(req.body?.sopId);
  const targetType = String(req.body?.targetType ?? "");
  const a = req.body?.a != null ? Number(req.body.a) : null;
  const b = req.body?.b != null ? Number(req.body.b) : null;
  const text = req.body?.text != null ? String(req.body.text) : null;
  if (!Number.isInteger(sopId) || !LINK_TYPES.has(targetType)) {
    res.status(400).json({ error: "sopId and a valid targetType are required" });
    return;
  }
  if (targetType === "station" ? !text : !Number.isInteger(a)) {
    res.status(400).json({ error: "Target reference missing" });
    return;
  }
  if (targetType === "recipe_ingredient" && !Number.isInteger(b)) {
    res.status(400).json({ error: "recipe_ingredient links need a=recipeId and b=ingredientId" });
    return;
  }
  const inserted = await db.execute<{ id: number }>(sql`
    INSERT INTO sop_links (sop_id, target_type, target_a, target_b, target_text, created_by)
    VALUES (${sopId}, ${targetType}, ${a}, ${b}, ${text}, ${req.session.userId ?? null})
    ON CONFLICT (sop_id, target_type, COALESCE(target_a, 0), COALESCE(target_b, 0), COALESCE(target_text, ''))
    DO UPDATE SET sop_id = EXCLUDED.sop_id
    RETURNING id
  `);
  res.status(201).json({ linkId: (inserted.rows ?? [])[0]?.id ?? null });
});

// DELETE /links/:id — detach.
router.delete("/links/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.execute(sql`DELETE FROM sop_links WHERE id = ${id}`);
  res.json({ ok: true });
});

export default router;
