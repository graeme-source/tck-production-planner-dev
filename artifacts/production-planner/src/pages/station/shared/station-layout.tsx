import React, { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  ChevronLeft, BarChart2, ClipboardList, Layers, Beef,
  Menu, X,
  LayoutDashboard, CalendarDays, ChefHat, Carrot, Truck,
  Building2, Settings, Lightbulb, PackageSearch, ArrowDownCircle,
  ShoppingCart, PackageCheck, Box,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import type { ProductionPlanDetail } from "@workspace/api-client-react";
import { STATIONS, type StationType } from "./constants";

interface StationLayoutProps {
  planId: number;
  stationType: StationType;
  plan: ProductionPlanDetail | undefined;
  children: React.ReactNode;
}

const NAV_LINKS = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Production Plans", href: "/plans", icon: CalendarDays },
  { label: "Recipes", href: "/recipes", icon: ChefHat },
  { label: "Sub-Recipes", href: "/sub-recipes", icon: ClipboardList },
  { label: "Ingredients", href: "/inventory?tab=ingredients", icon: Carrot },
  { label: "Dispatches", href: "/dispatches", icon: Truck },
  { label: "Suppliers", href: "/suppliers", icon: Building2 },
  { label: "Orders", href: "/orders", icon: ShoppingCart },
  { label: "Deliveries", href: "/deliveries", icon: PackageCheck },
  { label: "Kanbans", href: "/kanbans", icon: ArrowDownCircle },
  { label: "Stock", href: "/stock", icon: PackageSearch },
  { label: "Lean Cave", href: "/lean-cave", icon: Lightbulb },
  { label: "Settings", href: "/settings", icon: Settings },
];

export function StationLayout({ planId, stationType, plan, children }: StationLayoutProps) {
  const [, navigate] = useLocation();
  const [navOpen, setNavOpen] = useState(false);
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
      {/* Nav drawer overlay */}
      {navOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
          onClick={() => setNavOpen(false)}
        />
      )}

      {/* Slide-in nav drawer */}
      <div
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-72 bg-card border-r border-border shadow-2xl flex flex-col transition-transform duration-300 ease-in-out",
          navOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex items-center justify-between px-4 py-4 border-b border-border flex-shrink-0">
          <div>
            <p className="font-semibold text-sm">The Calzone Kitchen</p>
            <p className="text-xs text-muted-foreground">Main Menu</p>
          </div>
          <button
            onClick={() => setNavOpen(false)}
            className="p-1.5 rounded-lg hover:bg-secondary/60 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-3 px-3 space-y-0.5">
          {NAV_LINKS.map(item => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setNavOpen(false)}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
            >
              <item.icon className="w-4 h-4 flex-shrink-0" />
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="border-t border-border p-3 flex-shrink-0">
          <button
            onClick={() => { setNavOpen(false); navigate(`/plans`); }}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
          >
            <CalendarDays className="w-4 h-4 flex-shrink-0" />
            Back to Production Plans
          </button>
        </div>
      </div>

      {/* Sticky top header */}
      <div className="border-b border-border bg-card sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              {/* Hamburger button */}
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
                  <h1 className="font-semibold truncate">{meta.label}</h1>
                  {plan && (
                    <p className="text-xs text-muted-foreground truncate">
                      Batch #{plan.batchNumber ?? ""} · {format(parseISO(plan.planDate), "EEEE d MMM yyyy")}
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="hidden md:flex items-center gap-1 overflow-x-auto">
                {STATIONS.map(s => {
                  const Icon = s.icon;
                  const prepSubStations = ["main_prep", "prep_bases", "prep_meat"] as const;
                  const isActive = s.key === stationType || (s.key === "prep" && prepSubStations.includes(stationType as typeof prepSubStations[number]));
                  return (
                    <button
                      key={s.key}
                      onClick={() => navigate(`/plans/${planId}/station/${s.key}`)}
                      className={cn(
                        "flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap",
                        isActive
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                      )}
                      title={s.label}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {s.short}
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
    </div>
  );
}
