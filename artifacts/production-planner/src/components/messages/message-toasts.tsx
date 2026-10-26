/**
 * New-message pop-ups (Graeme, 2026-10-26): "a toast pop-up that doesn't stop
 * the user doing what they're doing, but it does stay up until they just
 * swipe it away" — for messages to you, your station, Everyone, a mention or
 * a reply. Must-confirm messages aren't shown here: they already take over
 * the screen until confirmed.
 *
 * A small stack in the top corner. Never blocks the page (only the cards
 * take taps). Each card stays until it's swiped sideways (or ✕ on a
 * computer); tapping it opens that chat. Lives beside the Messages button,
 * so it knows which station screen it's on (`at`). One stack per page even
 * if two buttons are mounted.
 *
 * Starting point: the first check only notes the newest message — nothing
 * already in your chats pops up when you sign in. Kept per person per tab.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { MessageCircle, X } from "lucide-react";
import { conversationTitle, previewText, type Audience } from "@workspace/messages";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";
import { openMessages, stationLabel, usePeople } from "./messages-api";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const POLL_MS = 20_000;
const MAX_SHOWN = 5;

interface ToastMessage {
  id: number;
  key: string;
  audience: Audience;
  senderName: string | null;
  preview: string;
  createdAt: string;
}

// One stack per page, whichever Messages button mounts first.
let owner: symbol | null = null;

function storageKey(userId: number) { return `tck_msg_toast_after_${userId}`; }
function readAfter(userId: number): number | null {
  try { const v = sessionStorage.getItem(storageKey(userId)); return v == null ? null : Number(v); } catch { return null; }
}
function writeAfter(userId: number, id: number) {
  try { sessionStorage.setItem(storageKey(userId), String(id)); } catch { /* private mode: starts fresh next load */ }
}

export function MessageToasts({ at, paused }: { at: string[]; paused: boolean }) {
  const { state } = useAuth();
  const me = state.status === "authenticated" ? state.user : null;
  const [mine] = useState(() => Symbol("message-toasts"));
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (owner == null) { owner = mine; setActive(true); }
    return () => { if (owner === mine) owner = null; };
  }, [mine]);

  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const afterRef = useRef<number | null>(null);
  useEffect(() => { afterRef.current = me ? readAfter(me.id) : null; setToasts([]); }, [me?.id]);

  const atKey = at.join(",");
  const poll = useQuery({
    queryKey: ["message-toasts", me?.id ?? null, atKey],
    enabled: active && !!me,
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const after = afterRef.current;
      const qs = new URLSearchParams();
      if (atKey) qs.set("at", atKey);
      if (after != null) qs.set("after", String(after));
      const r = await fetch(`${BASE}/api/messages/toasts?${qs}`, { credentials: "include" });
      if (!r.ok) throw new Error(`toasts ${r.status}`);
      return (await r.json()) as { latestId: number; messages: ToastMessage[] };
    },
  });

  useEffect(() => {
    const d = poll.data;
    if (!d || !me) return;
    const first = afterRef.current == null;
    if (d.latestId > (afterRef.current ?? -1)) {
      afterRef.current = d.latestId;
      writeAfter(me.id, d.latestId);
    }
    // While the chat panel is open they're reading anyway.
    if (first || paused || d.messages.length === 0) return;
    setToasts(prev => {
      const seen = new Set(prev.map(t => t.id));
      const fresh = d.messages.filter(m => !seen.has(m.id));
      return [...fresh, ...prev].slice(0, MAX_SHOWN);
    });
  }, [poll.data, paused, me]);

  const people = usePeople(active && toasts.length > 0);
  const nameOf = (id: number) => people.data?.people.find(p => p.id === id)?.name;

  if (!active || toasts.length === 0 || !me) return null;
  const dismiss = (id: number) => setToasts(prev => prev.filter(t => t.id !== id));

  return createPortal(
    <div className="fixed top-14 right-2 sm:right-4 z-[65] w-[min(94vw,380px)] flex flex-col gap-2 pointer-events-none" aria-live="polite">
      {toasts.map(t => (
        <SwipeCard key={t.id} onDismiss={() => dismiss(t.id)}
          onOpen={() => { dismiss(t.id); openMessages(t.key); }}
          title={t.senderName ?? "Someone"}
          where={whereLine(t, me.id, nameOf)}
          body={previewText(t.preview, nameOf, 140)} />
      ))}
    </div>,
    document.body,
  );
}

/** "Packing", "Everyone", "You, Jane and Dave" — or "Direct message" when
 *  the chat's name would just repeat the sender. */
function whereLine(t: ToastMessage, myId: number, nameOf: (id: number) => string | undefined): string {
  const title = conversationTitle(t.audience, myId, stationLabel, nameOf);
  const direct = !t.audience.everyone && t.audience.stations.length === 0 && t.audience.userIds.length <= 2;
  return direct && (!title || title === t.senderName) ? "Direct message" : title;
}

/** One card: drag sideways past a third of its width to dismiss; a tap opens. */
function SwipeCard({ title, where, body, onOpen, onDismiss }: {
  title: string; where: string; body: string; onOpen: () => void; onDismiss: () => void;
}) {
  const [dx, setDx] = useState(0);
  const [leaving, setLeaving] = useState<0 | 1 | -1>(0);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const moved = useRef(false);

  const finish = (dir: 1 | -1) => { setLeaving(dir); setTimeout(onDismiss, 180); };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`New message from ${title} in ${where}. Tap to open, swipe to dismiss.`}
      onKeyDown={e => { if (e.key === "Enter") onOpen(); if (e.key === "Escape" || e.key === "Delete") finish(1); }}
      onPointerDown={e => { start.current = { x: e.clientX, y: e.clientY, id: e.pointerId }; moved.current = false; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }}
      onPointerMove={e => {
        if (!start.current || start.current.id !== e.pointerId) return;
        const x = e.clientX - start.current.x;
        if (Math.abs(x) > 6) moved.current = true;
        setDx(x);
      }}
      onPointerUp={e => {
        const width = (e.currentTarget as HTMLElement).offsetWidth || 300;
        start.current = null;
        if (Math.abs(dx) > width / 3) { finish(dx > 0 ? 1 : -1); return; }
        setDx(0);
        if (!moved.current) onOpen();
      }}
      onPointerCancel={() => { start.current = null; setDx(0); }}
      style={{
        transform: `translateX(${leaving ? leaving * 420 : dx}px)`,
        opacity: leaving ? 0 : 1 - Math.min(Math.abs(dx) / 400, 0.6),
        transition: start.current ? "none" : "transform 180ms ease-out, opacity 180ms ease-out",
        touchAction: "pan-y",
      }}
      className="pointer-events-auto select-none cursor-pointer rounded-2xl border-2 border-primary/40 bg-card shadow-xl px-3.5 py-3 flex gap-3 animate-in slide-in-from-right-4 fade-in"
    >
      <span className="w-10 h-10 rounded-full bg-primary/15 text-primary flex items-center justify-center flex-shrink-0">
        <MessageCircle className="w-5 h-5" />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-base font-bold leading-snug break-words">{title}</span>
        <span className="block text-xs font-semibold text-muted-foreground break-words">{where}</span>
        <span className="block text-sm mt-0.5 break-words line-clamp-3">{body}</span>
      </span>
      <button
        type="button"
        aria-label="Dismiss"
        onPointerDown={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); finish(1); }}
        className={cn("w-8 h-8 -mr-1 -mt-1 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-secondary flex-shrink-0")}
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
