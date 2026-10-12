/**
 * Pure rules for the fried chicken once-only stock send — the stored record's
 * shape, how an old or damaged record reads, and the refusal wording. The DB
 * side (claim / finish / release) is in fried-chicken-stock-send.ts.
 */
export interface StockSendRecord {
  /** ISO timestamp (UTC, with Z) of the send — or of the claim while sending. */
  at: string;
  by: number | null;
  /** Bags that actually landed in Shopify. 0 while still sending. */
  bags: number;
  /** "sending" between the claim and the end of the Shopify calls. Records
   *  written before 12 Oct have no status and are finished sends. */
  status?: "sending" | "sent";
}

export function stockSendKey(planId: number): string {
  return `fried_chicken_stock_submitted_${planId}`;
}

/** Read a stored record. Anything unreadable is treated as "a send happened"
 *  rather than "no send" — refusing a send we can't account for is the safe
 *  way round when the alternative is doubling the shelf. */
export function parseStockSendRecord(value: string | null | undefined): StockSendRecord | null {
  if (value == null || value === "") return null;
  try {
    const parsed = JSON.parse(value) as Partial<StockSendRecord> | null;
    if (parsed && typeof parsed.at === "string") {
      return {
        at: parsed.at,
        by: typeof parsed.by === "number" ? parsed.by : null,
        bags: Number(parsed.bags) || 0,
        status: parsed.status === "sending" ? "sending" : "sent",
      };
    }
  } catch { /* fall through */ }
  return { at: "", by: null, bags: 0, status: "sent" };
}

/** The 409 wording for a refused send. */
export function alreadySentMessage(record: StockSendRecord): string {
  return record.status === "sending"
    ? "A send for this plan is already in progress (or stopped part-way). Check Shopify's inventory history — it can't be sent again from here."
    : "This plan's counted bags have already been sent to Shopify. It only goes once — a correction has to be made in Shopify.";
}
