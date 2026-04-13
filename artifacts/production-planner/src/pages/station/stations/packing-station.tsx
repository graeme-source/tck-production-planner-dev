import React from "react";
import { useState, useEffect, useCallback } from "react";
import type { ProductionPlanDetail } from "@workspace/api-client-react";
import {
  Loader2, RefreshCw, AlertCircle, Box, Truck, Scan, CheckCircle2,
} from "lucide-react";
import { format, parseISO, addDays } from "date-fns";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/auth-context";
import { usePagePermissions } from "@/hooks/use-page-permissions";
import { BreakTracker } from "../shared/break-tracker";

// ──────────────────────────────────────────────────────────────────────────────
interface PackingData {
  items: Array<{
    id: number;
    recipeId: number | null;
    recipeName: string;
    batchesTarget: number;
    batchesComplete: number;
    wonlyCount: number;
    grossPacks: number;
    netPacks: number;
    wrappingComplete: boolean;
    status: string;
    orderPosition: number;
    dispatches: Array<{ id: number; quantity: number; customer: string | null; status: string | null; notes: string | null }>;
    totalDispatch: number;
  }>;
  totalNetPacks: number;
  totalGrossPacks: number;
  totalWonly: number;
}

interface DispatchProgress {
  tag: string;
  totalOrders: number;
  totalFulfilled: number;
  categories: {
    smallBox: { total: number; fulfilled: number };
    largeBox: { total: number; fulfilled: number };
    wholesale: { total: number; fulfilled: number };
    other: { total: number; fulfilled: number };
  };
}

interface DessertItem {
  title: string;
  quantity: number;
  orderCount: number;
}

interface DessertsReport {
  tag: string;
  products: DessertItem[];
  totalQuantity: number;
  dessertProductCount: number;
}

interface PackingShortfallItem {
  recipeId: number | null;
  recipeName: string;
  fridgeQty: number;
  plannedPacks: number;
  totalDispatch: number;
  shortfall: number;
  level: "yellow" | "red";
}

