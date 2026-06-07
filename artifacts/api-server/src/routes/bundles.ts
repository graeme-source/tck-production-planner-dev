// Bundle calculator — saved product bundles for working out discount + margin.
//
// Products are recipes; their per-pack costs and RRPs come from /api/recipes,
// so the calculator does the bundle maths client-side. This route only persists
// named bundles and exposes the packaging-&-postage inputs (box packaging +
// courier) from the P&L so the margin uses a single source of truth.

import { Router, type IRouter, type Request, type Response } from "express";
import { db, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const router: IRouter = Router();

const DEFAULTS = { smallBoxCost: 2.5, largeBoxCost: 3.5, courierCost: 5.37 };

async function pnlSetting(key: string, fallback: number): Promise<number> {
  const rows = await db.execute<{ value: string }>(
    sql`SELECT value FROM pnl_settings WHERE key = ${key} LIMIT 1`,
  );
  const n = rows.rows[0]?.value != null ? parseFloat(rows.rows[0].value) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

type BundleRow = {
  id: number; name: string; bundle_price: string; box_size: string;
  notes: string | null; created_by_name: string | null; created_at: string; updated_at: string;
};
type ItemRow = { id: number; bundle_id: number; recipe_id: number; quantity: number; };

function mapBundle(b: BundleRow, items: ItemRow[]) {
  return {
    id: b.id,
    name: b.name,
    bundlePrice: Number(b.bundle_price),
    boxSize: b.box_size,
    notes: b.notes,
    createdByName: b.created_by_name,
    createdAt: b.created_at,
    updatedAt: b.updated_at,
    items: items.map(i => ({ recipeId: i.recipe_id, quantity: i.quantity })),
  };
}

// GET /cost-inputs — the P&P numbers the bundle margin deducts (once per bundle).
router.get("/cost-inputs", async (_req: Request, res: Response) => {
  try {
    const [smallBoxCost, largeBoxCost, courierCost] = await Promise.all([
      pnlSetting("small_box_cost", DEFAULTS.smallBoxCost),
      pnlSetting("large_box_cost", DEFAULTS.largeBoxCost),
      pnlSetting("courier_cost", DEFAULTS.courierCost),
    ]);
    res.json({ smallBoxCost, largeBoxCost, courierCost });
  } catch (err) {
    console.error("[bundles] cost-inputs failed:", err);
    res.status(500).json({ error: "Failed to load cost inputs" });
  }
});

// GET / — all saved bundles, newest-edited first.
router.get("/", async (_req: Request, res: Response) => {
  try {
    const bundles = (await db.execute<BundleRow>(sql`SELECT * FROM bundles ORDER BY updated_at DESC`)).rows;
    const items = (await db.execute<ItemRow>(sql`SELECT id, bundle_id, recipe_id, quantity FROM bundle_items`)).rows;
    const byBundle = new Map<number, ItemRow[]>();
    for (const it of items) {
      if (!byBundle.has(it.bundle_id)) byBundle.set(it.bundle_id, []);
      byBundle.get(it.bundle_id)!.push(it);
    }
    res.json(bundles.map(b => mapBundle(b, byBundle.get(b.id) ?? [])));
  } catch (err) {
    console.error("[bundles] list failed:", err);
    res.status(500).json({ error: "Failed to load bundles" });
  }
});

function parseBody(req: Request) {
  const name = String(req.body?.name ?? "").trim();
  const bundlePrice = Number(req.body?.bundlePrice);
  const boxSize = req.body?.boxSize === "small" ? "small" : "large";
  const notes = req.body?.notes ? String(req.body.notes) : null;
  const itemsIn = Array.isArray(req.body?.items) ? req.body.items : [];
  const items = itemsIn
    .map((i: { recipeId: unknown; quantity: unknown }) => ({ recipeId: Number(i.recipeId), quantity: Number(i.quantity) }))
    .filter((i: { recipeId: number; quantity: number }) => Number.isInteger(i.recipeId) && i.recipeId > 0 && Number.isInteger(i.quantity) && i.quantity > 0);
  return { name, bundlePrice, boxSize, notes, items };
}

async function insertItems(bundleId: number, items: Array<{ recipeId: number; quantity: number }>) {
  for (const it of items) {
    await db.execute(sql`INSERT INTO bundle_items (bundle_id, recipe_id, quantity) VALUES (${bundleId}, ${it.recipeId}, ${it.quantity})`);
  }
}

// POST / — create a bundle.
router.post("/", async (req: Request, res: Response) => {
  try {
    const { name, bundlePrice, boxSize, notes, items } = parseBody(req);
    if (!name) { res.status(400).json({ error: "name is required" }); return; }
    if (!Number.isFinite(bundlePrice) || bundlePrice < 0) { res.status(400).json({ error: "bundlePrice must be a non-negative number" }); return; }
    if (items.length === 0) { res.status(400).json({ error: "At least one product is required" }); return; }

    const userId = req.session.userId ?? null;
    let createdByName: string | null = null;
    if (userId) {
      const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
      createdByName = u?.name ?? null;
    }

    const ins = await db.execute<{ id: number }>(sql`
      INSERT INTO bundles (name, bundle_price, box_size, notes, created_by, created_by_name)
      VALUES (${name}, ${bundlePrice}, ${boxSize}, ${notes}, ${userId}, ${createdByName})
      RETURNING id
    `);
    const bundleId = ins.rows[0].id;
    await insertItems(bundleId, items);

    const [bundle] = (await db.execute<BundleRow>(sql`SELECT * FROM bundles WHERE id = ${bundleId}`)).rows;
    res.status(201).json(mapBundle(bundle, items.map((i: { recipeId: number; quantity: number }, idx: number) => ({ id: idx, bundle_id: bundleId, recipe_id: i.recipeId, quantity: i.quantity }))));
  } catch (err) {
    console.error("[bundles] create failed:", err);
    res.status(500).json({ error: "Failed to create bundle" });
  }
});

// PUT /:id — update a bundle (replaces its items).
router.put("/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const { name, bundlePrice, boxSize, notes, items } = parseBody(req);
    if (!name) { res.status(400).json({ error: "name is required" }); return; }
    if (!Number.isFinite(bundlePrice) || bundlePrice < 0) { res.status(400).json({ error: "bundlePrice must be a non-negative number" }); return; }
    if (items.length === 0) { res.status(400).json({ error: "At least one product is required" }); return; }

    const upd = await db.execute<{ id: number }>(sql`
      UPDATE bundles SET name = ${name}, bundle_price = ${bundlePrice}, box_size = ${boxSize}, notes = ${notes}, updated_at = NOW()
      WHERE id = ${id} RETURNING id
    `);
    if (upd.rows.length === 0) { res.status(404).json({ error: "Bundle not found" }); return; }

    await db.execute(sql`DELETE FROM bundle_items WHERE bundle_id = ${id}`);
    await insertItems(id, items);

    const [bundle] = (await db.execute<BundleRow>(sql`SELECT * FROM bundles WHERE id = ${id}`)).rows;
    res.json(mapBundle(bundle, items.map((i: { recipeId: number; quantity: number }, idx: number) => ({ id: idx, bundle_id: id, recipe_id: i.recipeId, quantity: i.quantity }))));
  } catch (err) {
    console.error("[bundles] update failed:", err);
    res.status(500).json({ error: "Failed to update bundle" });
  }
});

// DELETE /:id — remove a bundle (items cascade).
router.delete("/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const del = await db.execute<{ id: number }>(sql`DELETE FROM bundles WHERE id = ${id} RETURNING id`);
    if (del.rows.length === 0) { res.status(404).json({ error: "Bundle not found" }); return; }
    res.status(204).send();
  } catch (err) {
    console.error("[bundles] delete failed:", err);
    res.status(500).json({ error: "Failed to delete bundle" });
  }
});

export default router;
