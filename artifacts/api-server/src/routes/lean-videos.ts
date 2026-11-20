/**
 * A lean lesson day's own video (Graeme, 20 Nov 2026: a screen recording
 * he made for "Leave it better than you found it"). One per lesson day,
 * stored in Postgres like the meeting slide videos (migration 0388).
 * Uploading sets the lesson's video_url to /api/lean-videos/<id>?v=<time>,
 * so the meeting, the weekly review and self-paced lessons all play it
 * through the same video_url they already read.
 *
 *   GET    /api/lean-videos/:exampleId   → the video (byte ranges for seeking)
 *   POST   /api/lean-videos/:exampleId   multipart `file` (managers)
 *   DELETE /api/lean-videos/:exampleId   (managers)
 */
import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import { eq, sql } from "drizzle-orm";
import { db, leanExamplesTable, leanExampleVideosTable } from "@workspace/db";
import { requireManagerOrAdmin } from "../middleware/roles";
import { LEAN_VIDEO_MAX_BYTES, LEAN_VIDEO_MIMES, leanVideoUrl, parseByteRange } from "../lib/lean-video-rules";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: LEAN_VIDEO_MAX_BYTES } });

function exampleIdOf(req: Request): number | null {
  const id = Number(req.params.exampleId);
  return Number.isInteger(id) && id > 0 ? id : null;
}

router.get("/:exampleId", async (req: Request, res: Response) => {
  const id = exampleIdOf(req);
  if (!id) { res.status(400).json({ error: "Bad lesson" }); return; }
  const [meta] = await db
    .select({ size: leanExampleVideosTable.sizeBytes, mime: leanExampleVideosTable.mime })
    .from(leanExampleVideosTable).where(eq(leanExampleVideosTable.exampleId, id));
  if (!meta) { res.status(404).json({ error: "No video" }); return; }

  const range = parseByteRange(req.headers.range, meta.size);
  if (range === "unsatisfiable") {
    res.status(416).setHeader("Content-Range", `bytes */${meta.size}`).end();
    return;
  }
  const start = range ? range.start : 0;
  const end = range ? range.end : meta.size - 1;
  // substring is 1-based; with STORAGE EXTERNAL Postgres reads only this slice.
  const [row] = await db
    .select({ part: sql<Buffer>`substring(${leanExampleVideosTable.video} from ${start + 1} for ${end - start + 1})` })
    .from(leanExampleVideosTable).where(eq(leanExampleVideosTable.exampleId, id));
  if (!row) { res.status(404).json({ error: "No video" }); return; }

  res.setHeader("Content-Type", meta.mime);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "private, max-age=86400");
  res.setHeader("Content-Length", String(end - start + 1));
  if (range) {
    res.status(206).setHeader("Content-Range", `bytes ${start}-${end}/${meta.size}`);
  }
  res.end(row.part);
});

router.post("/:exampleId", requireManagerOrAdmin, (req: Request, res: Response, next) => {
  upload.single("file")(req, res, err => {
    if (err) {
      const tooBig = (err as { code?: string }).code === "LIMIT_FILE_SIZE";
      res.status(tooBig ? 413 : 400).json({ error: tooBig ? `That video is over ${LEAN_VIDEO_MAX_BYTES / 1024 / 1024} MB. Export it smaller (QuickTime: File → Export As → 1080p) and try again.` : "Couldn't read that upload." });
      return;
    }
    next();
  });
}, async (req: Request, res: Response) => {
  const id = exampleIdOf(req);
  if (!id) { res.status(400).json({ error: "Bad lesson" }); return; }
  const file = req.file;
  if (!file) { res.status(400).json({ error: "No video chosen" }); return; }
  if (!LEAN_VIDEO_MIMES.includes(file.mimetype)) {
    res.status(400).json({ error: "That isn't a video we can play. Use MP4, MOV or WebM." });
    return;
  }
  const [lesson] = await db.select({ id: leanExamplesTable.id }).from(leanExamplesTable).where(eq(leanExamplesTable.id, id));
  if (!lesson) { res.status(404).json({ error: "Lesson not found" }); return; }

  const uploadedAt = new Date();
  const values = {
    video: file.buffer, mime: file.mimetype, sizeBytes: file.size,
    fileName: file.originalname?.slice(0, 200) ?? null, uploadedBy: req.session.userId ?? null, uploadedAt,
  };
  await db.insert(leanExampleVideosTable).values({ exampleId: id, ...values })
    .onConflictDoUpdate({ target: leanExampleVideosTable.exampleId, set: values });
  const videoUrl = leanVideoUrl(id, uploadedAt);
  await db.update(leanExamplesTable).set({ videoUrl, updatedAt: new Date() }).where(eq(leanExamplesTable.id, id));
  res.status(201).json({ videoUrl, sizeBytes: file.size, fileName: values.fileName });
});

router.delete("/:exampleId", requireManagerOrAdmin, async (req: Request, res: Response) => {
  const id = exampleIdOf(req);
  if (!id) { res.status(400).json({ error: "Bad lesson" }); return; }
  await db.delete(leanExampleVideosTable).where(eq(leanExampleVideosTable.exampleId, id));
  await db.update(leanExamplesTable).set({ videoUrl: null, updatedAt: new Date() })
    .where(sql`${leanExamplesTable.id} = ${id} AND ${leanExamplesTable.videoUrl} LIKE '/api/lean-videos/%'`);
  res.json({ ok: true });
});

export default router;
