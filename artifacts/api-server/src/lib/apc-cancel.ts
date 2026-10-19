/**
 * APC cancel request + reply — pure (Graeme, 19 Oct 2026). From APC's API
 * guide v3.1.2 section 7 "Cancelling Orders":
 *   PUT {base}/Orders/{waybill}.json?searchtype=CarrierWaybill
 *   body {"CancelOrder":{"Order":{"Status":"CANCELLED"}}}
 *   reply CancelOrder.Messages { Code 121, Description "Order Cancelled" }
 */
export function buildCancelRequest(base: string, waybill: string): { url: string; method: "PUT"; body: string } {
  return {
    url: `${base.replace(/\/$/, "")}/Orders/${encodeURIComponent(waybill.trim())}.json?searchtype=CarrierWaybill`,
    method: "PUT",
    body: JSON.stringify({ CancelOrder: { Order: { Status: "CANCELLED" } } }),
  };
}

export function interpretCancelReply(status: number, text: string): { ok: true } | { ok: false; error: string } {
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  const msgs = json?.CancelOrder?.Messages ?? json?.Orders?.Messages ?? json?.Messages;
  const code = msgs?.Code != null ? String(msgs.Code) : undefined;
  const desc: string | undefined = msgs?.Description;
  const looksCancelled = code === "121" || code === "SUCCESS" || /cancel+ed/i.test(desc ?? "");
  if (status >= 200 && status < 300 && (looksCancelled || json == null)) return { ok: true };
  if (status >= 200 && status < 300 && !msgs) return { ok: true };
  return { ok: false, error: `APC cancel failed (${status})${desc ? `: ${desc}` : text && !json ? `: ${text.slice(0, 200)}` : ""}` };
}
