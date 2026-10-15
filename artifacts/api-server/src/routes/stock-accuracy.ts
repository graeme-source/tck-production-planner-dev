/**
 * Stock accuracy — managers only (Graeme, 15 Oct 2026; Objective B).
 *
 *   GET /api/stock-accuracy?days=42
 *
 * For every stock-checked or kanban ingredient: the running ("expected")
 * stock now — last real count + deliveries since − usage since, with the
 * usage broken down by where the app saw it — and how each recent count
 * compared with what was expected at that moment. Flags gaps that are big
 * or keep happening (waste, miscounts, usage the app doesn't see).
 *
 * Read-only and computed on read (lib/stock-ledger*.ts); nothing new is
 * stored. The expected figure is deliberately NOT available to stations or
 * stock-check screens (blind counts) — this route is manager/admin only.
 */
import { Router, type IRouter } from "express";
import * as z from "zod";
import { requireManagerOrAdmin } from "../middleware/roles";
import { validateQuery } from "../middleware/validate";
import { loadStockLedgers } from "../lib/stock-ledger-data";
import {
  COVERAGE_LABEL,
  USAGE_SOURCE_LABEL,
  countVariances,
  expectedAt,
  medianAbsGap,
  round2,
  varianceFlags,
  type UsageSource,
} from "../lib/stock-ledger";

const router: IRouter = Router();

const Query = z.object({
  days: z.coerce.number().int().min(7).max(120).optional(),
});

/** How far back counts are read as starting points for "expected now". */
const LOOKBACK_DAYS = 120;

router.get("/", requireManagerOrAdmin, validateQuery(Query), async (_req, res) => {
  const { days = 42 } = res.locals["query"] as z.infer<typeof Query>;
  const now = new Date();
  const ledgers = await loadStockLedgers({ since: new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000), until: now });
  const windowStart = now.getTime() - days * 86_400_000;

  const ingredients = [];
  for (const { ingredient, ledger } of ledgers.values()) {
    const exp = expectedAt(ledger, now.getTime());
    const variances = countVariances(ledger).filter(v => v.at >= windowStart);
    const usageInWindow = ledger.usage.filter(u => u.at >= windowStart).reduce((s, u) => s + u.qty, 0);
    // Nothing to say about an ingredient nobody counts or uses.
    if (!exp && usageInWindow <= 0) continue;
    const meaningful = variances.filter(v => v.usage > 0 || v.receipts !== 0);
    ingredients.push({
      id: ingredient.id,
      name: ingredient.name,
      unit: ingredient.unit,
      category: ingredient.category,
      stockCheckEnabled: ingredient.stockCheckEnabled,
      stockCheckFrequency: ingredient.stockCheckFrequency,
      kanbanEnabled: ingredient.kanbanEnabled,
      coverage: ledger.coverage,
      coverageLabel: COVERAGE_LABEL[ledger.coverage],
      expectedNow: exp
        ? {
            expected: round2(exp.expected),
            basedOnCount: { qty: round2(exp.basedOn.qty), at: new Date(exp.basedOn.at).toISOString() },
            receiptsSince: round2(exp.receipts),
            usageSince: round2(exp.usage),
            usageBySource: (Object.entries(exp.usageBySource) as Array<[UsageSource, number]>)
              .filter(([, q]) => q > 0)
              .map(([source, qty]) => ({ source, label: USAGE_SOURCE_LABEL[source], qty: round2(qty) })),
          }
        : null,
      usageInWindow: round2(usageInWindow),
      variances: meaningful.slice(-12).map(v => ({
        at: new Date(v.at).toISOString(),
        counted: round2(v.counted),
        expected: round2(v.expected),
        diff: round2(v.diff),
        pct: v.pct == null ? null : Math.round(v.pct * 1000) / 1000,
        gap: v.gap == null ? null : Math.round(v.gap * 1000) / 1000,
        receipts: round2(v.receipts),
        usage: round2(v.usage),
      })),
      typicalGap: (() => { const g = medianAbsGap(meaningful); return g == null ? null : Math.round(g * 1000) / 1000; })(),
      flags: varianceFlags(meaningful, exp ? exp.expected : null),
    });
  }
  ingredients.sort((a, b) => b.flags.length - a.flags.length || a.name.localeCompare(b.name));
  res.json({ generatedAt: now.toISOString(), days, ingredients });
});

export default router;
