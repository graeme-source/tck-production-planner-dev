// "What is this item?" categories (Graeme, 18 Nov 2026) — the dropdown on
// every invoice upload, invoice and card transaction. Named exactly as the
// QuickBooks accounts they're posted to.
//
//   GET    /        the active list — Finance, and whoever adds receipts
//                   from Quick actions (?all=1 adds hidden ones, Finance only)
//   POST   /        add one                     (Finance)
//   PATCH  /:id     rename, reorder, hide/show  (Finance)
//   GET    /qbo-accounts  every active QuickBooks account, to search when
//                   adding one (Finance; read only, Graeme 26 Nov 2026)
//
// Objective I.

import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { z } from "zod/v4";
import { asc, eq, isNull } from "drizzle-orm";
import { db, finCategoriesTable } from "@workspace/db";
import { validate } from "../middleware/validate";
import { resolveFinanceAccess } from "./finance";
import { userCan } from "../lib/feature-access";
import { cleanCategoryName } from "../lib/finance/categories";
import { loadQboAccounts } from "../lib/finance/qbo-accounts";

const router: IRouter = Router();

async function requireFinanceAccess(req: Request, res: Response, next: NextFunction) {
  if (await resolveFinanceAccess(req)) { next(); return; }
  res.status(403).json({ error: "Finance access required" });
}

router.get("/", async (req: Request, res: Response) => {
  try {
    const finance = (await resolveFinanceAccess(req)) != null;
    const userId = req.session.userId;
    const receipts = !finance && userId != null
      && await userCan(userId, String(req.session.userRole ?? ""), "finance.add_receipt");
    if (!finance && !receipts) { res.status(403).json({ error: "Finance access required" }); return; }
    const all = finance && req.query.all === "1";
    const rows = await db
      .select({ id: finCategoriesTable.id, name: finCategoriesTable.name, sortOrder: finCategoriesTable.sortOrder, archivedAt: finCategoriesTable.archivedAt, noVatReason: finCategoriesTable.noVatReason })
      .from(finCategoriesTable)
      .where(all ? undefined : isNull(finCategoriesTable.archivedAt))
      .orderBy(asc(finCategoriesTable.sortOrder), asc(finCategoriesTable.name));
    res.json({ categories: rows.map(r => ({ id: r.id, name: r.name, sortOrder: r.sortOrder, hidden: r.archivedAt != null, noVatReason: r.noVatReason })) });
  } catch (err) {
    console.error("[finance] categories list error:", err);
    res.status(500).json({ error: "Couldn't load the categories" });
  }
});

router.get("/qbo-accounts", requireFinanceAccess, async (_req: Request, res: Response) => {
  try {
    res.json(await loadQboAccounts());
  } catch (err) {
    console.error("[finance] QuickBooks accounts error:", err);
    res.json({ connected: false, accounts: [], reason: "Couldn't read QuickBooks" });
  }
});

const AddBody = z.object({ name: z.string().max(200) });

router.post("/", requireFinanceAccess, validate(AddBody), async (req: Request, res: Response) => {
  try {
    const existing = await db.select({ id: finCategoriesTable.id, name: finCategoriesTable.name, sortOrder: finCategoriesTable.sortOrder }).from(finCategoriesTable);
    const clean = cleanCategoryName((req.body as z.infer<typeof AddBody>).name, existing);
    if ("error" in clean) { res.status(400).json({ error: clean.error }); return; }
    const sortOrder = Math.max(0, ...existing.map(c => c.sortOrder)) + 10;
    const [row] = await db.insert(finCategoriesTable).values({ name: clean.name, sortOrder }).returning();
    res.status(201).json({ category: { id: row.id, name: row.name, sortOrder: row.sortOrder, hidden: false } });
  } catch (err) {
    console.error("[finance] category add error:", err);
    res.status(500).json({ error: "Couldn't add the category" });
  }
});

const PatchBody = z.object({
  name: z.string().max(200).optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
  hidden: z.boolean().optional(),
});

router.patch("/:id", requireFinanceAccess, validate(PatchBody), async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid category" }); return; }
    const body = req.body as z.infer<typeof PatchBody>;
    const set: Partial<typeof finCategoriesTable.$inferInsert> = {};
    if (body.name !== undefined) {
      const existing = await db.select({ id: finCategoriesTable.id, name: finCategoriesTable.name }).from(finCategoriesTable);
      const clean = cleanCategoryName(body.name, existing, id);
      if ("error" in clean) { res.status(400).json({ error: clean.error }); return; }
      set.name = clean.name;
    }
    if (body.sortOrder !== undefined) set.sortOrder = body.sortOrder;
    if (body.hidden !== undefined) set.archivedAt = body.hidden ? new Date() : null;
    if (Object.keys(set).length === 0) { res.status(400).json({ error: "Nothing to change" }); return; }
    const [row] = await db.update(finCategoriesTable).set(set).where(eq(finCategoriesTable.id, id)).returning();
    if (!row) { res.status(404).json({ error: "Category not found" }); return; }
    res.json({ category: { id: row.id, name: row.name, sortOrder: row.sortOrder, hidden: row.archivedAt != null } });
  } catch (err) {
    console.error("[finance] category update error:", err);
    res.status(500).json({ error: "Couldn't save the category" });
  }
});

export default router;
