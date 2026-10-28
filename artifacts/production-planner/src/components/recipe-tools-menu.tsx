/**
 * Recipe tools — one button on the Recipes page header for the checks and
 * settings that aren't everyday work (Graeme, 28 Oct 2026: "we're just adding
 * big panels for each of them… consolidate all into one recipe menu
 * button"). Each opens in its own pop-up:
 *   - Timing check: build times and meat cook/process times the day schedule
 *     needs, missing or out of line with the floor. Its count shows on the
 *     button, so a gap isn't hidden by the fold. /recipes#timing-data (the
 *     link on "review this" to-dos) opens it.
 *   - Prep oven timings: when each meat goes in, self-correcting from what
 *     really happened.
 *   - UPF & nutrition on the website: what each product page shows.
 * Same look as the Station menu. Objectives F, G.
 */
import { useEffect, useState } from "react";
import type React from "react";
import { Clock, Globe, MoreHorizontal, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { TimingHealthCard, useTimingHealth } from "@/components/timing-health-card";
import { MeatTimingReview } from "@/components/meat-timing-learning-card";
import { UpfWebsiteSync } from "@/components/upf-website-sync";
import { ToolPopup } from "@/components/tool-popup";

type ToolKey = "timing" | "oven" | "website";

interface Tool {
  key: ToolKey;
  label: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
  iconClass: string;
  chip?: { text: string; tone: "ok" | "warn" | "bad" } | null;
}

export function RecipeToolsMenu({ onEditRecipe }: { onEditRecipe: (recipeId: number) => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [tool, setTool] = useState<ToolKey | null>(() =>
    typeof window !== "undefined" && window.location.hash === "#timing-data" ? "timing" : null);
  const timing = useTimingHealth();

  // A to-do's link to /recipes#timing-data opens the timing check.
  useEffect(() => {
    const onHash = () => { if (window.location.hash === "#timing-data") setTool("timing"); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const toCheck = timing.total - timing.missingCount;
  const tools: Tool[] = [
    ...(timing.canManage ? [{
      key: "timing" as const,
      label: "Timing check",
      hint: "Build times and meat cook times the day schedule needs",
      icon: Clock,
      iconClass: "text-primary",
      chip: !timing.data ? null
        : timing.missingCount > 0 ? { text: `${timing.missingCount} missing`, tone: "bad" as const }
        : toCheck > 0 ? { text: `${toCheck} to check`, tone: "warn" as const }
        : { text: "All set", tone: "ok" as const },
    }] : []),
    {
      key: "oven",
      label: "Prep oven timings",
      hint: "When each meat goes in — corrects itself from what happened",
      icon: Sparkles,
      iconClass: "text-rose-500",
    },
    {
      key: "website",
      label: "UPF & nutrition on the website",
      hint: "What each product page shows, and update it now",
      icon: Globe,
      iconClass: "text-primary",
    },
  ];
  const dot = timing.missingCount > 0 ? timing.missingCount : null;
  const close = () => {
    setTool(null);
    if (window.location.hash === "#timing-data") history.replaceState(null, "", window.location.pathname + window.location.search);
  };
  const current = tools.find(t => t.key === tool);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setMenuOpen(v => !v)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={dot ? `Recipe tools, ${dot} timing${dot === 1 ? "" : "s"} missing` : "Recipe tools"}
        className={cn(
          "relative h-11 px-4 rounded-xl border-2 text-sm font-bold inline-flex items-center gap-2 transition-colors",
          menuOpen ? "bg-primary text-primary-foreground border-primary" : "border-border bg-card text-foreground hover:bg-secondary/60",
        )}
      >
        <MoreHorizontal className="w-5 h-5" /> Recipe tools
        {dot && (
          <span className="absolute -top-2 -right-2 min-w-6 h-6 px-1.5 rounded-full bg-red-500 text-white text-xs font-bold flex items-center justify-center ring-2 ring-card tabular-nums">
            {dot}
          </span>
        )}
      </button>

      {menuOpen && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
          <div role="menu" className="absolute right-0 top-full mt-2 z-40 w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-border bg-card shadow-xl overflow-hidden py-1.5">
            {tools.map(t => {
              const Icon = t.icon;
              return (
                <button
                  key={t.key}
                  role="menuitem"
                  type="button"
                  onClick={() => { setMenuOpen(false); setTool(t.key); }}
                  className="w-full flex items-center gap-3 px-4 min-h-14 py-2.5 text-left hover:bg-secondary/60 active:bg-secondary transition-colors"
                >
                  <Icon className={cn("w-5 h-5 flex-shrink-0", t.iconClass)} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-base font-semibold">{t.label}</span>
                    <span className="block text-xs text-muted-foreground">{t.hint}</span>
                  </span>
                  {t.chip && (
                    <span className={cn(
                      "px-2 py-0.5 rounded-full text-xs font-bold whitespace-nowrap",
                      t.chip.tone === "bad" ? "bg-red-500 text-white" : t.chip.tone === "warn" ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
                    )}>{t.chip.text}</span>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}

      {current && (
        <ToolPopup title={current.label} icon={current.icon} iconClass={cn("w-6 h-6 shrink-0", current.iconClass)} onClose={close}>
          {current.key === "timing" && <TimingHealthCard embedded onEditRecipe={id => { close(); onEditRecipe(id); }} />}
          {current.key === "oven" && <MeatTimingReview />}
          {current.key === "website" && <UpfWebsiteSync embedded />}
        </ToolPopup>
      )}
    </div>
  );
}
