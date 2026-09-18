/**
 * Shared bits of the founder-focus API, used by both the Schedule page's
 * diary and the planning tools behind it. One copy of the fetch wrapper and
 * the device cache so the two surfaces can't drift apart.
 */

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/** An event read out of Apple Calendar (CalDAV, read-only). */
export interface CalEvent {
  title: string;
  calendar: string;
  /** Minutes from midnight, Europe/London, clamped to the requested day. */
  startMin: number;
  endMin: number;
  allDay: boolean;
  joinUrl: string | null;
  joinIsCall: boolean;
}

/** The day's diary. Its own endpoint: a cold iCloud fetch takes seconds. */
export interface DayEvents {
  calendarConfigured: boolean;
  events: CalEvent[];
  calendarError: string | null;
}

export function minToTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// Last-known copies on the device, so returning to the page paints
// instantly (stale) while the fresh fetch runs — instead of a blank screen.
// Only ever used as react-query placeholderData; real data replaces it.
const FOCUS_CACHE_PREFIX = "founder-focus-cache:";

export function readCachedFocus<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(FOCUS_CACHE_PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

export function writeCachedFocus(key: string, value: unknown): void {
  try {
    localStorage.setItem(FOCUS_CACHE_PREFIX + key, JSON.stringify(value));
  } catch {
    // Quota/private-mode failures just lose the instant paint, nothing else.
  }
}

export async function founderFocusApi(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}/api/founder-focus${path}`, {
    credentials: "include",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}
