import { Router, type IRouter } from "express";
import { db, pagePermissionsTable } from "@workspace/db";

const router: IRouter = Router();

const KNOWN_PAGES = [
  { pageKey: "/", label: "Dashboard" },
  { pageKey: "/plans", label: "Production Plans" },
  { pageKey: "/recipes", label: "Recipes" },
  { pageKey: "/sub-recipes", label: "Sub-Recipes" },
  { pageKey: "/ingredients", label: "Ingredients" },
  { pageKey: "/suppliers", label: "Suppliers" },
  { pageKey: "/stock", label: "Stock Inventory" },
  { pageKey: "/sales", label: "Sales Data" },
  { pageKey: "/dispatches", label: "Dispatches" },
  { pageKey: "/fulfilment", label: "Fulfilment" },
  { pageKey: "/locations", label: "Bin Locations" },
  { pageKey: "/reports", label: "Reports" },
];

const DEFAULT_PERMISSIONS: Record<string, string> = {
  "/sales": "manager",
  "/reports": "manager",
  "/fulfilment": "viewer",
  "/locations": "admin",
};

// GET /api/page-permissions
// Returns all known pages with their current minRole
router.get("/", async (_req, res) => {
  const rows = await db.select().from(pagePermissionsTable);
  const map = new Map(rows.map(r => [r.pageKey, r.minRole]));

  const result = KNOWN_PAGES.map(p => ({
    pageKey: p.pageKey,
    label: p.label,
    minRole: map.get(p.pageKey) ?? DEFAULT_PERMISSIONS[p.pageKey] ?? "viewer",
  }));

  res.json(result);
});

// PUT /api/page-permissions
// Body: [{ pageKey, minRole }]
// Only admins may call this (checked in middleware below)
router.put("/", async (req, res) => {
  const updates: { pageKey: string; minRole: string }[] = req.body;
  if (!Array.isArray(updates)) {
    res.status(400).json({ error: "Expected an array" });
    return;
  }

  const validRoles = ["viewer", "manager", "admin"];
  const validKeys = new Set(KNOWN_PAGES.map(p => p.pageKey));

  for (const u of updates) {
    if (!validKeys.has(u.pageKey) || !validRoles.includes(u.minRole)) {
      res.status(400).json({ error: `Invalid entry: ${JSON.stringify(u)}` });
      return;
    }
  }

  for (const u of updates) {
    await db
      .insert(pagePermissionsTable)
      .values({ pageKey: u.pageKey, minRole: u.minRole as any })
      .onConflictDoUpdate({
        target: pagePermissionsTable.pageKey,
        set: { minRole: u.minRole as any },
      });
  }

  res.json({ ok: true });
});

export default router;
