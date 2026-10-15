/**
 * The stock figure one Orders line uses, and what the page says about it
 * (running stock, Graeme 15 Oct 2026 — docs/RUNNING_STOCK.md). Pure; the
 * route passes in the ledger and the London-date formatter.
 *
 *  - Counted today → the count, as before; the expected figure at the
 *    moment of that count rides along quietly ("expected 4.2").
 *  - Not counted today, with a count to start from and tracked usage →
 *    "Expected ~X (last counted 12 Oct, + deliveries − usage)", and the
 *    order is worked out from it.
 *  - Never counted, or nothing uses it → as before ("Not counted — kanban"
 *    / the stale count).
 */
import {
  COVERAGE_LABEL,
  chooseOrderStock,
  countVariances,
  expectedAt,
  round2,
  type IngredientLedger,
  type OrderStockBasis,
  type UsageCoverage,
} from "./stock-ledger";

export interface ExpectedStockPayload {
  /** Expected stock now, never below 0, in the ingredient's own unit. */
  qty: number;
  basedOnCountQty: number;
  basedOnCountAt: string;
  receiptsSince: number;
  usageSince: number;
  coverage: UsageCoverage;
  coverageLabel: string;
}

export interface OrderLineStock {
  basis: OrderStockBasis;
  stockOnHand: number;
  /** Pass "now" as this ingredient's checked-at to outstanding prep. */
  outstandingPrepFromNow: boolean;
  expectedStock: ExpectedStockPayload | null;
  /** What the ledger expected when today's count was made (count basis). */
  expectedAtLastCount: number | null;
}

export function orderLineStock(args: {
  ledger: IngredientLedger | undefined;
  snapshotStock: number;
  stockCheckEnabled: boolean;
  nowMs: number;
  today: string;
  toLondonDate: (ms: number) => string;
  selectedPlanId: number;
}): OrderLineStock {
  const { ledger } = args;
  const exp = ledger ? expectedAt(ledger, args.nowMs) : null;
  const coverage: UsageCoverage = ledger?.coverage ?? "untracked";
  const choice = chooseOrderStock({
    snapshotStock: args.snapshotStock,
    stockCheckEnabled: args.stockCheckEnabled,
    lastCountDate: exp ? args.toLondonDate(exp.basedOn.at) : null,
    today: args.today,
    expected: exp,
    coverage,
    selectedPlanId: args.selectedPlanId,
  });
  const showExpected = exp != null && coverage !== "untracked";
  let expectedAtLastCount: number | null = null;
  if (showExpected && choice.basis === "count" && ledger) {
    const variances = countVariances(ledger);
    const last = variances[variances.length - 1];
    if (last && last.at === exp!.basedOn.at && (last.usage > 0 || last.receipts !== 0)) {
      expectedAtLastCount = round2(Math.max(0, last.expected));
    }
  }
  return {
    basis: choice.basis,
    stockOnHand: choice.stockOnHand,
    outstandingPrepFromNow: choice.outstandingPrepFromNow,
    expectedStock: showExpected
      ? {
          qty: round2(Math.max(0, exp!.expected)),
          basedOnCountQty: round2(exp!.basedOn.qty),
          basedOnCountAt: new Date(exp!.basedOn.at).toISOString(),
          receiptsSince: round2(exp!.receipts),
          usageSince: round2(exp!.usage),
          coverage,
          coverageLabel: COVERAGE_LABEL[coverage],
        }
      : null,
    expectedAtLastCount,
  };
}
