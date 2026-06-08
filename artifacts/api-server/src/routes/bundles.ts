// Bundle calculator — saved product bundles for working out discount + margin.
//
// Lines are one of:
//   - recipe : a product from the recipe library (cost/RRP from /api/recipes)
//   - manual : a misc item (free gift, or seeded from an ingredient) with its
//              own label, unit cost and unit RRP entered by the user
// The P&P inputs (box packaging + courier) come from the P&L so the margin uses
// a single source of truth.

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
type ItemRow = {
  id: number; bundle_id: number; kind: string; recipe_id: number | null;
  label: string | null; unit_cost: string | null; unit_rrp: string | null; quantity: number; is_free: boolean;
};
type LineInput =
  | { kind: "recipe"; recipeId: number; quantity: number; free: boolean }
  | { kind: "manual"; label: string; unitCost: number; unitRrp: number; quantity: number; free: boolean };

function mapItem(i: ItemRow) {
  if (i.kind === "manual") {
    return { kind: "manual" as const, label: i.label ?? "", unitCost: Number(i.unit_cost ?? 0), unitRrp: Number(i.unit_rrp ?? 0), quantity: i.quantity, free: i.is_free };
  }
  return { kind: "recipe" as const, recipeId: i.recipe_id as number, quantity: i.quantity, free: i.is_free };
}

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
    items: items.map(mapItem),
  };
}

async function loadItems(bundleId: number): Promise<ItemRow[]> {
  return (await db.execute<ItemRow>(
    sql`SELECT id, bundle_id, kind, recipe_id, label, unit_cost, unit_rrp, quantity, is_free FROM bundle_items WHERE bundle_id = ${bundleId} ORDER BY id`,
  )).rows;
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
    const items = (await db.execute<ItemRow>(sql`SELECT id, bundle_id, kind, recipe_id, label, unit_cost, unit_rrp, quantity, is_free FROM bundle_items ORDER BY id`)).rows;
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
  const items: LineInput[] = [];
  for (const raw of itemsIn) {
    const quantity = Number(raw?.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) continue;
    const free = raw?.free === true;
    if (raw?.kind === "manual") {
      const label = String(raw?.label ?? "").trim();
      if (!label) continue;
      items.push({ kind: "manual", label, unitCost: Number(raw?.unitCost) || 0, unitRrp: Number(raw?.unitRrp) || 0, quantity, free });
    } else {
      const recipeId = Number(raw?.recipeId);
      if (!Number.isInteger(recipeId) || recipeId <= 0) continue;
      items.push({ kind: "recipe", recipeId, quantity, free });
    }
  }
  return { name, bundlePrice, boxSize, notes, items };
}

async function insertItems(bundleId: number, items: LineInput[]) {
  for (const it of items) {
    if (it.kind === "manual") {
      await db.execute(sql`
        INSERT INTO bundle_items (bundle_id, kind, label, unit_cost, unit_rrp, quantity, is_free)
        VALUES (${bundleId}, 'manual', ${it.label}, ${it.unitCost}, ${it.unitRrp}, ${it.quantity}, ${it.free})
      `);
    } else {
      await db.execute(sql`
        INSERT INTO bundle_items (bundle_id, kind, recipe_id, quantity, is_free)
        VALUES (${bundleId}, 'recipe', ${it.recipeId}, ${it.quantity}, ${it.free})
      `);
    }
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
    res.status(201).json(mapBundle(bundle, await loadItems(bundleId)));
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
    res.json(mapBundle(bundle, await loadItems(id)));
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
