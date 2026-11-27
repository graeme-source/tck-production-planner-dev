/**
 * Fulfil queue for Order Packing Live (Graeme, 27 Nov 2026 — #140447).
 *
 * Pressing Complete still moves the packer straight on, but the request now
 * lives in this queue until the server actually answers:
 *   - no answer (network error, or Railway's own "Application failed to
 *     respond" 5xx while the server restarts) → try again,
 *     2 s, 4 s, 8 s … then every 30 s, for up to 15 minutes. Safe to repeat:
 *     the server treats an already-fulfilled order as done and never takes
 *     stock off twice;
 *   - an answer from our server saying no (a 4xx gate, or a 5xx carrying
 *     its own error — Shopify refused after the server's own retries) →
 *     stop and report it;
 *   - kept in this device's storage, so closing or reloading the page
 *     carries on where it left off.
 * Orders the queue gave up on stay listed for a day so opening the order
 * again says what happened. One queue per browser tab (module singleton).
 * Objective C.
 */
const STORAGE_KEY = "tck.fulfil-queue.v1";
const BASE = (import.meta.env?.BASE_URL ?? "/").replace(/\/$/, "");
export const GIVE_UP_AFTER_MS = 15 * 60_000;
const KEEP_FOR_MS = 24 * 3600_000;
const REQUEST_TIMEOUT_MS = 45_000;

export type QueueState = "sending" | "waiting" | "gave-up";
export interface QueueEntry {
  key: string;
  orderId: number;
  orderName: string;
  customerName: string;
  consignmentNumber: string | null;
  trackingUrl?: string;
  firstAt: number;
  tries: number;
  lastError: string | null;
  state: QueueState;
}
export interface CompleteResult { ok: true; orderId: number; consignmentNumber: string | null; decrementError: string | null }

// ── Pure rules (tested) ─────────────────────────────────────────────────────

/** status null = no answer at all. A 5xx without our server's `error`
 *  field came from Railway's edge (it says `message`), i.e. the app wasn't
 *  there — try again. Anything our server said itself is final. */
export function isRetryable(status: number | null, body: unknown = null): boolean {
  if (status == null) return true;
  if (status < 500) return false;
  const err = body && typeof body === "object" ? (body as Record<string, unknown>).error : undefined;
  return typeof err !== "string";
}

/** Wait before try n+1 (n = tries so far, from 1). */
export function retryDelayMs(tries: number): number {
  const steps = [2_000, 4_000, 8_000, 15_000];
  return steps[Math.max(0, tries - 1)] ?? 30_000;
}

/** Stored entries worth keeping: live ones always, given-up ones for a day.
 *  A live entry left from a crash is resumed as waiting. */
export function entriesToKeep(list: QueueEntry[], now: number): QueueEntry[] {
  return list
    .filter(e => e && typeof e.orderId === "number" && now - e.firstAt < KEEP_FOR_MS)
    .map(e => (e.state === "sending" ? { ...e, state: "waiting" as const } : e));
}

/** Plain words for a failed try. */
export function describeFailure(status: number | null, message: string | null): string {
  if (status == null) return "The server didn't answer (it may have been restarting)";
  if (status >= 500 && !message) return "The server didn't answer (it may have been restarting)";
  return message ?? `HTTP ${status}`;
}

// ── Store ───────────────────────────────────────────────────────────────────

let entries: QueueEntry[] = [];
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const inFlight = new Set<string>();
let handlers: {
  onDone?: (e: QueueEntry, r: CompleteResult) => void;
  onFailed?: (e: QueueEntry, message: string) => void;
  onRetrying?: (e: QueueEntry) => void;
} = {};
let loaded = false;

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)); } catch { /* storage off — queue still works in memory */ }
}
function set(next: QueueEntry[]) {
  entries = next;
  save();
  listeners.forEach(l => l());
}
function patch(key: string, p: Partial<QueueEntry>) {
  set(entries.map(e => (e.key === key ? { ...e, ...p } : e)));
}
function load() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    entries = raw ? entriesToKeep(JSON.parse(raw) as QueueEntry[], Date.now()) : [];
  } catch { entries = []; }
}

export function subscribe(fn: () => void) { load(); listeners.add(fn); return () => { listeners.delete(fn); }; }
export function getSnapshot(): QueueEntry[] { load(); return entries; }
export function setQueueHandlers(h: typeof handlers) { handlers = h; }

async function post(e: QueueEntry, tryNumber: number): Promise<{ status: number | null; body: Record<string, unknown> | null }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}/api/fulfilment/orders/${e.orderId}/complete`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(e.consignmentNumber ? { consignmentNumber: e.consignmentNumber, trackingUrl: e.trackingUrl } : {}),
        clientAttemptId: e.key,
        tryNumber,
      }),
      signal: ctrl.signal,
    });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  } catch {
    return { status: null, body: null };
  } finally {
    clearTimeout(t);
  }
}

async function run(key: string) {
  if (inFlight.has(key)) return;
  const e0 = entries.find(e => e.key === key);
  if (!e0 || e0.state === "gave-up") return;
  inFlight.add(key);
  const tryNumber = e0.tries + 1;
  patch(key, { state: "sending", tries: tryNumber });
  const { status, body } = await post(e0, tryNumber);
  inFlight.delete(key);
  const e = entries.find(x => x.key === key);
  if (!e) return;
  if (status != null && status >= 200 && status < 300) {
    set(entries.filter(x => x.key !== key));
    handlers.onDone?.(e, body as unknown as CompleteResult);
    return;
  }
  const message = describeFailure(status, typeof body?.error === "string" ? body.error : null);
  if (!isRetryable(status, body) || Date.now() - e.firstAt >= GIVE_UP_AFTER_MS) {
    const final = isRetryable(status, body) ? `${message} — gave up after ${Math.round(GIVE_UP_AFTER_MS / 60_000)} minutes of trying` : message;
    patch(key, { state: "gave-up", lastError: final });
    handlers.onFailed?.({ ...e, state: "gave-up", lastError: final }, final);
    return;
  }
  patch(key, { state: "waiting", lastError: message });
  handlers.onRetrying?.({ ...e, state: "waiting", lastError: message });
  timers.set(key, setTimeout(() => { timers.delete(key); void run(key); }, retryDelayMs(tryNumber)));
}

/** Queue a Complete. A second press for an order already on its way is ignored. */
export function enqueueComplete(init: Omit<QueueEntry, "key" | "firstAt" | "tries" | "lastError" | "state">) {
  load();
  if (entries.some(e => e.orderId === init.orderId && e.state !== "gave-up")) return;
  const key = `${init.orderId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  set([...entries.filter(e => e.orderId !== init.orderId), { ...init, key, firstAt: Date.now(), tries: 0, lastError: null, state: "waiting" }]);
  void run(key);
}

/** Carry on with anything a reload or crash left half-sent. */
export function resumeQueue() {
  load();
  for (const e of entries) if (e.state !== "gave-up" && !timers.has(e.key)) void run(e.key);
}

/** The order was dealt with (fulfilled by hand, or a manager cleared it). */
export function forgetOrder(orderId: number) {
  load();
  for (const e of entries) if (e.orderId === orderId) { const t = timers.get(e.key); if (t) clearTimeout(t); timers.delete(e.key); }
  set(entries.filter(e => e.orderId !== orderId));
}
