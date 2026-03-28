import { Router, type IRouter } from "express";
import { db, ingredientsTable, kanbanItemsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { generateQrCode, getQrCodeBuffer } from "../lib/qr-code";

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

  let qrCodeUrl: string | null = null;

  if (sourceType === "ingredient") {
    const [row] = await db.select({ qrCodeUrl: ingredientsTable.qrCodeUrl }).from(ingredientsTable).where(eq(ingredientsTable.id, id));
    if (!row) { res.status(404).json({ error: "Ingredient not found" }); return; }
    qrCodeUrl = row.qrCodeUrl;
  } else {
    const [row] = await db.select({ qrCodeUrl: kanbanItemsTable.qrCodeUrl })
      .from(kanbanItemsTable)
      .where(
        and(
          eq(kanbanItemsTable.sourceType, sourceType),
          sourceType === "recipe"
            ? eq(kanbanItemsTable.recipeId, id)
            : eq(kanbanItemsTable.subRecipeId, id)
        )
      );
    if (!row) { res.status(404).json({ error: "QR code not found" }); return; }
    qrCodeUrl = row.qrCodeUrl;
  }

  if (!qrCodeUrl) {
    res.status(404).json({ error: "QR code not generated yet" });
    return;
  }

  const result = await getQrCodeBuffer(qrCodeUrl);
  if (!result) {
    res.status(404).json({ error: "QR code image not found in storage" });
    return;
  }

  res.setHeader("Content-Type", result.contentType);
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.send(result.buffer);
});

export default router;
