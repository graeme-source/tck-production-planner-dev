import React, { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronLeft, BarChart2, ClipboardList, Layers, Beef, Menu, X,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import type { ProductionPlanDetail } from "@workspace/api-client-react";
import { STATIONS, type StationType } from "./constants";
import {
  NavLinks,
  AccountButton,
  navItems,
  productNavItems,
  inventorySubItems,
} from "@/components/layout";
import { useAuth } from "@/contexts/auth-context";
import { usePagePermissions } from "@/hooks/use-page-permissions";
import { ReportButton } from "@/components/report-modal";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface AndonIssueBadge {
  severity: "yellow" | "red";
}

function useAndonBadge(stationKey: string) {
  const [severity, setSeverity] = useState<"green" | "yellow" | "red">("green");

  useEffect(() => {
    let cancelled = false;
    async function fetchAndon() {
      try {
        const res = await fetch(`${BASE}/api/andon?open=true&station=${encodeURIComponent(stationKey)}`, { credentials: "include" });
        if (!res.ok || cancelled) return;
        const issues: AndonIssueBadge[] = await res.json();
        if (issues.length === 0) {
          setSeverity("green");
        } else if (issues.some((i) => i.severity === "red")) {
          setSeverity("red");
        } else {
          setSeverity("yellow");
        }
      } catch {}
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
}

export function StationLayout({ planId, stationType, plan, children }: StationLayoutProps) {
  const [location, navigate] = useLocation();
  const search = useSearch();
  const [navOpen, setNavOpen] = useState(false);
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

      {/* Sticky station top-bar */}
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
              <div className="hidden md:flex items-center gap-0.5">
                {STATIONS.map(s => {
                  const Icon = s.icon;
                  const prepSubStations = ["main_prep", "prep_bases", "prep_meat"] as const;
                  const isActive = s.key === stationType || (s.key === "prep" && prepSubStations.includes(stationType as typeof prepSubStations[number]));
                  return (
                    <button
                      key={s.key}
                      onClick={() => navigate(`/plans/${planId}/station/${s.key}`)}
                      className={cn(
                        "flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-lg font-medium transition-colors min-w-[44px]",
                        isActive
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                      )}
                      title={s.label}
                    >
                      <Icon className="w-4 h-4 flex-shrink-0" />
                      <span className="text-[9px] leading-tight text-center">{s.short}</span>
                    </button>
                  );
                })}
              </div>

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
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {children}
      </div>

      <ReportButton defaultStation={stationType} />
    </div>
  );
}
