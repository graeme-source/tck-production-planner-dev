/**
 * The Messages button — same place on every page (Graeme, 2026-10-07): in
 * the top bar beside the bell on ordinary pages, and in the same spot on
 * station screens. The badge is your unread count (red when something is
 * waiting for you to confirm). Opens the chat panel.
 *
 * Also opens itself when:
 *   - a station banner's "Reply" asks (openMessages(key)), and
 *   - the app is opened from a message push (/?messages=<chat>).
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMessagesUnread, OPEN_MESSAGES_EVENT } from "./messages-api";
import { MessagesPanel } from "./messages-panel";

export function MessagesButton({ at = [], className }: { at?: string[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const [initialKey, setInitialKey] = useState<string | null>(null);
  const unread = useMessagesUnread(at, open);
  const count = unread.data?.unread ?? 0;
  const waiting = (unread.data?.pendingAcks ?? 0) > 0;

  useEffect(() => {
    const onOpen = (e: Event) => {
      const key = (e as CustomEvent<{ conversationKey?: string }>).detail?.conversationKey ?? null;
      setInitialKey(key);
      setOpen(true);
    };
    window.addEventListener(OPEN_MESSAGES_EVENT, onOpen);
    // Tapped a message push: /?messages=u:3,u:7
    const params = new URLSearchParams(window.location.search);
    const fromPush = params.get("messages");
    if (fromPush) {
      setInitialKey(fromPush);
      setOpen(true);
      params.delete("messages");
      const qs = params.toString();
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`);
    }
    return () => window.removeEventListener(OPEN_MESSAGES_EVENT, onOpen);
  }, []);

  return (
    <>
      <button
        onClick={() => { setInitialKey(null); setOpen(true); }}
        className={cn(
          "relative flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm font-semibold border transition-colors flex-shrink-0",
          count > 0 || waiting ? "border-primary text-primary bg-primary/10 hover:bg-primary/15" : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60",
          className,
        )}
        title="Messages"
        aria-label={count > 0 ? `Messages, ${count} unread` : "Messages"}
        data-testid="messages-button"
      >
        <MessageCircle className="w-4 h-4" />
        <span className="hidden sm:inline">Messages</span>
        {(count > 0 || waiting) && (
          <span className={cn(
            "absolute -top-2 -right-2 min-w-[20px] h-5 px-1 rounded-full text-[11px] font-bold flex items-center justify-center text-white",
            waiting ? "bg-red-600" : "bg-primary",
          )}>
            {count > 99 ? "99+" : count || "!"}
          </span>
        )}
      </button>
      {open && createPortal(
        <MessagesPanel at={at} initialKey={initialKey} onClose={() => setOpen(false)} />,
        document.body,
      )}
    </>
  );
}
