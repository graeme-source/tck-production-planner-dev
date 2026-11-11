/**
 * Asks the website assistant (cs-agent) for a "choose a delivery day" link
 * for one order (Graeme, 11 Nov 2026). The assistant signs and checks the
 * link; the planner only asks for it. POST {CS_AGENT_URL}/api/reschedule-links
 * with the shared key CS_AGENT_SHARED_SECRET. Never throws: no link (not set
 * up, or the assistant didn't answer) comes back as { url: null, error }.
 */
export interface RescheduleLinkRequest {
  orderId: number;
  orderName: string;
  /** The link stops working after this (ISO). */
  expiresAt: string;
}

export async function rescheduleLinkFor(req: RescheduleLinkRequest): Promise<{ url: string | null; error: string | null }> {
  const base = (process.env.CS_AGENT_URL ?? "").replace(/\/$/, "");
  const key = process.env.CS_AGENT_SHARED_SECRET;
  if (!base || !key) return { url: null, error: "The assistant link isn't set up (CS_AGENT_URL / CS_AGENT_SHARED_SECRET)." };
  try {
    const res = await fetch(`${base}/api/reschedule-links`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-tck-planner-key": key },
      body: JSON.stringify({
        orderId: req.orderId,
        orderName: req.orderName,
        reason: "friday-check",
        // No Saturdays: APC just refused this postcode on one.
        excludeWeekdays: [6],
        sameDayCutoff: "13:45",
        expiresAt: req.expiresAt,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.json().catch(() => ({})) as { url?: string; error?: string };
    if (!res.ok || !body.url) return { url: null, error: body.error ?? `The assistant answered ${res.status}.` };
    return { url: body.url, error: null };
  } catch (err) {
    return { url: null, error: `The assistant didn't answer: ${err instanceof Error ? err.message : String(err)}` };
  }
}
