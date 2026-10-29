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

/** Header a BACKGROUND request carries (prep timing — hooks/use-prep-session-
 *  capture.ts) so a PIN refusal stays quiet: the person didn't tap anything
 *  that needs a PIN, so the PIN pad must not pop up because of it. The
 *  refusal itself still stands — nothing is recorded under a stale session. */
export const QUIET_REQUEST_HEADER = "X-TCK-Background";

/** The server refused one of your OWN hub records because no PIN was typed
 *  recently (423 HUB_PIN_REQUIRED, or PEOPLE_PIN_REQUIRED for someone with
 *  People access — api-server lib/hub-unlock.ts). The Employee Hub listens
 *  and shuts itself until the PIN is entered again. */
export const HUB_LOCKED_EVENT = "tck:hub-locked";

export function isHubLockedResponse(status: number, body: unknown): boolean {
  if (status !== 423 || !body || typeof body !== "object") return false;
  const code = (body as { code?: unknown }).code;
  return code === "HUB_PIN_REQUIRED" || code === "PEOPLE_PIN_REQUIRED";
}

/** True for the server's daily-PIN refusal (not the People private-PIN 423). */
export function isPinRequiredResponse(status: number, body: unknown): boolean {
  if (status !== 423) return false;
  if (!body || typeof body !== "object") return false;
  return (body as { code?: unknown }).code === "PIN_REQUIRED";
}

/** Whether a fetch call was marked quiet with QUIET_REQUEST_HEADER — in its
 *  init headers (object, array or Headers) or on a Request passed in. */
export function isQuietRequest(input: unknown, init?: RequestInit): boolean {
  const has = (headers: HeadersInit | undefined | null): boolean => {
    if (!headers) return false;
    if (typeof Headers !== "undefined" && headers instanceof Headers) return headers.has(QUIET_REQUEST_HEADER);
    const entries: Array<[string, string]> = Array.isArray(headers)
      ? (headers as Array<[string, string]>)
      : Object.entries(headers as Record<string, string>);
    return entries.some(([k]) => k.toLowerCase() === QUIET_REQUEST_HEADER.toLowerCase());
  };
  if (has(init?.headers)) return true;
  const reqHeaders = (input as { headers?: Headers } | null)?.headers;
  return typeof Headers !== "undefined" && reqHeaders instanceof Headers && reqHeaders.has(QUIET_REQUEST_HEADER);
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
    if (res.status === 423 && !isQuietRequest(args[0], args[1])) {
      try {
        const body = await res.clone().json();
        if (isPinRequiredResponse(res.status, body)) host.dispatchEvent(new Event(PIN_REQUIRED_EVENT));
        else if (isHubLockedResponse(res.status, body)) host.dispatchEvent(new Event(HUB_LOCKED_EVENT));
      } catch { /* not JSON — not ours */ }
    }
    return res;
  }) as typeof fetch;
}
