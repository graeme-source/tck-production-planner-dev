import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Thermometer, Snowflake, Package, RefreshCw, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface StockItem {
  id: number;
  name: string;
  color: string | null;
  qty: number;
  unit: string;
  type: string;
}

interface StockLocation {
  key: string;
  label: string;
  zone: string;
  icon: string;
  totalPacks: number;
  items: StockItem[];
}

interface StockControlData {
  productionFridgeTotal: number;
  locations: StockLocation[];
}

async function fetchStockControl(): Promise<StockControlData> {
  const res = await fetch(`${BASE}/api/stock-control`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch stock control data");
  return res.json();
}

function ZoneIcon({ zone, className }: { zone: string; className?: string }) {
  if (zone === "freezer") return <Snowflake className={className} />;
  if (zone === "fridge") return <Thermometer className={className} />;
  return <Package className={className} />;
}

function zoneColors(zone: string) {
  if (zone === "freezer")
    return { icon: "text-blue-500", bg: "bg-blue-500/10", ring: "ring-blue-400/60", activeBg: "bg-blue-500/15" };
  if (zone === "fridge")
    return { icon: "text-cyan-500", bg: "bg-cyan-500/10", ring: "ring-cyan-400/60", activeBg: "bg-cyan-500/15" };
  return { icon: "text-amber-500", bg: "bg-amber-500/10", ring: "ring-amber-400/60", activeBg: "bg-amber-500/15" };
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full py-20 text-muted-foreground gap-3">
      <Package className="w-12 h-12 opacity-15" />
      <p className="text-sm">No stock recorded for {label}</p>
    </div>
  );
}

function FocusPanel({ location }: { location: StockLocation }) {
  const colors = zoneColors(location.zone);
  const totalQty = location.items.reduce((s, i) => s + i.qty, 0);
  const maxQty = location.items[0]?.qty ?? 1;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-4 px-6 py-5 border-b border-border">
        <div className={cn("p-3 rounded-xl", colors.bg)}>
          <ZoneIcon zone={location.zone} className={cn("w-5 h-5", colors.icon)} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-display font-bold text-xl leading-tight">{location.label}</h2>
          <p className="text-xs text-muted-foreground capitalize mt-0.5">{location.zone} storage</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-3xl font-display font-bold tabular-nums leading-none">
            {Math.round(totalQty).toLocaleString()}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {location.items.length} {location.items.length === 1 ? "item" : "items"}
          </p>
        </div>
      </div>

      {/* Item list */}
      <div className="flex-1 overflow-y-auto">
        {location.items.length === 0 ? (
          <EmptyState label={location.label} />
        ) : (
          <div className="divide-y divide-border/40">
            {location.items.map((item, idx) => {
              const barWidth = Math.max(3, (item.qty / maxQty) * 100);
              const pct = totalQty > 0 ? Math.round((item.qty / totalQty) * 100) : 0;
              return (
                <div key={`${item.type}-${item.id}`} className="px-6 py-4 hover:bg-secondary/30 transition-colors">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-xs font-semibold text-muted-foreground w-5 tabular-nums shrink-0">
                      {idx + 1}
                    </span>
                    <span
                      className="flex-1 font-medium text-sm truncate"
                      style={item.color ? { color: item.color } : undefined}
                    >
                      {item.name}
                    </span>
                    <span className="text-sm font-bold tabular-nums shrink-0">
                      {Math.round(item.qty).toLocaleString()}
                      <span className="text-xs font-normal text-muted-foreground ml-1">{item.unit}</span>
                    </span>
                    <span className="text-xs text-muted-foreground w-9 text-right shrink-0">{pct}%</span>
                  </div>
                  <div className="ml-8 h-2 bg-secondary rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${barWidth}%`,
                        background: item.color ?? "hsl(var(--primary))",
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function StockControl() {
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["stock-control"],
    queryFn: fetchStockControl,
    staleTime: 2 * 60 * 1000,
  });

  const [selectedKey, setSelectedKey] = useState<string>("production_fridge");

  // When data loads, ensure selected key is valid; keep production_fridge as default
  useEffect(() => {
    if (!data) return;
    const keys = data.locations.map(l => l.key);
    if (!keys.includes(selectedKey)) {
      setSelectedKey(keys[0] ?? "production_fridge");
    }
  }, [data]);

  const selectedLocation = data?.locations.find(l => l.key === selectedKey) ?? null;

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] -mt-0">
      <div className="px-6 pt-6 pb-0 flex-shrink-0">
        <PageHeader
          title="Stock Control"
          description="Current stock levels across all storage locations"
          action={
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-2 hover:bg-secondary transition-colors disabled:opacity-50"
            >
              <RefreshCw className={cn("w-3.5 h-3.5", isFetching && "animate-spin")} />
              Refresh
            </button>
          }
        />
      </div>

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <RefreshCw className="w-6 h-6 animate-spin mr-2" />
          <span className="text-sm">Loading stock levels…</span>
        </div>
      ) : error ? (
        <div className="m-6 glass-panel rounded-2xl p-8 text-center text-destructive text-sm">
          Failed to load stock data. Please refresh and try again.
        </div>
      ) : (
        <div className="flex flex-1 gap-4 px-6 pb-6 pt-4 overflow-hidden min-h-0">

          {/* ── LEFT — location list ─────────────────────────────── */}
          <div className="w-64 xl:w-72 flex-shrink-0 glass-panel rounded-2xl overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-border">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Locations</p>
            </div>
            <nav className="flex-1 overflow-y-auto py-1.5">
              {data?.locations.map((loc) => {
                const colors = zoneColors(loc.zone);
                const qty = Math.round(loc.items.reduce((s, i) => s + i.qty, 0));
                const isSelected = loc.key === selectedKey;
                return (
                  <button
                    key={loc.key}
                    onClick={() => setSelectedKey(loc.key)}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-3 text-left transition-all duration-150 relative",
                      isSelected
                        ? "bg-secondary/80 text-foreground"
                        : "hover:bg-secondary/40 text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {isSelected && (
                      <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r-full bg-primary" />
                    )}
                    <div className={cn("p-2 rounded-lg flex-shrink-0", isSelected ? colors.bg : "bg-secondary/60")}>
                      <ZoneIcon zone={loc.zone} className={cn("w-4 h-4", isSelected ? colors.icon : "text-muted-foreground")} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={cn("text-sm font-medium leading-tight truncate", isSelected && "text-foreground")}>
                        {loc.label}
                      </p>
                      <p className="text-xs text-muted-foreground capitalize">{loc.zone}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={cn("text-base font-display font-bold tabular-nums leading-tight", isSelected ? "text-foreground" : "text-muted-foreground")}>
                        {qty.toLocaleString()}
                      </p>
                      {loc.items.length > 0 && (
                        <p className="text-xs text-muted-foreground">{loc.items.length} item{loc.items.length !== 1 ? "s" : ""}</p>
                      )}
                    </div>
                    {isSelected && <ChevronRight className="w-3.5 h-3.5 text-primary shrink-0" />}
                  </button>
                );
              })}
            </nav>
          </div>

          {/* ── RIGHT — focus panel ──────────────────────────────── */}
          <div className="flex-1 glass-panel rounded-2xl overflow-hidden min-w-0">
            {selectedLocation ? (
              <FocusPanel location={selectedLocation} />
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                Select a location to view its stock
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
}
