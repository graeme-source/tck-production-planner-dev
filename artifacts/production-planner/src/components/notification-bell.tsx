import { useState } from "react";
import { useLocation } from "wouter";
import { Bell, CheckCheck, MessageSquare, ShieldCheck, CircleCheck } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useNotifications, type AppNotification } from "@/hooks/use-notifications";
import { cn } from "@/lib/utils";

const TYPE_ICONS: Record<string, typeof MessageSquare> = {
  comment: MessageSquare,
  acknowledged: ShieldCheck,
  resolved: CircleCheck,
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

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();
  const { unreadCount, notifications, fetchNotifications, markRead, markAllRead } = useNotifications();

  function handleOpen(isOpen: boolean) {
    setOpen(isOpen);
    if (isOpen) fetchNotifications();
  }

  function handleNavigate(n: AppNotification) {
    if (!n.read) markRead.mutate(n.id);
    setOpen(false);
    if (n.andonIssueId) {
      navigate(`/reports?tab=issues&issueId=${n.andonIssueId}`);
    }
  }

  return (
    <Popover open={open} onOpenChange={handleOpen}>
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
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="font-semibold text-sm">Notifications</h3>
          {unreadCount > 0 && (
            <button
              onClick={() => markAllRead.mutate()}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              Mark all read
            </button>
          )}
        </div>
        <div className="max-h-80 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No notifications yet
            </div>
          ) : (
            <div className="p-1 space-y-0.5">
              {notifications.map(n => (
                <NotificationItem key={n.id} n={n} onNavigate={handleNavigate} />
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
