/**
 * Invisible prep timing (Graeme, 27 Oct 2026 — "when someone opens up the
 * Garlic Cheese Cheddar and then they prep it, 5 minutes later it's done";
 * Objectives C and I). A prep screen tells this hook which prep item is open
 * and when a tick or a make flow completes; the hook reports that to
 * /api/prep-sessions (api-server routes/prep-sessions.ts) in the background.
 * The founder-only report (GET /api/prep-times/report — no screen) turns it
 * into minutes per item and per batch.
 *
 * Invisible by design: no extra taps, nothing on screen changes, nothing
 * waits on it. Every request is fire-and-forget and marked quiet, so a PIN
 * refusal never raises the PIN pad (lib/pin-required-fetch.ts); a failure is
 * logged to the console and dropped — losing one timing is fine, slowing a
 * bench tap is not.
 *
 *   const timing = usePrepSessionCapture({ planId, station: "main_prep", enabled: !isDraft });
 *   timing.focus([{ ingredientId: 12 }])   what is open on screen now ([] = nothing)
 *   timing.ticked({ ingredientId, recipeId, tinNumber, quantity, unit })   after a tick SAVED
 *   timing.unticked({ ingredientId })      after an undo saved
 *   timing.made({ subRecipeId, batches, quantity, unit })   a make flow finished
 *
 * Sessions are closed when the item leaves the screen, the plan or the
 * signed-in person changes, or the screen unmounts. Deliberately NOT on the
 * iPad sleeping or the tab going to the background: people prep with the
 * screen off, and the server simply carries the session on.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useAuth } from "@/contexts/auth-context";
import { QUIET_REQUEST_HEADER } from "@/lib/pin-required-fetch";
import {
  cleanQuantity, deviceIdFrom, focusChanges, prepItemBaseKey,
  type PrepSessionItem, type PrepSessionStation,
} from "@/lib/prep-session-capture";

export type { PrepSessionItem, PrepSessionStation } from "@/lib/prep-session-capture";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface PrepTickInfo {
  ingredientId?: number | null;
  subRecipeId?: number | null;
  recipeId: number;
  tinNumber: number;
  subRecipeOriginId?: number | null;
  /** What the tin/tray held, in the unit the screen showed. */
  quantity?: number | null;
  unit?: string | null;
}

export interface PrepMadeInfo {
  subRecipeId: number;
  batches: number;
  quantity?: number | null;
  unit?: string | null;
}

export interface PrepSessionCapture {
  focus: (items: PrepSessionItem[]) => void;
  ticked: (tick: PrepTickInfo) => void;
  unticked: (item: Pick<PrepSessionItem, "ingredientId" | "subRecipeId">) => void;
  made: (made: PrepMadeInfo) => void;
}

async function post<T>(path: string, body: unknown, keepalive = false): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}/api/prep-sessions${path}`, {
      method: "POST",
      credentials: "include",
      keepalive,
      headers: { "Content-Type": "application/json", [QUIET_REQUEST_HEADER]: "1" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn(`[prep-timing] ${path} not recorded (${res.status})`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.warn(`[prep-timing] ${path} not recorded:`, err);
    return null;
  }
}

let deviceIdCache: string | null | undefined;
function deviceId(): string | null {
  if (deviceIdCache === undefined) {
    let storage: Storage | null = null;
    try { storage = window.localStorage; } catch { storage = null; /* blocked: no id, see deviceIdFrom */ }
    deviceIdCache = deviceIdFrom(storage, () =>
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
  }
  return deviceIdCache;
}

const itemIds = (item: PrepSessionItem) => ({
  ingredientId: item.ingredientId ?? null,
  subRecipeId: item.subRecipeId ?? null,
});

export function usePrepSessionCapture({ planId, station, enabled = true }: {
  planId: number | null | undefined;
  station: PrepSessionStation;
  /** false = record nothing (a draft plan, no plan to prep for). */
  enabled?: boolean;
}): PrepSessionCapture {
  const { state } = useAuth();
  const userId = state.status === "authenticated" ? state.user.id : null;
  const live = enabled && planId != null && planId > 0 && userId != null;
  const ctx = useRef({ planId, station, live });
  ctx.current = { planId, station, live };

  // Item key → the open request's session id (null = not recorded).
  const open = useRef(new Map<string, Promise<number | null>>());
  const wanted = useRef<PrepSessionItem[]>([]);

  const closeKey = useCallback((key: string) => {
    const pending = open.current.get(key);
    open.current.delete(key);
    void pending?.then(id => { if (id != null) void post(`/${id}/close`, {}, true); });
  }, []);

  const sync = useCallback(() => {
    const { planId: p, station: s, live: on } = ctx.current;
    const { close, open: toOpen } = focusChanges(open.current.keys(), on ? wanted.current : []);
    for (const key of close) closeKey(key);
    for (const { key, item } of toOpen) {
      open.current.set(key, post<{ sessionId: number | null }>("/open", {
        planId: p, station: s, ...itemIds(item), recipeId: item.recipeId ?? null, deviceId: deviceId(),
      }).then(r => r?.sessionId ?? null));
    }
  }, [closeKey]);

  // A new plan, a different person, timing switched off, or leaving the
  // screen: close what was open, then re-open what's wanted under the new
  // context (nothing, when it's an unmount).
  useEffect(() => {
    sync();
    const sessions = open.current;
    return () => { for (const key of [...sessions.keys()]) closeKey(key); };
  }, [planId, userId, station, live, sync, closeKey]);

  /** Wait for any open request still in flight for this item, so the server
   *  has the session before the completion arrives. */
  const afterOpen = useCallback(async (item: PrepSessionItem) => {
    const base = prepItemBaseKey(item);
    const pending = [...open.current].filter(([k]) => base != null && (k === base || k.startsWith(`${base}@`))).map(([, p]) => p);
    await Promise.all(pending);
  }, []);

  const focus = useCallback((items: PrepSessionItem[]) => {
    wanted.current = items;
    sync();
  }, [sync]);

  const ticked = useCallback((t: PrepTickInfo) => {
    const { planId: p, live: on } = ctx.current;
    if (!on) return;
    void afterOpen(t).then(() => post("/complete", {
      kind: "tick", planId: p, ...itemIds(t), recipeId: t.recipeId, tinNumber: t.tinNumber,
      subRecipeOriginId: t.subRecipeOriginId ?? null, quantity: cleanQuantity(t.quantity), unit: t.unit ?? null,
    }));
  }, [afterOpen]);

  const unticked = useCallback((item: Pick<PrepSessionItem, "ingredientId" | "subRecipeId">) => {
    const { planId: p, live: on } = ctx.current;
    if (!on) return;
    void post("/untick", { planId: p, ...itemIds(item) });
  }, []);

  const made = useCallback((m: PrepMadeInfo) => {
    const { planId: p, live: on } = ctx.current;
    if (!on || !(m.batches > 0)) return;
    void afterOpen({ subRecipeId: m.subRecipeId }).then(() => post("/complete", {
      kind: "make", planId: p, subRecipeId: m.subRecipeId, batches: m.batches,
      quantity: cleanQuantity(m.quantity), unit: m.unit ?? null,
    }));
  }, [afterOpen]);

  return useMemo(() => ({ focus, ticked, unticked, made }), [focus, ticked, unticked, made]);
}
