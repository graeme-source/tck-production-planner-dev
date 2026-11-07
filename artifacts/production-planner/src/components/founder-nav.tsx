/**
 * The founder area's own navigation — a "site within a site". One tab strip
 * shared by all founder pages, so moving between numbers, ads, P&L and
 * sales/marketing is one tap from anywhere, replacing the ad-hoc buttons/cards
 * each page used to carry. One row of double-height tabs with a line between
 * each, long labels on two lines, so there's never a sideways scroll; where the
 * panel is too narrow for that, a dropdown (Graeme, 7 Nov 2026).
 *
 * /founder lands on the first tab the viewer may open (Numbers for the
 * founder). Someone with only one tab gets no strip at all.
 */
import { Link, useLocation } from "wouter";
import { BarChart3, ChevronDown, LineChart, Calculator, Megaphone, FlaskConical, Map as MapIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useFounderArea } from "@/hooks/use-founder-area";
import { useApprovalsNeeded } from "@/components/marketing-calendar/api";

// Tab list and who may open each live in @workspace/feature-registry
// (FOUNDER_TABS) so the server rule and this strip can't drift. Contracts
// moved to People (/people/contracts) and Fix queue to its own sidebar line
// (/fix-queue) on 2026-09-29.
const ICONS: Record<string, typeof LineChart> = {
  "/founder/numbers": LineChart,
  "/founder/ads": BarChart3,
  "/founder/pnl": Calculator,
  "/founder/sales": Megaphone,
  "/founder/ab-tests": FlaskConical,
  "/founder/floor": MapIcon,
};

function WaitingBadge({ count, className }: { count: number; className?: string }) {
  const label = `${count} email${count === 1 ? "" : "s"} need your approval`;
  return (
    <span
      className={cn("min-w-5 h-5 px-1.5 rounded-full bg-amber-500 text-white text-xs font-bold inline-flex items-center justify-center", className)}
      aria-label={label}
      title={label}
    >
      {count}
    </span>
  );
}

export function FounderNav() {
  const [location] = useLocation();
  // Only the tabs this person may open — a grantee sees Numbers and/or
  // Sales & Marketing, never a tab that would bounce them.
  const { tabs, canSales, canApproveEmails } = useFounderArea();
  // Approvers get a count on Sales & Marketing: emails waiting for approval.
  const needed = useApprovalsNeeded(canSales && canApproveEmails && tabs.length > 1);
  const waiting = needed.data?.canApprove ? needed.data.count : 0;
  if (tabs.length <= 1) return null;

  const current = tabs.find(tab => tab.href === location);
  const CurrentIcon = current ? (ICONS[current.href] ?? LineChart) : LineChart;
  const waitingOn = (href: string) => (href === "/founder/sales" ? waiting : 0);

  return (
    // The panel's width decides, not the screen's: the sidebar can be open or shut.
    <div className="@container">
      <nav className="hidden @3xl:flex rounded-2xl border border-border bg-card shadow-sm overflow-hidden divide-x divide-border">
        {tabs.map(tab => {
          const active = location === tab.href;
          const Icon = ICONS[tab.href] ?? LineChart;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex-1 basis-0 min-w-0 min-h-14 flex items-center justify-center gap-1.5 px-2 py-1.5 text-[13px] @5xl:text-sm font-medium leading-tight text-center [text-wrap:balance] transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/60",
              )}
            >
              <Icon className="hidden @5xl:block w-4 h-4 flex-shrink-0" />
              <span className="min-w-0">{tab.label}</span>
              {waitingOn(tab.href) > 0 && <WaitingBadge count={waitingOn(tab.href)} className="absolute top-0 right-0 min-w-4 h-4 px-1 text-[10px] rounded-none rounded-bl-lg" />}
            </Link>
          );
        })}
      </nav>

      <div className="@3xl:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="w-full min-h-12 flex items-center gap-3 px-4 rounded-2xl border border-border bg-card shadow-sm text-base font-semibold text-foreground"
            >
              <CurrentIcon className="w-5 h-5 text-primary flex-shrink-0" />
              <span className="flex-1 min-w-0 text-left">{current?.label ?? "The Business"}</span>
              {waiting > 0 && <WaitingBadge count={waiting} />}
              <ChevronDown className="w-5 h-5 text-muted-foreground flex-shrink-0" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)] max-h-[70dvh] overflow-y-auto">
            {tabs.map(tab => {
              const active = location === tab.href;
              const Icon = ICONS[tab.href] ?? LineChart;
              return (
                <DropdownMenuItem key={tab.href} asChild>
                  <Link href={tab.href} className={cn("flex items-center gap-3 py-3 text-base cursor-pointer", active && "font-semibold text-primary")}>
                    <Icon className="w-5 h-5 flex-shrink-0" />
                    <span className="flex-1 min-w-0">{tab.label}</span>
                    {waitingOn(tab.href) > 0 && <WaitingBadge count={waitingOn(tab.href)} />}
                  </Link>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

/**
 * Link chip for founder-focus goals/items. URLs starting with "/" are pages
 * of this app (e.g. /founder/numbers) and navigate in the same tab;
 * anything else opens in a new tab as before.
 */
export function FocusLink({ url, label, className, children }: {
  url: string;
  label?: string;
  className?: string;
  children: React.ReactNode;
}) {
  if (url.startsWith("/")) {
    return (
      <Link href={url} className={className} title={url} aria-label={label}>
        {children}
      </Link>
    );
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={className} title={url} aria-label={label}>
      {children}
    </a>
  );
}
