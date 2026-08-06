/**
 * The founder area's own navigation — a "site within a site". One tab strip
 * shared by all founder pages, so moving between the schedule, numbers, P&L
 * and sales/marketing is one tap from anywhere, replacing the ad-hoc
 * buttons/cards each page used to carry.
 *
 * Schedule is deliberately first: it's home. /founder redirects there, and
 * every other page is a side-trip you can always step straight back from.
 */
import { Link, useLocation } from "wouter";
import { Calendar, LineChart, Calculator, Megaphone } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/founder/focus", label: "Schedule", icon: Calendar },
  { href: "/founder/numbers", label: "Numbers", icon: LineChart },
  { href: "/founder/pnl", label: "P&L", icon: Calculator },
  { href: "/founder/sales", label: "Sales & Marketing", icon: Megaphone },
] as const;

export function FounderNav() {
  const [location] = useLocation();
  return (
    <nav className="flex gap-1.5 p-1.5 rounded-2xl border border-border bg-card/60 backdrop-blur-sm overflow-x-auto">
      {TABS.map(tab => {
        const active = location === tab.href;
        const Icon = tab.icon;
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
