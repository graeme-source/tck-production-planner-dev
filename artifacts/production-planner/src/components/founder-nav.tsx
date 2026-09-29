/**
 * The founder area's own navigation — a "site within a site". One tab strip
 * shared by all founder pages, so moving between the schedule, numbers, P&L
 * and sales/marketing is one tap from anywhere, replacing the ad-hoc
 * buttons/cards each page used to carry.
 *
 * /founder lands on the first tab the viewer may open (Numbers for the
 * founder). Someone with only one tab gets no strip at all.
 */
import { Link, useLocation } from "wouter";
import { Calendar, LineChart, Calculator, Megaphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFounderArea } from "@/hooks/use-founder-area";

// Tab list and who may open each live in @workspace/feature-registry
// (FOUNDER_TABS) so the server rule and this strip can't drift. Contracts
// moved to People (/people/contracts) and Fix queue to its own sidebar line
// (/fix-queue) on 2026-09-29.
const ICONS: Record<string, typeof LineChart> = {
  "/founder/numbers": LineChart,
  "/founder/focus": Calendar,
  "/founder/pnl": Calculator,
  "/founder/sales": Megaphone,
};

export function FounderNav() {
  const [location] = useLocation();
  // Only the tabs this person may open — a grantee sees Numbers and/or
  // Sales & Marketing, never a tab that would bounce them.
  const { tabs } = useFounderArea();
  if (tabs.length <= 1) return null;
  return (
    <nav className="flex gap-1.5 p-1.5 rounded-2xl border border-border bg-card/60 backdrop-blur-sm overflow-x-auto">
      {tabs.map(tab => {
        const active = location === tab.href;
        const Icon = ICONS[tab.href] ?? LineChart;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-colors",
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary/60",
            )}
          >
            <Icon className="w-4 h-4" />
            {tab.label}
          </Link>
        );
      })}
    </nav>
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
