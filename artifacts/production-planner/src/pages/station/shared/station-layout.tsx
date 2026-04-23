import React, { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronLeft, ChevronDown, ChevronUp, BarChart2, ClipboardList, Layers, Beef, Menu, X, LayoutGrid, BookOpen,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import type { ProductionPlanDetail } from "@workspace/api-client-react";
import { STATIONS, type StationType } from "./constants";
import { BreakTracker } from "./break-tracker";
import {
  NavLinks,
  AccountButton,
  navItems,
  productNavItems,
  inventorySubItems,
} from "@/components/layout";
import { useAuth } from "@/contexts/auth-context";
import { usePagePermissions } from "@/hooks/use-page-permissions";
import { useStationAssignment } from "@/hooks/use-station-assignment";
import { ReportButton } from "@/components/report-modal";
import { StandardsSopsDialog } from "@/components/standards-sops-dialog";

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
  const [navOpen, setNavOpen] = useState(false);
  const [stationNavOpen, setStationNavOpen] = useState(false);
  const [standardsOpen, setStandardsOpen] = useState(false);
  const { state, logout, lockStation } = useAuth();
  const { canAccess } = usePagePermissions();
  const { assignments, enabled: stationLockEnabled } = useStationAssignment(planId, stationType);
  const currentUserId = state.status === "authenticated" ? state.user.id : 0;
  const isAdmin = state.status === "authenticated" && state.user.role === "admin";
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
          <div className="flex items-center justify-between gap-4">
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
            </div>

            <div className="flex items-center gap-2">
              {headerSlot}
              <BreakTracker planId={planId} stationType={stationType} onBreakActiveChange={onBreakActiveChange} />
              <button
                onClick={() => setStandardsOpen(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg font-medium text-sm border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
                title="Standards & SOPs"
              >
                <BookOpen className="w-4 h-4" />
                <span className="hidden sm:inline">SOPs</span>
              </button>
              <button
                onClick={() => setStationNavOpen(v => !v)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-2 rounded-lg font-medium text-sm transition-colors",
                  stationNavOpen
                    ? "bg-primary text-primary-foreground"
                    : "border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                )}
                title="Switch station"
              >
                <LayoutGrid className="w-4 h-4" />
                <span className="hidden sm:inline">Stations</span>
                {stationNavOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>

              {(() => {
                const prepSubKeys = ["main_prep", "prep_bases", "prep_meat"] as const;
                const isInPrepSub = (prepSubKeys as readonly string[]).includes(stationType);
                return (
                  <button
                    onClick={() => navigate(isInPrepSub ? `/plans/${planId}/station/prep` : `/plans`)}
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

        {/* Collapsible station navigation grid — rendered INSIDE the sticky
            top-bar so it appears at the current viewport top regardless of
            scroll position. */}
        <AnimatePresence>
          {stationNavOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="border-t border-border bg-card overflow-hidden"
            >
              <div className="max-w-7xl mx-auto px-4 py-4">
              <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-9 gap-3">
                {STATIONS.map(s => {
                  const Icon = s.icon;
                  const prepSubStations = ["main_prep", "prep_bases", "prep_meat"] as const;
                  const isActive = s.key === stationType || (s.key === "prep" && prepSubStations.includes(stationType as typeof prepSubStations[number]));
                  const bgColors: Record<string, string> = {
                    dough_prep: "bg-amber-50 dark:bg-amber-900/20",
                    dough_sheeting: "bg-amber-50 dark:bg-amber-900/20",
                    prep: "bg-green-50 dark:bg-green-900/20",
                    mixing: "bg-blue-50 dark:bg-blue-900/20",
                    building_1: "bg-orange-50 dark:bg-orange-900/20",
                    building_2: "bg-orange-50 dark:bg-orange-900/20",
                    ovens: "bg-red-50 dark:bg-red-900/20",
                    wrapping: "bg-purple-50 dark:bg-purple-900/20",
                    packing: "bg-indigo-50 dark:bg-indigo-900/20",
                  };

                  // Station lock: check if this building station is assigned to someone else
                  const isBuildingStation = s.key === "building_1" || s.key === "building_2";
                  const stationAssignment = isBuildingStation ? assignments[s.key as "building_1" | "building_2"] : null;
                  const isLockedToOther = stationLockEnabled && !isAdmin && isBuildingStation && stationAssignment !== null && stationAssignment.userId !== currentUserId;

                  return (
                    <button
                      key={s.key}
                      onClick={() => {
                        if (isLockedToOther) return;
                        navigate(`/plans/${planId}/station/${s.key}`);
                        setStationNavOpen(false);
                      }}
                      disabled={isLockedToOther}
                      className={cn(
                        "flex flex-col items-center justify-center gap-3 p-4 min-h-[120px] rounded-2xl transition-all",
                        isLockedToOther
                          ? "border-2 border-border opacity-40 cursor-not-allowed"
                          : "active:scale-[0.97]",
                        !isLockedToOther && isActive
                          ? "border-2 border-primary bg-primary/5 shadow-sm"
                          : !isLockedToOther
                            ? "border-2 border-border hover:border-primary/50 hover:bg-secondary/40"
                            : ""
                      )}
                    >
                      <div className={cn("w-16 h-16 rounded-xl flex items-center justify-center", bgColors[s.key] ?? "", s.color)}>
                        <Icon className="w-8 h-8" />
                      </div>
                      <span className="text-sm font-bold text-center leading-tight">{s.short}</span>
                      {isLockedToOther && stationAssignment && (
                        <span className="text-xs text-muted-foreground leading-tight">Assigned to {stationAssignment.userName}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      </div>

      <div className="max-w-7xl mx-auto px-4 pt-6 pb-[200px]">
        {children}
      </div>

      <ReportButton
        defaultStation={stationType}
        reportContext={
          plan
            ? `${meta.label} station · Plan: ${format(parseISO(plan.planDate), "EEEE d MMM yyyy")}${plan.batchNumber ? ` · Batch #${plan.batchNumber}` : ""}`
            : `${meta.label} station`
        }
      />

      <StandardsSopsDialog
        open={standardsOpen}
        onClose={() => setStandardsOpen(false)}
        currentStationType={stationType}
      />
    </div>
  );
}
