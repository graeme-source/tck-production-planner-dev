import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppNotification } from "./use-notifications";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const FLASHED_KEY = "tck-flashed-notification-ids";
const POLL_MS = 15_000;
// Only show flash for notifications that arrived in the last ~10 minutes.
// Stops a week's worth of un-opened comment pings bombing the user the
// first time they load the app after a break.
const FLASH_MAX_AGE_MS = 10 * 60 * 1000;

function loadFlashed(): Set<number> {
  try {
    const raw = localStorage.getItem(FLASHED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return new Set(parsed.filter((x): x is number => typeof x === "number"));
  } catch { /* ignore */ }
  return new Set();
}

function saveFlashed(set: Set<number>) {
  try {
    localStorage.setItem(FLASHED_KEY, JSON.stringify([...set]));
  } catch { /* storage full / disabled — worst case the banner re-shows, not a crash */ }
}

export function useFlashNotifications() {
  const queryClient = useQueryClient();
  const [flashedIds, setFlashedIds] = useState<Set<number>>(() => loadFlashed());

  const { data: list = [] } = useQuery({
    queryKey: ["notifications", "list"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/notifications`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json() as Promise<AppNotification[]>;
    },
    refetchInterval: POLL_MS,
    staleTime: 5_000,
  });

  const now = Date.now();
  const active = useMemo(
    () => list.filter(n =>
      !n.read
      && !flashedIds.has(n.id)
      && now - new Date(n.createdAt).getTime() < FLASH_MAX_AGE_MS,
    ),
    [list, flashedIds, now],
  );

  const dismissFlash = useCallback((id: number) => {
    setFlashedIds(prev => {
      const next = new Set(prev);
      next.add(id);
      saveFlashed(next);
      return next;
    });
  }, []);

  const markRead = useCallback(async (id: number) => {
    dismissFlash(id);
    await fetch(`${BASE}/api/notifications/${id}/read`, { method: "PATCH", credentials: "include" });
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
  }, [dismissFlash, queryClient]);

  // Keep the flashed-id set from growing forever — prune anything no longer
  // in the visible list (either read, deleted, or aged out server-side).
  useEffect(() => {
    if (list.length === 0) return;
    const visible = new Set(list.map(n => n.id));
    setFlashedIds(prev => {
      let changed = false;
      const next = new Set<number>();
      for (const id of prev) {
        if (visible.has(id)) next.add(id);
        else changed = true;
      }
      if (!changed) return prev;
      saveFlashed(next);
      return next;
    });
  }, [list]);

  return { flash: active, dismissFlash, markRead };
}
