import React, { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronLeft, BarChart2, ClipboardList, Layers, Beef, Menu, X, BookOpen, MoreVertical, MessageSquare, BookPlus,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import type { ProductionPlanDetail } from "@workspace/api-client-react";
import { STATIONS, type StationType } from "./constants";
import { BreakTracker } from "./break-tracker";
import { StationReminderBanner } from "./timed-reminders";
import { StationMessagesBanner, SendStationMessageDialog } from "@/components/station-messages";
import {
  NavLinks,
  AccountButton,
  navItems,
  productNavItems,
  inventorySubItems,
} from "@/components/layout";
import { useAuth } from "@/contexts/auth-context";
import { usePagePermissions } from "@/hooks/use-page-permissions";
import { StandardsSopsDialog } from "@/components/standards-sops-dialog";
import { StationSopRail, StationSopManageModal } from "@/components/sop-link-chips";
import { LeanWeeklyStrip } from "@/components/lean-weekly-review";
import { QuickActionsDock } from "@/components/layout";
import { CurrentUserBadge } from "@/components/current-user-badge";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface AndonIssueBadge {
  severity: "green" | "yellow" | "red";
}

function useAndonBadge(stationKey: string) {
  const [severity, setSeverity] = useState<"green" | "yellow" | "red">("green");
  const hasToastedRef = React.useRef(false);

  useEffect(() => {
    let cancelled = false;
    async function fetchAndon() {
      try {
        const res = await fetch(`${BASE}/api/andon?open=true&station=${encodeURIComponent(stationKey)}`, { credentials: "include" });
        if (!res.ok || cancelled) return;
        hasToastedRef.current = false;
        const issues: AndonIssueBadge[] = await res.json();
        // Wish-list (green) issues don't escalate the station badge.
        if (issues.some((i) => i.severity === "red")) {
          setSeverity("red");
        } else if (issues.some((i) => i.severity === "yellow")) {
          setSeverity("yellow");
        } else {
          setSeverity("green");
        }
      } catch (err) {
        console.warn("[AndonBadge] Failed to fetch andon status:", err);
        if (!hasToastedRef.current) {
          hasToastedRef.current = true;
          toast({ title: "Issue status unavailable", description: "Could not load andon status.", variant: "destructive" });
        }
      }
    }
    fetchAndon();
    const interval = setInterval(fetchAndon, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [stationKey]);

  return severity;
}

interface StationLayoutProps {
  planId: number;
  stationType: StationType;
  plan: ProductionPlanDetail | undefined;
  children: React.ReactNode;
  headerSlot?: React.ReactNode;
  onBreakActiveChange?: (active: boolean) => void;
}

export function StationLayout({ planId, stationType, plan, children, headerSlot, onBreakActiveChange }: StationLayoutProps) {
  const [location, navigate] = useLocation();
  const search = useSearch();
  // Prep sub-sections keep the ?from flag while hopping so the Prep hub can
  // pass it along; the exit itself now always lands on the Dashboard — the
  // dashboard IS the station picker (Graeme, 2026-09-16).
  const fromDashboard = new URLSearchParams(search).get("from") === "dashboard";
  const fromSuffix = fromDashboard ? "?from=dashboard" : "";
  const [navOpen, setNavOpen] = useState(false);
  const [standardsOpen, setStandardsOpen] = useState(false);
  // The ⋯ menu next to Exit Station: message a station, view the SOP
  // library, attach an SOP to this station. Folded away so the top bar fits
  // one line on iPad landscape (Graeme, 2026-09-16).
  const [moreOpen, setMoreOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [manageSopsOpen, setManageSopsOpen] = useState(false);
  const { state, logout, lockStation } = useAuth();
  const { canAccess } = usePagePermissions();
  const andonBadge = useAndonBadge(stationType);

  const user = state.status === "authenticated" ? state.user : null;

  const visibleNavItems = navItems.filter(item =>
    canAccess(user?.role ?? "viewer", item.href)
  );
  const visibleProductItems = productNavItems.filter(item =>
    canAccess(user?.role ?? "viewer", item.href)
  );
  const visibleInventoryItems = inventorySubItems.filter(item =>
    canAccess(user?.role ?? "viewer", item.href)
  );

  const station = STATIONS.find(s => s.key === stationType);

  const resolveStationMeta = (key: StationType): { label: string; icon: React.ComponentType<{ className?: string }>; color: string } => {
    if (key === "main_prep") return { label: "Main Prep", icon: ClipboardList, color: "text-emerald-600" };
    if (key === "prep_bases") return { label: "Bases & Sauces", icon: Layers, color: "text-yellow-500" };
    if (key === "prep_meat") return { label: "Raw Meat Prep", icon: Beef, color: "text-rose-500" };
    return station ?? { label: key, icon: BarChart2, color: "" };
  };
  const meta = resolveStationMeta(stationType);
  const StationIcon = meta.icon;

  return (
    <div className="min-h-screen bg-background">
      {/* Backdrop */}
      <AnimatePresence>
        {navOpen && (
          <motion.div
            key="station-nav-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-black/50"
            onClick={() => setNavOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Slide-in nav drawer — identical structure to the main mobile drawer */}
      <AnimatePresence>
        {navOpen && (
          <motion.div
            key="station-nav-drawer"
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="fixed inset-y-0 left-0 z-50 w-72 bg-card border-r border-border flex flex-col"
          >
            {/* Header */}
            <div className="px-5 py-4 flex items-center justify-between border-b border-border flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-primary flex items-center justify-center p-1.5">
                  <img
                    src={`${import.meta.env.BASE_URL}tck-logo-short-cream.png`}
                    alt="TCK"
                    className="w-full h-full object-contain"
                  />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="font-display font-bold text-sm leading-tight">The Calzone Kitchen</span>
                  <span className="text-xs text-muted-foreground">Production Planner</span>
                </div>
              </div>
              <button
                onClick={() => setNavOpen(false)}
                className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Nav links — exactly the same component the sidebar uses */}
            <NavLinks
              visibleNavItems={visibleNavItems}
              visibleProductItems={visibleProductItems}
              visibleInventoryItems={visibleInventoryItems}
              location={location}
              search={search}
              user={user}
              onNavigate={() => setNavOpen(false)}
            />

            {/* Account button at bottom */}
            <div className="p-4 border-t border-border flex-shrink-0">
              <AccountButton
                user={user}
                logout={logout}
                lockStation={lockStation}
                onNavigate={() => setNavOpen(false)}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sticky station top-bar (contains the collapsible station nav so it
          always renders at the current viewport top instead of the original
          top of the document) */}
      <div className="border-b border-border bg-card sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between gap-x-4 gap-y-2 flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              {/* Hamburger — opens the real app nav */}
              <button
                onClick={() => setNavOpen(true)}
                className="flex-shrink-0 p-1.5 rounded-lg hover:bg-secondary/60 text-muted-foreground hover:text-foreground transition-colors"
                title="Main menu"
              >
                <Menu className="w-5 h-5" />
              </button>

              <div className="flex items-center gap-2 min-w-0">
                <StationIcon className={cn("w-5 h-5 flex-shrink-0", meta.color)} />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h1 className="font-semibold truncate">{meta.label}</h1>
                    <span
                      title={andonBadge === "green" ? "No open issues" : andonBadge === "yellow" ? "Minor issue open" : "Serious issue open"}
                      className={cn(
                        "w-2.5 h-2.5 rounded-full flex-shrink-0",
                        andonBadge === "red" ? "bg-red-500" : andonBadge === "yellow" ? "bg-yellow-400" : "bg-emerald-500"
                      )}
                    />
                  </div>
                  {plan && (
                    <p className="text-xs text-muted-foreground truncate">
                      Batch #{plan.batchNumber ?? ""} · {format(parseISO(plan.planDate), "EEEE d MMM yyyy")}
                    </p>
                  )}
                </div>
              </div>
              <CurrentUserBadge />
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {headerSlot}
              <BreakTracker planId={planId} stationType={stationType} onBreakActiveChange={onBreakActiveChange} />

              {/* ⋯ menu — everything that used to be its own button (message
                  a station, SOPs) lives here so the bar stays one line. */}
              <div className="relative">
                <button
                  onClick={() => setMoreOpen(v => !v)}
                  className={cn(
                    "flex items-center justify-center w-9 h-9 rounded-lg transition-colors",
                    moreOpen
                      ? "bg-primary text-primary-foreground"
                      : "border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                  )}
                  title="More"
                  aria-label="More station actions"
                >
                  <MoreVertical className="w-4 h-4" />
                </button>
                {moreOpen && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setMoreOpen(false)} />
                    <div className="absolute right-0 top-full mt-1.5 z-40 w-60 rounded-xl border border-border bg-card shadow-xl overflow-hidden py-1">
                      <button
                        onClick={() => { setMoreOpen(false); setComposeOpen(true); }}
                        className="w-full flex items-center gap-2.5 px-4 py-3 text-sm font-medium text-left hover:bg-secondary/60 transition-colors"
                      >
                        <MessageSquare className="w-4 h-4 text-sky-600 flex-shrink-0" />
                        Message a station
                      </button>
                      <button
                        onClick={() => { setMoreOpen(false); setStandardsOpen(true); }}
                        className="w-full flex items-center gap-2.5 px-4 py-3 text-sm font-medium text-left hover:bg-secondary/60 transition-colors"
                      >
                        <BookOpen className="w-4 h-4 text-primary flex-shrink-0" />
                        View SOP library
                      </button>
                      <button
                        onClick={() => { setMoreOpen(false); setManageSopsOpen(true); }}
                        className="w-full flex items-center gap-2.5 px-4 py-3 text-sm font-medium text-left hover:bg-secondary/60 transition-colors"
                      >
                        <BookPlus className="w-4 h-4 text-primary flex-shrink-0" />
                        Add SOP to this station
                      </button>
                    </div>
                  </>
                )}
              </div>

              {(() => {
                const prepSubKeys = ["main_prep", "prep_bases", "prep_meat"] as const;
                const isInPrepSub = (prepSubKeys as readonly string[]).includes(stationType);
                return (
                  <button
                    onClick={() => navigate(isInPrepSub ? `/plans/${planId}/station/prep${fromSuffix}` : "/")}
                    className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors border border-border rounded-lg px-3 py-1.5"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    {isInPrepSub ? "Prep Sections" : "Exit Station"}
                  </button>
                );
              })()}
            </div>
          </div>
        </div>
      </div>

      {/* pt/pb kept tight — every band of padding here is vertical space the
          recipe panel can't have on a 10.2" iPad (Graeme, 2026-09-16). The
          banner wrappers use empty:hidden so a banner that renders nothing
          costs no margin either. */}
      <div className="max-w-7xl mx-auto px-4 pt-3 pb-20">
        {/* Station-scoped SOPs — the "any process on this station" anchor.
            Attach here for anything that isn't a specific recipe or
            ingredient; the linked SOPs render as "Show me how" buttons. */}
        <div className="mb-3 empty:hidden">
          <LeanWeeklyStrip />
        </div>
        <StationSopRail stationType={stationType} stationLabel={meta.label} />
        <StationReminderBanner stationType={stationType} plan={plan} />
        {/* Messages sent to THIS station — banner until someone taps Got it. */}
        <div className="mb-3 empty:hidden">
          <StationMessagesBanner stationType={stationType} />
        </div>
        {children}
      </div>

      <StandardsSopsDialog
        open={standardsOpen}
        onClose={() => setStandardsOpen(false)}
        currentStationType={stationType}
      />

      {composeOpen && (
        <SendStationMessageDialog onClose={() => setComposeOpen(false)} />
      )}
      {manageSopsOpen && (
        <StationSopManageModal
          stationType={stationType}
          stationLabel={meta.label}
          onClose={() => setManageSopsOpen(false)}
        />
      )}

      {/* Station screens render outside Layout, so the quick-actions dock
          (My to-dos · Improvement · Report issue · Ask Caz) was missing
          exactly where the team spends the day (Graeme, 2026-08-28). It is
          now the only way to raise anything from a station — the old
          floating Report button that used to sit in the bottom-right corner
          is gone, along with its tabbed modal. */}
      <QuickActionsDock />
    </div>
  );
}