export function PackingStation({ plan }: { plan: ProductionPlanDetail }) {
  const [, navigate] = useLocation();
  const { state } = useAuth();
  const { canAccess } = usePagePermissions();
  const userRole = state.status === "authenticated" ? state.user.role : "viewer";
  const canPack = canAccess(userRole, "/fulfilment");

  // Dates: production happens today (plan.planDate); orders are tagged with delivery date (tomorrow)
  const packingDate = parseISO(plan.planDate);
  const packingLabel = format(packingDate, "EEEE d MMM");
  const deliveryDate = addDays(packingDate, 1);
  const deliveryLabel = format(deliveryDate, "EEEE d MMM");
  const dispatchTag = format(deliveryDate, "yyyy-MM-dd"); // Shopify order tag = delivery date

  const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

  const [progress, setProgress] = useState<DispatchProgress | null>(null);
  const [desserts, setDesserts] = useState<DessertsReport | null>(null);
  const [packingItems, setPackingItems] = useState<Array<{
    recipeId: number | null;
    recipeName: string;
    batchesTarget: number;
    portionsPerBatch: number;
    fridgeQty: number;
    totalDispatch: number;
  }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [progressRes, dessertsRes, packingRes] = await Promise.all([
        fetch(`${BASE}/api/fulfilment/dispatch-progress?tag=${dispatchTag}`, { credentials: "include" }),
        fetch(`${BASE}/api/fulfilment/desserts-report?tag=${dispatchTag}`, { credentials: "include" }),
        fetch(`${BASE}/api/production-plans/${plan.id}/packing`, { credentials: "include" }),
      ]);
      if (!progressRes.ok && !dessertsRes.ok) {
        setError("Failed to load dispatch data");
        return;
      }
      if (progressRes.ok) setProgress(await progressRes.json());
      else setError("Failed to load dispatch progress");
      if (dessertsRes.ok) setDesserts(await dessertsRes.json());
      if (packingRes.ok) {
        const data = await packingRes.json();
        setPackingItems(data.items ?? []);
      }
      if (progressRes.ok && dessertsRes.ok) setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load dispatch data");
    } finally {
      setLoading(false);
    }
  }, [dispatchTag, plan.id, BASE]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Stock shortfall analysis: compare live fridge stock against today's dispatch quantities.
  // Yellow = need today's production to fulfil; Red = can't fulfil even after production.
  const shortfalls: PackingShortfallItem[] = packingItems
    .filter(item => item.totalDispatch > 0)
    .flatMap(item => {
      const fridgeQty = item.fridgeQty ?? 0;
      const plannedPacks = Math.floor((item.batchesTarget ?? 0) * (item.portionsPerBatch ?? 10) / 2);
      const totalDispatch = item.totalDispatch ?? 0;
      if (fridgeQty >= totalDispatch) return [];
      const shortfall = totalDispatch - (fridgeQty + plannedPacks);
      const level: "yellow" | "red" = shortfall > 0 ? "red" : "yellow";
      return [{
        recipeId: item.recipeId,
        recipeName: item.recipeName,
        fridgeQty,
        plannedPacks,
        totalDispatch,
        shortfall,
        level,
      }];
    });

  const redShortfalls = shortfalls.filter(s => s.level === "red");
  const yellowShortfalls = shortfalls.filter(s => s.level === "yellow");

  const cats = progress?.categories;

  function CatCard({ label, cat, color }: { label: string; cat: { total: number; fulfilled: number }; color: string }) {
    if (cat.total === 0) return null;
    const remaining = cat.total - cat.fulfilled;
    const pct = Math.round((cat.fulfilled / cat.total) * 100);
    return (
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-lg font-semibold">{label}</span>
          <span className={cn("text-sm font-medium px-2 py-0.5 rounded-full", remaining === 0 ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300")}>
            {remaining === 0 ? "Done" : `${remaining} left`}
          </span>
        </div>
        <div className="flex items-baseline gap-1 mb-2">
          <span className="text-3xl font-bold tabular-nums">{cat.fulfilled}</span>
          <span className="text-muted-foreground text-base">/ {cat.total}</span>
          <span className="text-sm text-muted-foreground ml-auto">{pct}%</span>
        </div>
        <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header — single source of date truth */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <Box className="w-6 h-6 text-indigo-500" />
            <div>
              <h2 className="font-semibold text-lg">Packing on {packingLabel}</h2>
              <p className="text-sm text-muted-foreground">
                Dispatch {packingLabel}
                <span className="mx-1.5 text-border">·</span>
                <Truck className="w-3 h-3 inline mb-0.5 mr-0.5 text-muted-foreground/70" />
                For delivery {deliveryLabel}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {progress && (
              <span className="text-2xl font-bold font-display">
                {progress.totalOrders > 0 ? Math.round((progress.totalFulfilled / progress.totalOrders) * 100) : 0}%
              </span>
            )}
            <button
              onClick={fetchData}
              disabled={loading}
              className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-lg transition-colors disabled:opacity-50 disabled:pointer-events-none"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
        <div className="w-full h-2.5 bg-secondary rounded-full overflow-hidden mb-3">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              progress && progress.totalFulfilled >= progress.totalOrders && progress.totalOrders > 0 ? "bg-emerald-500" : "bg-indigo-500"
            )}
            style={{ width: `${progress && progress.totalOrders > 0 ? Math.min(Math.round((progress.totalFulfilled / progress.totalOrders) * 100), 100) : 0}%` }}
          />
        </div>
        <div className="pt-3 border-t border-border/50">
          <BreakTracker planId={plan.id} stationType="packing" onBreakActiveChange={() => {}} />
        </div>
      </div>

      {loading && !progress && (
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          Loading dispatch data…
        </div>
      )}

      {error && (
        <div className="flex items-center gap-3 p-4 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm">{error}</p>
        </div>
      )}

      {/* Stock shortfall check — red first, then yellow */}
      {redShortfalls.length > 0 && (
        <div className="bg-red-50 dark:bg-red-950/20 border border-red-300 dark:border-red-700 rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 bg-red-100 dark:bg-red-900/30 border-b border-red-300 dark:border-red-700">
            <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0" />
            <p className="text-base font-semibold text-red-700 dark:text-red-300">Hard Shortfall — not enough even after production</p>
          </div>
          <div className="divide-y divide-red-200 dark:divide-red-800">
            {redShortfalls.map(s => (
              <div key={s.recipeId ?? s.recipeName} className="px-4 py-3">
                <p className="text-base font-semibold text-red-800 dark:text-red-200 mb-1">{s.recipeName}</p>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-red-700 dark:text-red-300">
                  <span>{s.fridgeQty} in fridge</span>
                  <span>dispatching {s.totalDispatch}</span>
                  <span>making {s.plannedPacks} today</span>
                  <span className="font-bold">{s.shortfall} pack{s.shortfall !== 1 ? "s" : ""} short</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {yellowShortfalls.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-300 dark:border-amber-700 rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 bg-amber-100 dark:bg-amber-900/30 border-b border-amber-300 dark:border-amber-700">
            <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
            <p className="text-base font-semibold text-amber-700 dark:text-amber-300">Stock Warning — ok after today's production completes</p>
          </div>
          <div className="divide-y divide-amber-200 dark:divide-amber-800">
            {yellowShortfalls.map(s => (
              <div key={s.recipeId ?? s.recipeName} className="px-4 py-3">
                <p className="text-base font-semibold text-amber-800 dark:text-amber-200 mb-1">{s.recipeName}</p>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-amber-700 dark:text-amber-300">
                  <span>{s.fridgeQty} in fridge</span>
                  <span>dispatching {s.totalDispatch}</span>
                  <span>making {s.plannedPacks} today</span>
                  <span className="font-medium">{Math.abs(s.shortfall)} surplus after production</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {progress && (
        <>
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="font-semibold text-base">Overall Progress</span>
              <div className="flex items-center gap-2 text-base">
                <span className="font-bold text-primary tabular-nums">{progress.totalFulfilled}/{progress.totalOrders}</span>
                {progress.totalOrders - progress.totalFulfilled > 0 ? (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 font-medium">
                    {progress.totalOrders - progress.totalFulfilled} remaining
                  </span>
                ) : progress.totalOrders > 0 ? (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 font-medium">
                    All dispatched!
                  </span>
                ) : null}
              </div>
            </div>
            {progress.totalOrders > 0 && (
              <div className="w-full h-3 bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-500"
                  style={{ width: `${Math.round((progress.totalFulfilled / progress.totalOrders) * 100)}%` }}
                />
              </div>
            )}
          </div>

          {cats && (
            <div className="grid grid-cols-2 gap-3">
              <CatCard label="Small Box" cat={cats.smallBox} color="bg-blue-500" />
              <CatCard label="Large Box" cat={cats.largeBox} color="bg-indigo-500" />
              <CatCard label="Wholesale" cat={cats.wholesale} color="bg-amber-500" />
              {cats.other.total > 0 && <CatCard label="Other" cat={cats.other} color="bg-gray-500" />}
            </div>
          )}
        </>
      )}

      {desserts && desserts.products.length > 0 && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border/50 bg-pink-50/50 dark:bg-pink-900/10">
            <div className="flex items-center gap-2">
              <span className="text-lg">🍰</span>
              <h3 className="font-semibold text-base">Desserts Report</h3>
              <span className="text-sm text-muted-foreground ml-auto">{desserts.totalQuantity} units total</span>
            </div>
          </div>
          <div className="divide-y divide-border/50">
            {desserts.products.map(p => (
              <div key={p.title} className="flex items-center justify-between px-4 py-2.5">
                <span className="text-base">{p.title}</span>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground">{p.orderCount} orders</span>
                  <span className="font-bold tabular-nums text-base bg-pink-100 dark:bg-pink-900/30 px-2.5 py-0.5 rounded-lg text-pink-800 dark:text-pink-200">{p.quantity}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {canPack && progress && progress.totalOrders - progress.totalFulfilled > 0 && (
        <button
          onClick={() => navigate(`/fulfilment?tag=${dispatchTag}`)}
          className="w-full py-4 bg-primary text-primary-foreground rounded-2xl font-semibold text-base flex items-center justify-center gap-3 hover:opacity-90 transition-opacity active:scale-[0.98]"
        >
          <Scan className="w-5 h-5" />
          Pack &amp; Dispatch Orders
          <span className="text-base font-normal opacity-80">
            ({progress.totalOrders - progress.totalFulfilled} remaining)
          </span>
        </button>
      )}

    </div>
  );
}