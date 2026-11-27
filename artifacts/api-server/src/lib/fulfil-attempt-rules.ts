/**
 * The pure rules behind the fulfil-attempts log (lib/fulfil-attempts.ts) and
 * the "Not in Shopify" list (routes/fulfil-attempts.ts). No DB — tested.
 * Objective C.
 */
export type FulfilOutcome = "started" | "fulfilled" | "refused" | "failed";

/** What a finished response means. Pure — tested. */
export function attemptOutcome(status: number, body: unknown): { outcome: Exclude<FulfilOutcome, "started">; error: string | null } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 1000) : null);
  if (status >= 200 && status < 300) {
    // Shipped, but the stock decrement can still have failed — keep that.
    return { outcome: "fulfilled", error: text(b.decrementError) };
  }
  const error = text(b.error) ?? text(b.message) ?? `HTTP ${status}`;
  return { outcome: status >= 500 ? "failed" : "refused", error };
}

/** Shopify's word for an order that still needs fulfilling. Pure — tested. */
export function stillOpenInShopify(o: { fulfillment_status: string | null; cancelled_at: string | null } | null | undefined): boolean {
  if (!o || o.cancelled_at) return false;
  return o.fulfillment_status == null || o.fulfillment_status === "partial" || o.fulfillment_status === "unfulfilled";
}

export interface LedgerRow {
  waybill: string;
  trackingUrl: string | null;
  createdAt: string | Date;
  cancelledAt: string | Date | null;
  supersededAt: string | Date | null;
}

/** The booking to send to Shopify: the newest one that is neither cancelled
 *  nor retired. null when there is none (local delivery / collection, or
 *  every booking is dead — then the server's own gates decide). Pure — tested. */
export function bookingToSend(rows: LedgerRow[]): { waybill: string; trackingUrl: string | null } | null {
  const live = rows
    .filter(r => !r.cancelledAt && !r.supersededAt)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return live[0] ? { waybill: live[0].waybill, trackingUrl: live[0].trackingUrl } : null;
}

// ── "Should already have been fulfilled" — the automatic checks ────────────
// What Graeme and Claude did by hand for #140447 (27 Nov 2026), done by the
// system so the packer can fix the plain server-crash case themselves once
// they've physically found the box. Every check must pass; anything else is
// "escalate to Graeme or a manager".

export interface DiagnosisAttempt {
  outcome: string;
  startedAt: Date | string;
  error: string | null;
  consignmentNumber: string | null;
}
export interface DiagnosisInput {
  attempts: DiagnosisAttempt[];
  /** This device pressed Complete then (and the server never heard). */
  localAt?: number | null;
  serverStarts: Array<Date | string>;
  /** true = still open in Shopify; null = couldn't read Shopify. */
  shopifyOpen: boolean | null;
  booking: { waybill: string; labelPrintedAt: Date | string | null } | null;
  noCourier: boolean;
}
export interface DiagnosisCheck { key: string; ok: boolean; label: string; detail: string }
export interface Diagnosis { checks: DiagnosisCheck[]; canFix: boolean; completeAt: string | null }

const NO_ANSWER = "Connection closed before the server answered";
const RESTART_WINDOW_MS = 10 * 60_000;
const LOCAL_RESTART_WINDOW_MS = 20 * 60_000;
const clockOf = (d: Date) => d.toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });

