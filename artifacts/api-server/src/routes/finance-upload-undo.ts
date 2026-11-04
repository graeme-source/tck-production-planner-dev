/**
 * Undo a statement upload (Graeme, 4 Nov 2026). Founder only; temporary.
 *   GET  /              recent uploads
 *   GET  /:id/preview   exactly what undoing it would do; changes nothing
 *   POST /:id { confirm: true, alsoOtherMatches? }   does it
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { requireFounder } from "../middleware/founder-access";
import { validate } from "../middleware/validate";
import { previewUploadUndo, recentUploads, undoUpload } from "../lib/finance/upload-undo";

const router: IRouter = Router();
router.use(requireFounder);

const Params = z.object({ id: z.coerce.number().int().positive() });

router.get("/", async (_req: Request, res: Response) => {
  try { res.json({ uploads: await recentUploads() }); }
  catch (err) { console.error("[finance] upload list:", err); res.status(500).json({ error: "Couldn't load the uploads." }); }
});

router.get("/:id/preview", async (req: Request, res: Response) => {
  const p = Params.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Invalid upload" }); return; }
  try {
    const preview = await previewUploadUndo(p.data.id);
    if (!preview) { res.status(404).json({ error: "Upload not found" }); return; }
    res.json(preview);
  } catch (err) { console.error("[finance] upload undo preview:", err); res.status(500).json({ error: "Couldn't work that out — try again." }); }
});

const Confirm = z.object({ confirm: z.literal(true), alsoOtherMatches: z.boolean().optional() });
router.post("/:id", validate(Confirm), async (req: Request, res: Response) => {
  const p = Params.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Invalid upload" }); return; }
  try {
    if (!(await previewUploadUndo(p.data.id))) { res.status(404).json({ error: "Upload not found" }); return; }
    const { alsoOtherMatches } = req.body as z.infer<typeof Confirm>;
    res.json(await undoUpload(p.data.id, req.session.userId ?? null, alsoOtherMatches === true));
  } catch (err) { console.error("[finance] upload undo:", err); res.status(500).json({ error: "Couldn't undo it. Nothing was changed." }); }
});

export default router;
