/**
 * Sending the app's barcodes to Shopify (Graeme, 2026-10-12). Objectives A
 * and F. THE ONLY CODE THAT WRITES A BARCODE TO SHOPIFY.
 *
 * pushBarcodes() reads each variant live, asks the pure rule (decidePush,
 * @workspace/barcodes push.ts) what to do, and writes only the "send" ones —
 * with productVariantsBulkUpdate, one call per Shopify product, through
 * shopifyGraphQLWrite (which refuses on staging / BLOCK_SHOPIFY_WRITES).
 * Every outcome is recorded on the variant's row (the card's "Sent to
 * Shopify ✓" / "Not sent — …") and logged in barcode_events.
 *
 * Writes need the write_products permission on the app's Shopify
 * connection. Without it (or with writes switched off on this server) a
 * push is "waiting to send": the app's barcode is saved as normal and goes
 * out later (Retry, or the hourly check once writes are allowed).
 *
 * The Shopify side and the database side are ports, so the whole sequence
 * is tested with a fake store and no network (barcode-push.test.ts).
 */
import { decidePush, stateFor, type PushDecision, type PushState } from "@workspace/barcodes";

export interface LiveVariant {
  productId: string;
  barcode: string | null;
  /** 'active' | 'draft' | 'archived' (lower-case). */
  status: string;
  productTitle: string | null;
  variantTitle: string | null;
}

export interface ShopifyBarcodePort {
  /** Live barcode + product of each variant; a missing id = gone from Shopify. */
  read(variantIds: string[]): Promise<Map<string, LiveVariant>>;
  /** Why writes can't go now (switched off, missing permission) — null = they can. */
  blockedReason(): Promise<string | null>;
  /** Set these variants' barcodes on one product. Throws on failure. */
  write(productId: string, variants: Array<{ variantId: string; barcode: string }>): Promise<void>;
}

export interface PushTarget {
  variantId: string;
  /** The barcode to send (the one this variant scans with in the app). */
  ours: string | null;
  /** Shopify numbers we may replace (ours before the change, last sent…). */
  replaceable: Array<string | null | undefined>;
  clubSpecial: boolean;
  force?: boolean;
  /** For the log. */
  recipeId?: number | null;
  name?: string | null;
}

export interface PushRecord {
  variantId: string;
  state: PushState | null;
  barcode: string | null;
  from: string | null;
  message: string | null;
  /** Fresh from the read (and = ours after a successful send). */
  live: LiveVariant | null;
}

export interface PushLog {
  variantId: string;
  recipeId: number | null;
  name: string | null;
  from: string | null;
  to: string | null;
  result: "ok" | "failed" | "waiting" | "skipped" | "conflict";
  message: string;
}

export interface PushSink {
  record(r: PushRecord): Promise<void>;
  log(e: PushLog): Promise<void>;
}

export interface PushResult {
  variantId: string;
  outcome: PushDecision["outcome"] | "failed";
  message: string;
}

const LOGGED: Record<string, PushLog["result"] | null> = {
  send: "ok", waiting: "waiting", conflict: "conflict", "skip-archived": "skipped", "skip-club-special": "skipped", "not-in-shopify": "skipped",
  already: null, nothing: null,
};

/** Push these variants' barcodes to Shopify. Never throws for a Shopify
 *  problem: every failure is recorded on the row and logged. */
export async function pushBarcodes(targets: PushTarget[], port: ShopifyBarcodePort, sink: PushSink): Promise<PushResult[]> {
  if (!targets.length) return [];
  const results: PushResult[] = [];
  let live: Map<string, LiveVariant>;
  try {
    live = await port.read(targets.map(t => t.variantId));
  } catch (err) {
    const message = `Couldn't read Shopify: ${err instanceof Error ? err.message : String(err)}`;
    for (const t of targets) {
      if (!t.ours) continue;
      await sink.record({ variantId: t.variantId, state: "failed", barcode: t.ours, from: null, message, live: null });
      await sink.log({ variantId: t.variantId, recipeId: t.recipeId ?? null, name: t.name ?? null, from: null, to: t.ours, result: "failed", message });
      results.push({ variantId: t.variantId, outcome: "failed", message });
    }
    return results;
  }
  const blocked = await port.blockedReason().catch(() => null);

  const sends = new Map<string, Array<{ t: PushTarget; l: LiveVariant }>>();
  for (const t of targets) {
    const l = live.get(t.variantId) ?? null;
    const d = decidePush({
      ours: t.ours, shopify: l ? { barcode: l.barcode, status: l.status } : null, clubSpecial: t.clubSpecial,
      replaceable: t.replaceable, force: t.force, blocked,
    });
    if (d.outcome === "send" && l) {
      sends.set(l.productId, [...(sends.get(l.productId) ?? []), { t, l }]);
      continue;
    }
    if (d.outcome !== "nothing") {
      await sink.record({ variantId: t.variantId, state: stateFor(d.outcome), barcode: t.ours, from: l?.barcode ?? null, message: d.outcome === "already" ? null : d.reason, live: l });
    }
    const logged = LOGGED[d.outcome];
    if (logged) await sink.log({ variantId: t.variantId, recipeId: t.recipeId ?? null, name: t.name ?? null, from: l?.barcode ?? null, to: t.ours, result: logged, message: d.reason });
    results.push({ variantId: t.variantId, outcome: d.outcome, message: d.reason });
  }

  for (const [productId, items] of sends) {
    try {
      await port.write(productId, items.map(({ t }) => ({ variantId: t.variantId, barcode: t.ours! })));
      for (const { t, l } of items) {
        await sink.record({ variantId: t.variantId, state: "sent", barcode: t.ours, from: l.barcode, message: null, live: { ...l, barcode: t.ours } });
        await sink.log({ variantId: t.variantId, recipeId: t.recipeId ?? null, name: t.name ?? null, from: l.barcode, to: t.ours, result: "ok", message: l.barcode ? `replaced ${l.barcode} in Shopify` : "Shopify had none" });
        results.push({ variantId: t.variantId, outcome: "send", message: "Sent to Shopify" });
      }
    } catch (err) {
      // Writes switched off between the check and the write still count as waiting.
      const isBlocked = err instanceof Error && (err as { code?: string }).code === "SHOPIFY_WRITES_BLOCKED";
      const message = isBlocked ? (err as Error).message : `Shopify refused it: ${err instanceof Error ? err.message : String(err)}`;
      for (const { t, l } of items) {
        await sink.record({ variantId: t.variantId, state: isBlocked ? "waiting" : "failed", barcode: t.ours, from: l.barcode, message, live: l });
        await sink.log({ variantId: t.variantId, recipeId: t.recipeId ?? null, name: t.name ?? null, from: l.barcode, to: t.ours, result: isBlocked ? "waiting" : "failed", message });
        results.push({ variantId: t.variantId, outcome: isBlocked ? "waiting" : "failed", message });
      }
    }
  }
  return results;
}
