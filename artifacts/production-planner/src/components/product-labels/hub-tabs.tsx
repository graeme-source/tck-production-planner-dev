/**
 * Big tabs for the Product Labels hub (/labels and /labels/:id), with the
 * chosen tab kept in the address (?tab=…) so a link can land on it and the
 * back button behaves. The first tab is the default and leaves no ?tab.
 * Objective F.
 */
import type { ComponentType } from "react";
import { useLocation, useSearch } from "wouter";
import { useFeatureAccess } from "@/hooks/use-feature-access";
import { cn } from "@/lib/utils";
import { searchForTab, tabFromSearch } from "@/lib/tab-param";

export type HubTab<K extends string> = { key: K; label: string; icon: ComponentType<{ className?: string }> };

/** `allowed` is the tabs this viewer can see, default first. */
export function useTabParam<K extends string>(allowed: readonly K[]): [K, (tab: K) => void] {
  const search = useSearch();
  const [location, navigate] = useLocation();
  const tab = tabFromSearch(search, allowed);
  const setTab = (next: K) => navigate(`${location}${searchForTab(search, next, allowed)}`, { replace: true });
  return [tab, setTab];
}

/**
 * The ingredient deck, nutrition and data health views came from the old
 * Product Hub, whose access level (Settings → Team & Access, key
 * "/product-hub", plus any "page.product_hub" grant) still decides who sees
 * them — so retiring the hub moved nobody's access either way.
 */
export function useCanSeeProductData(): boolean {
  const { can } = useFeatureAccess();
  return can("page.product_hub");
}

export function HubTabs<K extends string>({ tabs, value, onChange }: { tabs: HubTab<K>[]; value: K; onChange: (k: K) => void }) {
  return (
    <div role="tablist" className="flex flex-wrap gap-2">
      {tabs.map(t => (
        <button
          key={t.key}
          role="tab"
          aria-selected={value === t.key}
          onClick={() => onChange(t.key)}
          className={cn(
            "h-12 px-5 rounded-xl border-2 text-base font-bold inline-flex items-center gap-2 transition-colors",
            value === t.key ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:text-foreground",
          )}
        >
          <t.icon className="w-5 h-5" /> {t.label}
        </button>
      ))}
    </div>
  );
}
