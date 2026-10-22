/**
 * What the app expects a stock count to be, for the "Are you sure?" check on
 * the shared stock-check entry (fix-queue #327, Jane Miles; Graeme approved
 * 22 Oct 2026). Objective C.
 *
 *   GET /api/stock-check-expected?ingredientId=N
 *       → { ingredientId, expectedNative, lastCountNative, coverage }
 *
 * expectedNative = last count + deliveries − usage since (the running-stock
 * ledger, lib/stock-ledger*.ts), in the ingredient's own unit; null when it
 * has never been counted. coverage says how much of its usage the app sees
 * ("untracked" = none, so the figure only ever grows — the entry then
 * doesn't compare against it). The entry never SHOWS this figure before the
 * count is typed — counts stay blind; it only appears in "Are you sure?
 * We expected about 2 kg" when a typed count is far off it.
 * Read-only; its own file because production-plans.ts takes no new code.
 */
import { Router, type IRouter } from "express";
import * as z from "zod";
import { validateQuery } from "../middleware/validate";
import { loadStockLedgers } from "../lib/stock-ledger-data";
import { expectedAt, mergeCounts, round2 } from "../lib/stock-ledger";

const router: IRouter = Router();

const Query = z.object({ ingredientId: z.coerce.number().int().positive() });

router.get("/", validateQuery(Query), async (_req, res) => {
  const { ingredientId } = res.locals["query"] as z.infer<typeof Query>;
  try {
    const now = new Date();
    const ledgers = await loadStockLedgers({ since: new Date(now.getTime() - 120 * 86_400_000), until: now, ingredientIds: [ingredientId] });
    const ledger = ledgers.get(ingredientId)?.ledger;
    const exp = ledger ? expectedAt(ledger, now.getTime()) : null;
    const counts = ledger ? mergeCounts(ledger.counts) : [];
    res.json({
      ingredientId,
      expectedNative: exp ? round2(exp.expected) : null,
      lastCountNative: counts.length ? counts[counts.length - 1]!.qty : null,
      coverage: ledger?.coverage ?? "untracked",
    });
  } catch (err) {
    console.error("[StockCheckExpected] failed:", err);
    res.status(500).json({ error: "Couldn't work out the expected stock" });
  }
});

export default router;
