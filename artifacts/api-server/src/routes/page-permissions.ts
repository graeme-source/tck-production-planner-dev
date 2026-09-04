import { Router, type IRouter } from "express";
import { db, pagePermissionsTable } from "@workspace/db";
import { requireAdmin } from "../middleware/roles";

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
  { pageKey: "/fulfilment", label: "Order Packing Live" },
  { pageKey: "/locations", label: "Bin Locations" },
  { pageKey: "/dispatch-tag", label: "Dispatch Tagging" },
  { pageKey: "/reports", label: "Reports" },
  { pageKey: "/kanbans", label: "Kanbans" },
  { pageKey: "/product-hub", label: "Product Hub" },
  { pageKey: "/deliveries/receive", label: "Receive Deliveries (front door)" },
  { pageKey: "/training", label: "Training Matrix" },
  { pageKey: "/lean-curriculum", label: "Lean Curriculum planner" },
  { pageKey: "/surveys", label: "Customer Surveys" },
];

const DEFAULT_PERMISSIONS: Record<string, string> = {
  "/sales": "manager",
  "/reports": "viewer",
  "/fulfilment": "manager",
  "/locations": "admin",
  "/dispatch-tag": "manager",
  "/deliveries/receive": "viewer",
  "/training": "manager",
  "/lean-curriculum": "manager",
  "/surveys": "admin",
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
//
// Admin only, and it really is guarded now. The comment here used to say the
// check was "in middleware below" — there wasn't any, and the router is
// mounted bare in routes/index.ts, so any logged-in person could rewrite
// every page's minimum role and let themselves in anywhere (found while
// building feature grants, 2026-09-04). Deciding who gets in is an admin job.
router.put("/", requireAdmin, async (req, res) => {
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
