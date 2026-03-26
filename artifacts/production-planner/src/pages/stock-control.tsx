import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Thermometer, Snowflake, Package, RefreshCw, ChevronRight } from "lucide-react";

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
  if (zone === "freezer") return { badge: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300", icon: "text-blue-500", bg: "bg-blue-500/10" };
  if (zone === "fridge") return { badge: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300", icon: "text-cyan-500", bg: "bg-cyan-500/10" };
  return { badge: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300", icon: "text-amber-500", bg: "bg-amber-500/10" };
}

function LocationCard({ location }: { location: StockLocation }) {
  const colors = zoneColors(location.zone);
  const totalQty = location.items.reduce((s, i) => s + i.qty, 0);
  const maxQty = location.items[0]?.qty ?? 1;

  return (
    <div className="glass-panel rounded-2xl overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
        <div className={`p-2.5 rounded-xl ${colors.bg}`}>
          <ZoneIcon zone={location.zone} className={`w-5 h-5 ${colors.icon}`} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-display font-bold text-base leading-tight">{location.label}</h3>
          <p className="text-xs text-muted-foreground mt-0.5 capitalize">{location.zone}</p>
        </div>
        <div className="text-right shrink-0">
          <span className="text-2xl font-display font-bold tabular-nums">
            {Math.round(totalQty).toLocaleString()}
          </span>
          <p className="text-xs text-muted-foreground">
            {location.items.length === 1 ? "1 item" : `${location.items.length} items`}
          </p>
        </div>
      </div>

      {location.items.length === 0 ? (
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <p className="text-sm">No stock recorded</p>
        </div>
      ) : (
        <div className="divide-y divide-border/50">
          {location.items.map((item) => {
            const barWidth = Math.max(4, (item.qty / maxQty) * 100);
            return (
              <div key={`${item.type}-${item.id}`} className="px-5 py-3 hover:bg-secondary/30 transition-colors">
                <div className="flex items-center justify-between mb-1.5">
                  <span
                    className="text-sm font-medium truncate pr-3"
                    style={item.color ? { color: item.color } : undefined}
                  >
                    {item.name}
                  </span>
                  <span className="text-sm font-bold tabular-nums shrink-0">
                    {Math.round(item.qty).toLocaleString()}
                    <span className="text-xs font-normal text-muted-foreground ml-1">{item.unit}</span>
                  </span>
                </div>
                <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
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
  );
}

export default function StockControl() {
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["stock-control"],
    queryFn: fetchStockControl,
    staleTime: 2 * 60 * 1000,
  });

  const activeLocations = data?.locations.filter(l => l.items.length > 0) ?? [];
  const emptyLocations = data?.locations.filter(l => l.items.length === 0) ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stock Control"
        description="Current stock levels across all storage locations"
        action={
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-2 hover:bg-secondary transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
        }
      />

      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <RefreshCw className="w-6 h-6 animate-spin mr-2" />
          <span className="text-sm">Loading stock levels…</span>
        </div>
      ) : error ? (
        <div className="glass-panel rounded-2xl p-8 text-center text-destructive text-sm">
          Failed to load stock data. Please refresh and try again.
        </div>
      ) : (
        <>
          {/* Summary bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {data?.locations.map((loc) => {
              const colors = zoneColors(loc.zone);
              const qty = Math.round(loc.items.reduce((s, i) => s + i.qty, 0));
              return (
                <div key={loc.key} className="glass-panel rounded-xl p-4 flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${colors.bg}`}>
                    <ZoneIcon zone={loc.zone} className={`w-4 h-4 ${colors.icon}`} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground truncate">{loc.label}</p>
                    <p className="text-xl font-display font-bold tabular-nums">{qty.toLocaleString()}</p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Active locations */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {activeLocations.map((loc) => (
              <LocationCard key={loc.key} location={loc} />
            ))}
          </div>

          {/* Empty locations */}
          {emptyLocations.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Other Locations (No Stock Recorded)
              </h4>
              <div className="flex flex-wrap gap-2">
                {emptyLocations.map((loc) => {
                  const colors = zoneColors(loc.zone);
                  return (
                    <div key={loc.key} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border ${colors.badge} border-transparent`}>
                      <ZoneIcon zone={loc.zone} className="w-3 h-3" />
                      {loc.label}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
