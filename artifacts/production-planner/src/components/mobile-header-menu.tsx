/**
 * The phone's top-bar menu (Graeme, 2026-10-10; Objective F). On a phone
 * the bar had + SOP, the name pill, SOPs, Messages and the bell side by
 * side, and the bell fell off the end. Below md (768 px) they all live
 * behind ONE button at the top right — your avatar, with a badge when
 * there's something new — which opens this sheet. iPad and desktop keep
 * the bar exactly as it was (layout.tsx TopBar).
 *
 * The same components as the bar, not copies: the name pill
 * (CurrentUserBadge — tap to lock / switch user), MessagesButton,
 * PageSopButton ("Show me how" + add an SOP), the SOP library, the
 * station's pinned phone numbers and Contacts, and the notification
 * centre's list (NotificationList, shared with the bell).
 *
 * The sheet stays mounted while shut (just hidden), so the buttons inside
 * keep their own pop-ups open after the sheet closes — e.g. Messages
 * opening itself from a push or a station banner's "Reply".
 *
 * Closable: X, tap outside, Escape. Capped at 92dvh, scrolls inside.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { BookOpen, BookUser, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/auth-context";
import { UserAvatar } from "@/components/user-avatar";
import { CurrentUserBadge } from "@/components/current-user-badge";
import { MessagesButton } from "@/components/messages/messages-button";
import { useMessagesUnread } from "@/components/messages/messages-api";
import { NotificationList } from "@/components/notification-bell";
import { PageSopButton } from "@/components/page-sop-rail";
import { StationPinnedContacts } from "@/components/contacts/station-contacts";
import { useNotifications } from "@/hooks/use-notifications";
import { headerMenuBadge, isPhoneHeader } from "@/lib/header-menu";

/** True on a phone-width screen; follows rotation / resizing. */
export function usePhoneHeader(): boolean {
  const [phone, setPhone] = useState(() => typeof window !== "undefined" && isPhoneHeader(window.innerWidth));
  useEffect(() => {
    const on = () => setPhone(isPhoneHeader(window.innerWidth));
    on();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return phone;
}

export function MobileHeaderMenu({ pageLabel, onOpenSops, showMessages, stationKeys, onOpenContacts }: {
  /** The page's nav name — labels "Show me how" and SOPs added here. */
  pageLabel: string;
  onOpenSops: () => void;
  showMessages: boolean;
  /** When this page is a station's screen: its keys (contacts, messages). */
  stationKeys: string[] | null;
  onOpenContacts: () => void;
}) {
  const { state } = useAuth();
  const user = state.status === "authenticated" ? state.user : null;
  const [open, setOpen] = useState(false);
  const { unreadCount } = useNotifications();
  const unread = useMessagesUnread(stationKeys ?? [], false);
  const badge = headerMenuBadge({
    notifications: unreadCount,
    messages: showMessages ? unread.data?.unread ?? 0 : 0,
    messageWaiting: showMessages && (unread.data?.pendingAcks ?? 0) > 0,
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!user) return null;
  const close = () => setOpen(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative flex items-center gap-1.5 h-11 pl-1 pr-1 rounded-full border border-border bg-card shadow-sm flex-shrink-0 active:scale-[0.97]"
        aria-label={badge ? `Your menu — notifications, messages, SOPs (${badge} new)` : "Your menu — notifications, messages, SOPs"}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="mobile-header-menu-button"
      >
        <UserAvatar name={user.name} avatarUrl={user.avatarUrl} size="md" />
        {badge && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[22px] h-[22px] px-1 rounded-full bg-destructive text-destructive-foreground text-[11px] font-bold flex items-center justify-center tabular-nums shadow">
            {badge}
          </span>
        )}
      </button>

      {/* Portalled: the top bar's backdrop-blur would otherwise trap a fixed
          sheet inside the header. Hidden (not unmounted) while shut. */}
      {createPortal(
        <div
          className={cn("fixed inset-0 z-[100] bg-black/50 flex justify-end items-start p-2", !open && "hidden")}
          onClick={close}
          data-testid="mobile-header-menu"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Your menu"
            className="w-full max-w-md max-h-[92dvh] flex flex-col rounded-3xl bg-background border border-border shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 border-b border-border">
              <CurrentUserBadge className="py-1.5 pr-5 max-w-[240px]" />
              <button
                type="button"
                onClick={close}
                className="w-12 h-12 rounded-2xl bg-secondary flex items-center justify-center flex-shrink-0"
                aria-label="Close menu"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 space-y-4">
              <p className="text-sm text-muted-foreground -mt-1">Tap your name to lock the screen or switch user.</p>
              {/* Any button here closes the sheet; what it opens has its
                  own pop-up. */}
              <div className="grid grid-cols-1 gap-2.5" onClick={close}>
                {showMessages && (
                  <MessagesButton at={stationKeys ?? []} labelAlways className="h-14 w-full justify-start gap-3 px-4 rounded-2xl text-base" />
                )}
                <PageSopButton pageLabel={pageLabel} variant="sheet" />
                <button
                  type="button"
                  onClick={onOpenSops}
                  className="flex items-center gap-3 h-14 px-4 rounded-2xl text-base font-semibold border border-border"
                >
                  <BookOpen className="w-5 h-5" /> Standards & SOPs library
                </button>
                {stationKeys && (
                  <button
                    type="button"
                    onClick={onOpenContacts}
                    className="flex items-center gap-3 h-14 px-4 rounded-2xl text-base font-semibold border border-border"
                  >
                    <BookUser className="w-5 h-5" /> Contacts for this station
                  </button>
                )}
              </div>
              {stationKeys && <StationPinnedContacts stationKeys={stationKeys} className="flex-wrap" />}
              <section className="rounded-2xl border border-border px-2 pb-2">
                <NotificationList active={open} onNavigated={close} large />
              </section>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
