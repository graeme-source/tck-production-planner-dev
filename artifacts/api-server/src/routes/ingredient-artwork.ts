/**
 * Artwork files kept against an ingredient/supply (Graeme, 24 Nov 2026:
 * print-ready PDFs that go with an order — "so I've got the artwork wherever
 * I need to upload it"). Stored byte for byte in Postgres (migration 0393).
 * Managers and admins (mounted behind the guard in routes/index.ts).
 *
 *   GET    /api/ingredient-artwork/item/:ingredientId  → the item's files (no bytes)
 *   POST   /api/ingredient-artwork/item/:ingredientId  multipart `file`, one per request
 *   GET    /api/ingredient-artwork/file/:id[?download=1] → the file as uploaded
 *   DELETE /api/ingredient-artwork/file/:id
 */
import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import * as z from "zod";
import { asc, eq } from "drizzle-orm";
import { db, ingredientArtworkTable, ingredientsTable, usersTable } from "@workspace/db";
import { ARTWORK_MAX_BYTES, artworkDisposition, artworkMime, cleanArtworkName } from "../lib/artwork-rules";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: ARTWORK_MAX_BYTES, files: 1 } });
const Id = z.coerce.number().int().positive();

router.get("/item/:ingredientId", async (req: Request, res: Response) => {
  const id = Id.safeParse(req.params.ingredientId);
  if (!id.success) { res.status(400).json({ error: "Bad item" }); return; }
  const rows = await db
    .select({
      id: ingredientArtworkTable.id, fileName: ingredientArtworkTable.fileName, mime: ingredientArtworkTable.mime,
      sizeBytes: ingredientArtworkTable.sizeBytes, uploadedAt: ingredientArtworkTable.uploadedAt, uploadedByName: usersTable.name,
    })
    .from(ingredientArtworkTable)
    .leftJoin(usersTable, eq(usersTable.id, ingredientArtworkTable.uploadedBy))
    .where(eq(ingredientArtworkTable.ingredientId, id.data))
    .orderBy(asc(ingredientArtworkTable.fileName), asc(ingredientArtworkTable.id));
  res.json({ files: rows });
});

router.post("/item/:ingredientId", (req: Request, res: Response, next) => {
  upload.single("file")(req, res, err => {
    if (err) {
      const tooBig = (err as { code?: string }).code === "LIMIT_FILE_SIZE";
      res.status(tooBig ? 413 : 400).json({ error: tooBig ? `That file is over ${ARTWORK_MAX_BYTES / 1024 / 1024} MB.` : "Couldn't read that upload." });
      return;
    }
    next();
  });
}, async (req: Request, res: Response) => {
  const id = Id.safeParse(req.params.ingredientId);
  if (!id.success) { res.status(400).json({ error: "Bad item" }); return; }
  const file = req.file;
  if (!file || file.size === 0) { res.status(400).json({ error: "No file chosen" }); return; }
  const name = cleanArtworkName(Buffer.from(file.originalname ?? "", "latin1").toString("utf8"));
  const mime = artworkMime(name);
  if (!mime) { res.status(400).json({ error: "That isn't an artwork file. Use PDF (or AI, EPS, SVG, PNG, JPG, TIFF, PSD, INDD, ZIP)." }); return; }
  const [item] = await db.select({ id: ingredientsTable.id }).from(ingredientsTable).where(eq(ingredientsTable.id, id.data));
  if (!item) { res.status(404).json({ error: "Item not found" }); return; }
  const [row] = await db.insert(ingredientArtworkTable).values({
    ingredientId: id.data, fileBlob: file.buffer, fileName: name, mime, sizeBytes: file.size, uploadedBy: req.session.userId ?? null,
  }).returning({ id: ingredientArtworkTable.id, fileName: ingredientArtworkTable.fileName, sizeBytes: ingredientArtworkTable.sizeBytes });
  res.status(201).json(row);
});

router.get("/file/:id", async (req: Request, res: Response) => {
  const id = Id.safeParse(req.params.id);
  if (!id.success) { res.status(400).json({ error: "Bad file" }); return; }
  const [row] = await db
    .select({ blob: ingredientArtworkTable.fileBlob, name: ingredientArtworkTable.fileName, mime: ingredientArtworkTable.mime })
    .from(ingredientArtworkTable).where(eq(ingredientArtworkTable.id, id.data));
  if (!row) { res.status(404).json({ error: "File not found" }); return; }
  res.setHeader("Content-Type", row.mime);
  res.setHeader("Content-Length", String(row.blob.length));
  res.setHeader("Content-Disposition", artworkDisposition(row.name, req.query.download !== "1" && row.mime === "application/pdf"));
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(row.blob);
});

router.delete("/file/:id", async (req: Request, res: Response) => {
  const id = Id.safeParse(req.params.id);
  if (!id.success) { res.status(400).json({ error: "Bad file" }); return; }
  const gone = await db.delete(ingredientArtworkTable).where(eq(ingredientArtworkTable.id, id.data)).returning({ id: ingredientArtworkTable.id });
  if (gone.length === 0) { res.status(404).json({ error: "File not found" }); return; }
  res.json({ ok: true });
});

export default router;
