import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, Megaphone, MessageSquare, X, Check } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useFlashNotifications } from "@/hooks/use-flash-notifications";
import type { AppNotification } from "@/hooks/use-notifications";
import { cn } from "@/lib/utils";

const AUTO_DISMISS_MS = 7_000;

const TYPE_ICONS: Record<string, typeof MessageSquare> = {
  comment: MessageSquare,
  acknowledged: Bell,
  resolved: Check,
  broadcast: Megaphone,
};

function FlashItem({
  n,
  onDismiss,
  onRead,
}: {
  n: AppNotification;
  onDismiss: () => void;
  onRead: () => void;
}) {
  // Each banner auto-dismisses after a few seconds unless the user hovers
  // (desktop) — no timeout pause on touch, since the user either taps or
  // swipes. "Dismiss" means gone from the flash only; still unread in the
  // bell until they tap Mark read.
  const timerRef = useRef<number | null>(null);
  useEffect(() => {
    timerRef.current = window.setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [onDismiss]);

  const Icon = TYPE_ICONS[n.type] ?? Bell;
  const isBroadcast = n.type === "broadcast";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -20, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 200, transition: { duration: 0.2 } }}
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.4}
      onDragEnd={(_, info) => {
        if (Math.abs(info.offset.x) > 90 || Math.abs(info.velocity.x) > 500) {
          onDismiss();
        }
      }}
      onMouseEnter={() => { if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; } }}
      onMouseLeave={() => { if (!timerRef.current) timerRef.current = window.setTimeout(onDismiss, AUTO_DISMISS_MS); }}
      className={cn(
        "pointer-events-auto w-[min(92vw,420px)] rounded-2xl border shadow-2xl backdrop-blur px-4 py-3 flex items-start gap-3 cursor-grab active:cursor-grabbing select-none",
        isBroadcast
          ? "bg-amber-50/95 dark:bg-amber-900/70 border-amber-300 dark:border-amber-700"
          : "bg-card/95 border-border",
      )}
    >
      <div className={cn(
        "flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center",
        isBroadcast ? "bg-amber-500 text-white" : "bg-primary/10 text-primary",
      )}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium leading-snug break-words">{n.message}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={onRead}
            className={cn(
              "px-2.5 py-1 rounded-md text-xs font-semibold transition-colors",
              isBroadcast
                ? "bg-amber-600 text-white hover:bg-amber-700"
                : "bg-primary text-primary-foreground hover:bg-primary/90",
            )}
          >
            Mark read
          </button>
          <span className="text-[10px] text-muted-foreground">Swipe to dismiss</span>
        </div>
      </div>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="flex-shrink-0 w-7 h-7 rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary/60 flex items-center justify-center transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </motion.div>
  );
}

export function NotificationFlash() {
  const { flash, dismissFlash, markRead } = useFlashNotifications();

  // Show newest first, cap at 3 visible at once so a spam of notifications
  // doesn't bury the screen.
  const visible = flash.slice(0, 3);

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] flex flex-col items-center gap-2 pointer-events-none">
      <AnimatePresence initial={false}>
        {visible.map(n => (
          <FlashItem
            key={n.id}
            n={n}
            onDismiss={() => dismissFlash(n.id)}
            onRead={() => markRead(n.id)}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}