export function diagnoseStuckFulfil(i: DiagnosisInput): Diagnosis {
  const t = (x: Date | string) => new Date(x).getTime();
  // Complete presses the server never finished answering.
  const cutOff = i.attempts.filter(a => a.outcome === "started" || (a.outcome === "failed" && a.error === NO_ANSWER));
  const presses = [
    ...i.attempts.map(a => t(a.startedAt)),
    ...(i.localAt ? [i.localAt] : []),
  ].sort((a, b) => a - b);
  const firstPress = presses[0] ?? null;
  const starts = i.serverStarts.map(t).sort((a, b) => a - b);

  // 1. Shopify still has it open.
  const shopify: DiagnosisCheck = i.shopifyOpen === true
    ? { key: "shopify", ok: true, label: "Shopify still shows it as not fulfilled", detail: "Nothing was sent to the customer." }
    : { key: "shopify", ok: false, label: "Shopify still shows it as not fulfilled", detail: i.shopifyOpen === null ? "Couldn't read the order from Shopify just now." : "Shopify already shows it fulfilled or cancelled." };

  // 2. A server restart right after Complete was pressed.
  let restartAt: number | null = null;
  let pressAt: number | null = null;
  for (const a of cutOff) {
    const p = t(a.startedAt);
    const s = starts.find(x => x >= p && x <= p + RESTART_WINDOW_MS);
    if (s != null) { restartAt = s; pressAt = p; break; }
  }
  if (restartAt == null && i.localAt) {
    const s = starts.find(x => x >= i.localAt! - 60_000 && x <= i.localAt! + LOCAL_RESTART_WINDOW_MS);
    if (s != null) { restartAt = s; pressAt = i.localAt; }
  }
  const restart: DiagnosisCheck = restartAt != null && pressAt != null
    ? { key: "restart", ok: true, label: "The server restarted just as Complete was pressed", detail: `Complete pressed at ${clockOf(new Date(pressAt))}; the server started again at ${clockOf(new Date(restartAt))}.` }
    : { key: "restart", ok: false, label: "The server restarted just as Complete was pressed", detail: "No restart recorded around then — this isn't the usual server crash." };

  // 3. Nothing else went wrong (a gate refusing, Shopify refusing, or our
  //    server saying it worked are all for a manager to look at).
  const other = i.attempts.find(a => a.outcome === "refused" || a.outcome === "fulfilled" || (a.outcome === "failed" && a.error !== NO_ANSWER));
  const clean: DiagnosisCheck = other
    ? { key: "clean", ok: false, label: "Nothing else went wrong", detail: other.outcome === "fulfilled" ? "The server said it was fulfilled, yet Shopify shows it open." : `${other.outcome === "refused" ? "Refused" : "Failed"}: ${other.error ?? "no reason recorded"}` }
    : { key: "clean", ok: true, label: "Nothing else went wrong", detail: "No refusal or Shopify error recorded." };

  // 4. The same live APC booking, with its label printed before Complete.
  const used = i.attempts.find(a => a.consignmentNumber)?.consignmentNumber ?? null;
  let booking: DiagnosisCheck;
  let label: DiagnosisCheck;
  if (i.noCourier) {
    booking = { key: "booking", ok: true, label: "The right delivery", detail: "Local delivery or collection — no APC label." };
    label = { key: "label", ok: true, label: "Label printed before Complete", detail: "No courier label for this order." };
  } else if (!i.booking) {
    booking = { key: "booking", ok: false, label: "Still on the same live APC booking", detail: "No live APC booking for this order." };
    label = { key: "label", ok: false, label: "Label printed before Complete", detail: "No booking, so no label record." };
  } else {
    booking = used && used !== i.booking.waybill
      ? { key: "booking", ok: false, label: "Still on the same live APC booking", detail: `Complete used ${used.slice(-6)} but the live booking is now ${i.booking.waybill.slice(-6)} — it was booked again.` }
      : { key: "booking", ok: true, label: "Still on the same live APC booking", detail: `Label ending ${i.booking.waybill.slice(-6)} — not cancelled or re-booked.` };
    const printed = i.booking.labelPrintedAt ? new Date(i.booking.labelPrintedAt) : null;
    label = printed && firstPress != null && printed.getTime() <= firstPress + 60_000
      ? { key: "label", ok: true, label: "Label printed before Complete", detail: `Printed at ${clockOf(printed)}.` }
      : { key: "label", ok: false, label: "Label printed before Complete", detail: printed ? `First printed at ${clockOf(printed)}, after Complete.` : "No record of the label being printed." };
  }

  const checks = [shopify, restart, clean, booking, label];
  return { checks, canFix: checks.every(c => c.ok), completeAt: firstPress != null ? new Date(firstPress).toISOString() : null };
}
