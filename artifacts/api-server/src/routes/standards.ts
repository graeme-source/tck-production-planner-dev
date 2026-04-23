/**
 * Standards & SOPs — uploadable images with a title and a set of station
 * tags. Shown in the station header bar; operators filter by the station
 * they're currently on but can switch to "All" to browse everything.
 *
 * Uploads follow the same Google Cloud Storage pattern as /auth/avatar, so
 * Railway deployments with PRIVATE_OBJECT_DIR set just work. Local dev
 * without GCS will return a 500 on upload (same behaviour as avatars).
 */

import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { objectStorageClient } from "../lib/objectStorage";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  next();
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.session.userRole === "admin" || req.session.userRole === "manager") {
    next();
    return;
  }
  res.status(403).json({ error: "Manager access required" });
}

interface StandardRow {
  id: number;
  title: string;
  stations: string[] | null;
  image_url: string;
  created_at: Date;
  created_by_id: number | null;
  creator_name: string | null;
}

// GET /api/standards?station=building_1 — list all; filter by station when
// provided. Stations with an empty tag array match every filter (global SOP).
router.get("/", requireAuth, async (req, res) => {
  const station = typeof req.query.station === "string" ? req.query.station : null;
  const rows = await db.execute<StandardRow>(sql`
    SELECT s.id, s.title, s.stations, s.image_url, s.created_at, s.created_by_id,
           u.name AS creator_name
    FROM standards_sops s
    LEFT JOIN app_users u ON u.id = s.created_by_id
    ${station ? sql`WHERE COALESCE(array_length(s.stations, 1), 0) = 0 OR ${station} = ANY(s.stations)` : sql``}
    ORDER BY s.created_at DESC
  `);
  const list = (rows.rows ?? rows) as StandardRow[];
  res.json(list.map(r => ({
    id: r.id,
    title: r.title,
    stations: r.stations ?? [],
    imageUrl: r.image_url,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    createdById: r.created_by_id,
    creatorName: r.creator_name,
  })));
});

router.post("/", requireAuth, requireAdmin, upload.single("image"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No image uploaded" });
    return;
  }
  const title = String(req.body.title ?? "").trim();
  if (!title) {
    res.status(400).json({ error: "Title is required" });
    return;
  }
  const stationsRaw = req.body.stations;
  let stations: string[] = [];
  if (Array.isArray(stationsRaw)) {
    stations = stationsRaw.map(s => String(s)).filter(Boolean);
  } else if (typeof stationsRaw === "string" && stationsRaw.length > 0) {
    // multipart form-data may arrive as a JSON string or comma-separated
    try {
      const parsed = JSON.parse(stationsRaw);
      if (Array.isArray(parsed)) stations = parsed.map(s => String(s)).filter(Boolean);
    } catch {
      stations = stationsRaw.split(",").map(s => s.trim()).filter(Boolean);
    }
  }

  const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  if (!allowedTypes.includes(req.file.mimetype)) {
    res.status(400).json({ error: "Invalid file type. Use JPEG, PNG, WebP, or GIF." });
    return;
  }

  const privateDir = process.env.PRIVATE_OBJECT_DIR;
  if (!privateDir) {
    res.status(500).json({ error: "Object storage not configured on this server." });
    return;
  }

  try {
    const ext = req.file.mimetype.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
    const entityId = `standards/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const privateDirNorm = privateDir.endsWith("/") ? privateDir : `${privateDir}/`;
    const fullGcsPath = `${privateDirNorm}${entityId}`;
    const pathParts = fullGcsPath.startsWith("/") ? fullGcsPath.slice(1).split("/") : fullGcsPath.split("/");
    const bucketName = pathParts[0];
    const objectName = pathParts.slice(1).join("/");
    const bucket = objectStorageClient.bucket(bucketName);
    const gcsFile = bucket.file(objectName);
    await gcsFile.save(req.file.buffer, {
      metadata: { contentType: req.file.mimetype },
      resumable: false,
    });
    const imageUrl = `/objects/${entityId}`;

    const result = await db.execute<{ id: number }>(sql`
      INSERT INTO standards_sops (title, stations, image_url, created_by_id)
      VALUES (${title}, ${stations as unknown as string}::text[], ${imageUrl}, ${req.session.userId ?? null})
      RETURNING id
    `);
    const inserted = ((result.rows ?? result) as { id: number }[])[0];
    res.status(201).json({
      id: inserted.id,
      title,
      stations,
      imageUrl,
    });
  } catch (err) {
    console.error("Standards upload error:", err);
    res.status(500).json({ error: "Failed to upload standard" });
  }
});

router.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await db.execute(sql`DELETE FROM standards_sops WHERE id = ${id}`);
  res.json({ ok: true });
});

export default router;
