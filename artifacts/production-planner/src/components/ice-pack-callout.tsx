import { Snowflake, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIcePacks, type IcePacksToday } from "@/hooks/use-ice-packs";

function tempLine(data: IcePacksToday): string {
  if (data.forecastSource === "fallback") return data.message ?? "Weather unavailable";
  const loc = data.location?.name ?? "London";
  const stale = data.forecastSource === "cached" ? " · forecast may be stale" : "";
  return `Forecast high ${data.highTemp}°C (${loc}, today/tomorrow)${stale}`;
}

/**
 * Prominent ice-pack instruction for the packing station — the first thing the
 * team should see when they open packing.
 */
export function IcePackBanner() {
  const { data, isLoading } = useIcePacks();
  if (isLoading || !data || data.enabled === false) return null;

  const isFallback = data.forecastSource === "fallback";

  return (
    <div
      className={cn(
        "rounded-xl border p-4",
        isFallback
          ? "bg-amber-50 dark:bg-amber-950/20 border-amber-300 dark:border-amber-700"
          : "bg-cyan-50 dark:bg-cyan-950/20 border-cyan-300 dark:border-cyan-700",
      )}
    >
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "flex-shrink-0 w-11 h-11 rounded-xl flex items-center justify-center",
            isFallback ? "bg-amber-100 dark:bg-amber-900/40" : "bg-cyan-100 dark:bg-cyan-900/40",
          )}
        >
          {isFallback ? (
            <AlertTriangle className="w-6 h-6 text-amber-600 dark:text-amber-400" />
          ) : (
            <Snowflake className="w-6 h-6 text-cyan-600 dark:text-cyan-400" />
          )}
        </div>
        <div className="min-w-0">
          <div className="flex items-baseline gap-4 flex-wrap">
            <h3 className="font-semibold text-lg">Today's ice packs</h3>
            <div className="flex items-baseline gap-3 font-display">
              <span className="text-2xl font-bold tabular-nums">
                {data.smallBoxPacks}
                <span className="text-sm font-normal text-muted-foreground ml-1">small box</span>
              </span>
              <span className="text-2xl font-bold tabular-nums">
                {data.largeBoxPacks}
                <span className="text-sm font-normal text-muted-foreground ml-1">large box</span>
              </span>
            </div>
          </div>
          <p
            className={cn(
              "text-sm mt-0.5",
              isFallback ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground",
            )}
          >
            {tempLine(data)}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Compact one-line ice-pack readout for the scanning app — small, glanceable,
 * sits in a header without taking real estate from the scan workflow.
 */
export function IcePackBadge({ className }: { className?: string }) {
  const { data, isLoading } = useIcePacks();
  if (isLoading || !data || data.enabled === false) return null;

  const isFallback = data.forecastSource === "fallback";

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-lg border px-2.5 py-1 text-sm",
        isFallback
          ? "bg-amber-50 dark:bg-amber-950/20 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300"
          : "bg-cyan-50 dark:bg-cyan-950/20 border-cyan-300 dark:border-cyan-700 text-cyan-800 dark:text-cyan-300",
        className,
      )}
      title={tempLine(data)}
    >
      {isFallback ? (
        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
      ) : (
        <Snowflake className="w-4 h-4 flex-shrink-0" />
      )}
      <span className="font-medium whitespace-nowrap">
        Ice packs: <span className="tabular-nums font-bold">{data.smallBoxPacks}</span> small
        {" · "}
        <span className="tabular-nums font-bold">{data.largeBoxPacks}</span> large
      </span>
    </div>
  );
}
