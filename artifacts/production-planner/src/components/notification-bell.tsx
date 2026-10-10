import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Bell, CheckCheck, MessageSquare, ShieldCheck, CircleCheck, PartyPopper, ListTodo, FileSignature } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useNotifications, type AppNotification } from "@/hooks/use-notifications";
import { cn } from "@/lib/utils";

const TYPE_ICONS: Record<string, typeof MessageSquare> = {
  comment: MessageSquare,
  acknowledged: ShieldCheck,
  resolved: CircleCheck,
  improvement: PartyPopper,
  todo: ListTodo,
  contract: FileSignature,
};

function NotificationItem({ n, onNavigate }: { n: AppNotification; onNavigate: (n: AppNotification) => void }) {
  const Icon = TYPE_ICONS[n.type] ?? MessageSquare;
  return (
    <button
      onClick={() => onNavigate(n)}
      className={cn(
        "w-full flex items-start gap-3 px-3 py-2.5 text-left rounded-lg transition-colors hover:bg-secondary/60",
        !n.read && "bg-primary/5"
      )}
    >
      <div className={cn(
        "mt-0.5 flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center",
        !n.read ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
      )}>
        <Icon className="w-3.5 h-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className={cn("text-sm leading-snug", !n.read && "font-medium")}>
          {n.message}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
        </p>
      </div>
      {!n.read && (
        <span className="mt-2 flex-shrink-0 w-2 h-2 rounded-full bg-primary" />
      )}
    </button>
  );
}

/**
 * The notification centre's contents — the heading, "Mark all read" and the
 * list — shared by the bell's pop-over (iPad / desktop) and the phone's
 * top-bar menu (mobile-header-menu.tsx), so both behave identically.
 * `active`: fetch the list when it becomes visible.
 */
export function NotificationList({ active, onNavigated, large = false }: {
  active: boolean;
  /** Called after a notification is tapped (close whatever holds the list). */
  onNavigated?: () => void;
  /** Bigger heading for the phone menu. */
  large?: boolean;
}) {
  const [, navigate] = useLocation();
  const { unreadCount, notifications, fetchNotifications, markRead, markAllRead } = useNotifications();

  useEffect(() => { if (active) fetchNotifications(); }, [active, fetchNotifications]);

  // Every notification lands somewhere useful (Graeme, 2026-09-07): the
  // exact improvement, the issue, the to-do list, the contract — a bell
  // entry that goes nowhere isn't a tool.
  function handleNavigate(n: AppNotification) {
    if (!n.read) markRead.mutate(n.id);
    onNavigated?.();
    if (n.type === "test_request") {
      navigate("/test-requests?tab=problems");
    } else if (n.andonIssueId) {
      navigate(`/reports?tab=issues&issueId=${n.andonIssueId}`);
    } else if (n.improvementId) {
      navigate(`/improvements?open=${n.improvementId}`);
    } else if (n.type === "todo") {
      navigate("/hub?section=todos");
    } else if (n.type === "contract") {
      navigate("/hub?section=contract");
    }
  }

  return (
    <>
      <div className={cn("flex items-center justify-between border-b border-border", large ? "px-1 py-3" : "px-4 py-3")}>
        <h3 className={cn("font-semibold", large ? "text-lg" : "text-sm")}>
          Notifications{large && unreadCount > 0 ? ` (${unreadCount} new)` : ""}
        </h3>
        {unreadCount > 0 && (
          <button
            onClick={() => markAllRead.mutate()}
            className={cn("flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors", large ? "text-sm h-11 px-3 rounded-xl border border-border" : "text-xs")}
          >
            <CheckCheck className="w-3.5 h-3.5" />
            Mark all read
          </button>
        )}
      </div>
      <div className={large ? undefined : "max-h-80 overflow-y-auto"}>
        {notifications.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No notifications yet
          </div>
        ) : (
          <div className={cn("p-1", large ? "space-y-1" : "space-y-0.5")}>
            {notifications.map(n => (
              <NotificationItem key={n.id} n={n} onNavigate={handleNavigate} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const { unreadCount } = useNotifications();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="relative p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors flex-shrink-0"
          aria-label="Notifications"
        >
          <Bell className="w-5 h-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold px-1">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <NotificationList active={open} onNavigated={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
