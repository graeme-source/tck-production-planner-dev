import { Router, type IRouter } from "express";
import { db, ingredientsTable } from "@workspace/db";

// Who sells each ingredient and at what pack price — primary AND secondary
// supplier (Graeme, 2026-10-01). Read-only, no body or query parameters.
// The Orders page uses it to price a line at the supplier whose card it sits
// on and to suggest items to move onto a supplier's order when that order is
// under the supplier's minimum order value (Objective C).
const router: IRouter = Router();

router.get("/", async (_req, res) => {
  const rows = await db
    .select({
      id: ingredientsTable.id,
      supplierId: ingredientsTable.supplierId,
      secondarySupplierId: ingredientsTable.secondarySupplierId,
      costPerPack: ingredientsTable.costPerPack,
      secondaryCostPerPack: ingredientsTable.secondaryCostPerPack,
    })
    .from(ingredientsTable);
  res.json(rows.map(r => ({
    ingredientId: r.id,
    supplierId: r.supplierId ?? null,
    secondarySupplierId: r.secondarySupplierId ?? null,
    costPerPack: Number(r.costPerPack) || 0,
    secondaryCostPerPack: r.secondaryCostPerPack != null ? Number(r.secondaryCostPerPack) : null,
  })));
});

export default router;
