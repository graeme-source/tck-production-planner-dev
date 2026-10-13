/**
 * Photos and videos in team messages (Graeme, 2026-10-13) — mounted at
 * /api/messages/media by routes/messages.ts (which has already refused
 * anyone not signed in). Objectives F and H.
 *
 *   POST   /            upload one photo or video (multipart "file"); it
 *                       waits, visible only to its uploader, until a
 *                       message claims it (POST /api/messages with
 *                       attachmentIds).
 *   GET    /:id         the bytes, with Range support so iPad Safari can
 *                       play and scrub a video. ?at=packing as for every
 *                       other messages read (a station iPad).
 *   DELETE /:id         take an unsent upload back out of the compose box.
 *
 * Same storage and limits as to-do / improvement attachments: multer in
 * memory, bytea in Postgres, photos 10 MB, videos 100 MB (rules in
 * @workspace/messages media.ts). Who may fetch = who may see the message:
 * canFetchMessageMedia, tested in lib/messages/src/media.test.ts.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { validate, validateQuery } from "../middleware/validate";
import {
  mediaKindOf, mediaProblem, canFetchMessageMedia, MESSAGE_VIDEO_MAX_BYTES, PENDING_MEDIA_TTL_HOURS,
} from "@workspace/messages";
import { loadViewer, parseAtStations, mediaAccessFacts } from "../lib/team-messages";
import { parseByteRange } from "../lib/byte-range";

const router: IRouter = Router();

// One file per request; the largest anything may be is a video.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MESSAGE_VIDEO_MAX_BYTES, files: 1 } });

function uploadOne(req: Request, res: Response, next: () => void) {
  upload.single("file")(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ error: mediaProblem({ mime: "video/mp4", sizeBytes: MESSAGE_VIDEO_MAX_BYTES + 1 }) });
      return;
    }
    if (err) { res.status(400).json({ error: "Couldn't read that upload — try again" }); return; }
    next();
  });
}

// Multipart fields arrive as strings: what the app measured when the file
// was picked (display only — the bytes are checked here).
const uploadFields = z.object({
  durationSeconds: z.coerce.number().min(0).max(24 * 3600).optional(),
  width: z.coerce.number().int().min(1).max(20000).optional(),
  height: z.coerce.number().int().min(1).max(20000).optional(),
});

router.post("/", uploadOne, validate(uploadFields), async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  const file = req.file;
  if (!file) { res.status(400).json({ error: "No file uploaded" }); return; }
  const fields = req.body as z.infer<typeof uploadFields>;
  const problem = mediaProblem({ mime: file.mimetype, sizeBytes: file.size, durationSeconds: fields.durationSeconds ?? null });
  if (problem) { res.status(file.size > 0 && mediaKindOf(file.mimetype) ? 413 : 400).json({ error: problem }); return; }
  const kind = mediaKindOf(file.mimetype)!;
  try {
    // Tidy as we go: uploads nobody sent within a day are dropped.
    await db.execute(sql`
      DELETE FROM team_message_attachments
      WHERE message_id IS NULL AND created_at < NOW() - make_interval(hours => ${PENDING_MEDIA_TTL_HOURS})
    `);
    const r = await db.execute<{ id: number }>(sql`
      INSERT INTO team_message_attachments (uploaded_by, kind, mime, data, file_name, size_bytes, duration_seconds, width, height)
      VALUES (${userId}, ${kind}, ${file.mimetype}, ${file.buffer}, ${file.originalname ?? null}, ${file.size},
              ${kind === "video" ? fields.durationSeconds ?? null : null}, ${fields.width ?? null}, ${fields.height ?? null})
      RETURNING id
    `);
    res.status(201).json({
      id: Number(r.rows[0]!.id), kind, mime: file.mimetype, sizeBytes: file.size,
      durationSeconds: kind === "video" ? fields.durationSeconds ?? null : null,
      width: fields.width ?? null, height: fields.height ?? null,
    });
  } catch (err) {
    console.error("[message-media] upload failed:", err);
    res.status(500).json({ error: "Upload failed — try again" });
  }
});

const getQuery = z.object({ at: z.string().max(400).optional(), download: z.enum(["1"]).optional() });

router.get("/:id", validateQuery(getQuery), async (req: Request, res: Response) => {
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id" }); return; }
  const q = res.locals["query"] as z.infer<typeof getQuery>;
  const v = await loadViewer(req, parseAtStations(q.at));
  if (!v) { res.status(401).json({ error: "Not authenticated" }); return; }
  const found = await mediaAccessFacts(id);
  // Not yours to see and not there look the same — no probing for ids.
  if (!found || !canFetchMessageMedia(found.access, v)) { res.status(404).json({ error: "Not found" }); return; }

  const { file } = found;
  const range = parseByteRange(req.headers.range, file.sizeBytes);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Type", file.mime);
  // Private: the browser may keep it, shared caches never.
  res.setHeader("Cache-Control", "private, max-age=3600");
  if (q.download) {
    const ext = file.mime.split("/")[1]?.replace("quicktime", "mov").replace("jpeg", "jpg") ?? "bin";
    res.setHeader("Content-Disposition", `attachment; filename="tck-message-${file.id}.${ext}"`);
  }
  if (range.kind === "unsatisfiable") {
    res.status(416).setHeader("Content-Range", `bytes */${file.sizeBytes}`).end();
    return;
  }
  const start = range.kind === "partial" ? range.start : 0;
  const end = range.kind === "partial" ? range.end : file.sizeBytes - 1;
  const length = end - start + 1;
  try {
    // Only the slice asked for comes out of Postgres (substring is 1-based).
    const r = await db.execute<{ chunk: Buffer }>(sql`
      SELECT substring(data FROM ${start + 1} FOR ${length}) AS chunk FROM team_message_attachments WHERE id = ${id}
    `);
    const chunk = r.rows[0]?.chunk;
    if (!chunk) { res.status(404).json({ error: "Not found" }); return; }
    if (range.kind === "partial") {
      res.status(206).setHeader("Content-Range", `bytes ${start}-${end}/${file.sizeBytes}`);
    }
    res.setHeader("Content-Length", String(chunk.length));
    res.end(chunk);
  } catch (err) {
    console.error("[message-media] stream failed:", err);
    res.status(500).json({ error: "Couldn't load that photo or video" });
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id" }); return; }
  // Only an unsent upload, only by whoever uploaded it. Once sent, a photo
  // goes with its message (delete the message).
  const r = await db.execute<{ id: number }>(sql`
    DELETE FROM team_message_attachments
    WHERE id = ${id} AND uploaded_by = ${req.session.userId!} AND message_id IS NULL
    RETURNING id
  `);
  if (r.rows.length === 0) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ok: true });
});

export default router;
