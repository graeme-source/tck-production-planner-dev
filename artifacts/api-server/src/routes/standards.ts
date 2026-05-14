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

function requireEditor(req: Request, res: Response, next: NextFunction) {
  if (req.session.userRole === "admin" || req.session.userRole === "manager") {
    next();
    return;
  }
  res.status(403).json({ error: "Manager access required" });
}

interface SopRow {
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
}

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
  };
}

// List SOPs — optional ?station=<key> filter. No image bytes included.
router.get("/", requireAuth, async (req, res) => {
  try {
    const station = typeof req.query.station === "string" ? req.query.station : null;
    const rows = station
      ? await db.execute<SopRow>(sql`
          SELECT s.id, s.title, s.stations, s.tags, s.author_id, s.created_at, s.updated_at,
                 u.name AS author_name,
                 (SELECT COUNT(*)::int FROM sop_steps st WHERE st.sop_id = s.id) AS step_count,
                 (SELECT st.id FROM sop_steps st WHERE st.sop_id = s.id AND st.image_mime IS NOT NULL ORDER BY st.position ASC LIMIT 1) AS first_image_step_id
          FROM standards_sops s
          LEFT JOIN app_users u ON u.id = s.author_id
          WHERE COALESCE(array_length(s.stations, 1), 0) = 0 OR ${station} = ANY(s.stations)
          ORDER BY s.updated_at DESC
        `)
      : await db.execute<SopRow>(sql`
          SELECT s.id, s.title, s.stations, s.tags, s.author_id, s.created_at, s.updated_at,
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

interface StepRow {
  id: number;
  sop_id: number;
  position: number;
  description: string;
  has_image: boolean;
  has_video: boolean;
  video_mime: string | null;
}

// Get one SOP with its steps.
router.get("/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const sopRows = await db.execute<SopRow>(sql`
    SELECT s.id, s.title, s.stations, s.tags, s.author_id, s.created_at, s.updated_at,
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
router.post("/", requireAuth, requireEditor, async (req, res) => {
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
router.put("/:id", requireAuth, requireEditor, async (req, res) => {
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
  res.json({ ok: true });
});

router.delete("/:id", requireAuth, requireEditor, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await db.execute(sql`DELETE FROM standards_sops WHERE id = ${id}`);
  res.json({ ok: true });
});

// Add a step to an SOP. Returns the new step id; position is appended.
router.post("/:id/steps", requireAuth, requireEditor, async (req, res) => {
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
router.put("/steps/:stepId", requireAuth, requireEditor, async (req, res) => {
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

router.delete("/steps/:stepId", requireAuth, requireEditor, async (req, res) => {
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
router.post("/steps/:stepId/image", requireAuth, requireEditor, upload.single("image"), async (req, res) => {
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
router.delete("/steps/:stepId/image", requireAuth, requireEditor, async (req, res) => {
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
router.post("/steps/:stepId/video", requireAuth, requireEditor, videoUpload.single("video"), async (req, res) => {
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
router.delete("/steps/:stepId/video", requireAuth, requireEditor, async (req, res) => {
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
router.patch("/:id/reorder", requireAuth, requireEditor, async (req, res) => {
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

export default router;
