import { Router, type IRouter } from "express";
import { generateQrPngBuffer, type QrSourceType } from "../lib/qr-code";

const router: IRouter = Router();

router.get("/:sourceType/:id", async (req, res) => {
  const { sourceType, id: rawId } = req.params;
  const id = Number(rawId);

  if (!["ingredient", "recipe", "sub_recipe"].includes(sourceType)) {
    res.status(400).json({ error: "Invalid sourceType. Must be ingredient, recipe, or sub_recipe." });
    return;
  }

  if (!Number.isFinite(id) || id < 1 || !Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id. Must be a positive integer." });
    return;
  }

  // The QR encodes a deterministic {type,id} payload, so we generate it on the
  // fly every request rather than persisting it. No object storage needed, which
  // means it works on Railway as well as Replit.
  const buffer = await generateQrPngBuffer(sourceType as QrSourceType, id);

  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "public, max-age=86400");
  if (req.query.download !== undefined) {
    res.setHeader("Content-Disposition", `attachment; filename="qr-${sourceType}-${id}.png"`);
  }
  res.send(buffer);
});

export default router;
