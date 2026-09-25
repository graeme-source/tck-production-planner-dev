/**
 * The server refuses writes that record work against a person once the
 * session's daily PIN is due (423, code PIN_REQUIRED — api-server
 * lib/pin-enforce.ts). Station screens make those writes with plain fetch
 * from dozens of places, so rather than teach every call site, one hook on
 * window.fetch spots the refusal and raises PIN_REQUIRED_EVENT; the auth
 * context puts the PIN pad up and tells the person to tap again once they've
 * entered it. The caller still sees its failed response, so nothing is
 * silently recorded against the wrong person — or silently dropped.
 */

export const PIN_REQUIRED_EVENT = "tck:pin-required";

/** True for the server's daily-PIN refusal (not the People private-PIN 423). */
export function isPinRequiredResponse(status: number, body: unknown): boolean {
  if (status !== 423) return false;
  if (!body || typeof body !== "object") return false;
  return (body as { code?: unknown }).code === "PIN_REQUIRED";
}

type FetchHost = {
  fetch: typeof fetch;
  dispatchEvent: (event: Event) => boolean;
  __tckPinRequiredHook?: boolean;
};

/** Wraps host.fetch once. Safe to call repeatedly. */
export function installPinRequiredFetchHook(host: FetchHost = window as unknown as FetchHost): void {
  if (host.__tckPinRequiredHook) return;
  host.__tckPinRequiredHook = true;
  const original = host.fetch.bind(host);
  host.fetch = (async (...args: Parameters<typeof fetch>) => {
    const res = await original(...args);
    if (res.status === 423) {
      try {
        const body = await res.clone().json();
        if (isPinRequiredResponse(res.status, body)) host.dispatchEvent(new Event(PIN_REQUIRED_EVENT));
      } catch { /* not JSON — not ours */ }
    }
    return res;
  }) as typeof fetch;
}
