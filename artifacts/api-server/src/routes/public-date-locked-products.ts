/**
 * GET /api/public/date-locked-products — for the website assistant
 * (cs-agent), which must not move the delivery date of an order holding
 * test production or 8-pack bags (Graeme, 11 Nov 2026). Objective C.
 *
 * Mounted above the session guard: no cookie, but NOT open — it demands the
 * shared key in `x-tck-cs-key` (CS_AGENT_SHARED_SECRET, timing-safe; 503
 * when unset). It returns only Shopify variant ids and title patterns.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { loadDateLockedProducts } from "../lib/date-locked-products";

const router: IRouter = Router();

function keyMatches(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

router.get("/", async (req: Request, res: Response) => {
  const secret = process.env.CS_AGENT_SHARED_SECRET;
  if (!secret) { res.status(503).json({ error: "Not configured" }); return; }
  if (!keyMatches(req.get("x-tck-cs-key") ?? undefined, secret)) { res.status(401).json({ error: "Unauthorised" }); return; }
  try {
    const list = await loadDateLockedProducts();
    // Just the lists the assistant checks against — not the planner's product names.
    res.json({ variantIds: list.variantIds, titlePatterns: list.titlePatterns, generatedAt: new Date().toISOString() });
  } catch (err) {
    console.error("[date-locked-products] failed:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Couldn't load the list" });
  }
});

export default router;
