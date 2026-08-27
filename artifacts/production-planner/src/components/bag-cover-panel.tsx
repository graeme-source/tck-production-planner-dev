// Create Plan: can we actually cover the 8-pack bags going out on the next
// three vans?
//
// Asked for by Graeme on 2026-08-27. The trap this is here to catch: bags
// planned for a day AFTER the despatch would have to leave look like cover in
// any naive total, and aren't. Delivery takes a calendar day after despatch,
// so an order delivering Thursday leaves on Wednesday and Thursday's batches
// are too late for it.
//
// The whole reason for showing the workings — where each covered bag comes
// from — is that a check you can't audit is a check you end up ignoring.
// Server side: routes/bag-cover.ts and lib/bag-cover.ts.

import { useQuery } from "@tanstack/react-query";
import { PackageCheck, AlertTriangle, CalendarClock, HelpCircle } from "lucide-react";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

interface CoverSource { date: string; bags: number; queued: boolean; label: string }
interface CoverLine {
  dispatchDate: string;
  deliveryDate: string;
  recipeId: number;
  recipeName: string;
  needed: number;
  covered: number;
  shortfall: number;
  atRisk: number;
  earlierProduction: number;
  sources: CoverSource[];
}
interface CoverPayload {
  today: string;
  dispatchDates: string[];
  lines: CoverLine[];
  shortfalls: CoverLine[];
  atRiskLines: CoverLine[];
  ok: boolean;
  strandedQueued: Array<{ productionDate: string; recipeId: number; recipeName: string; bags: number; orderName: string | null }>;
  unmappedProducts: string[];
}

function fmtNice(s: string): string {
  return new Date(`${s}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

function sourceText(sources: CoverSource[], today: string): string {
  if (sources.length === 0) return "nothing available";
  return sources
    .map(s => `${s.bags} ${s.date === today ? "in the fridge / on today's plan" : `from the ${fmtNice(s.date)} plan`}${s.queued ? " (queued — plan not made)" : ""}`)
    .join(", ");
}

export function BagCoverPanel({ dispatches = 3 }: { dispatches?: number }) {
  const { data, isLoading, isError } = useQuery<CoverPayload>({
    queryKey: ["bag-cover", dispatches],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/bag-cover?dispatches=${dispatches}`, { credentials: "include" });
      if (!res.ok) throw new Error("Could not check bag cover");
      return res.json();
    },
    staleTime: 60_000,
  });

  if (isLoading) return null;
  // A check that failed to run must say so — silence would read as "all clear".
  if (isError || !data) {
    return (
      <div className="mb-3 rounded-xl border border-border px-3 py-2 text-sm text-muted-foreground flex items-center gap-2">
        <HelpCircle className="w-4 h-4 flex-shrink-0" />
        Couldn't check 8-pack bag cover for the next despatches — check the bag numbers by hand.
      </div>
    );
  }
  // Nothing to say when no bags are going out at all.
  if (data.lines.length === 0 && data.strandedQueued.length === 0 && data.unmappedProducts.length === 0) return null;

  const problem = data.shortfalls.length > 0 || data.strandedQueued.length > 0 || data.unmappedProducts.length > 0;

  return (
    <div className={`mb-3 rounded-xl border px-3 py-2.5 text-sm ${
      problem
        ? "border-red-400/60 bg-red-500/10 text-red-900 dark:text-red-200"
        : "border-emerald-400/50 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200"
    }`}>
      <div className="flex items-center gap-2 font-semibold">
        {problem ? <AlertTriangle className="w-4 h-4 flex-shrink-0" /> : <PackageCheck className="w-4 h-4 flex-shrink-0" />}
        8-pack bags for the next {data.dispatchDates.length} despatch{data.dispatchDates.length === 1 ? "" : "es"}
        {!problem && " — covered"}
      </div>

      {data.shortfalls.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {data.shortfalls.map(l => (
            <li key={`${l.dispatchDate}-${l.recipeId}`}>
              <span className="font-semibold">
                {fmtNice(l.dispatchDate)} despatch (delivers {fmtNice(l.deliveryDate)}): short {l.shortfall} × {l.recipeName}
              </span>
              <div className="text-xs opacity-90">
                {l.needed} needed, {l.covered} covered — {sourceText(l.sources, data.today)}.
                {" "}Production after {fmtNice(l.dispatchDate)} is too late for this order.
                {l.earlierProduction > 0 && (
                  <> {l.earlierProduction} bag{l.earlierProduction === 1 ? " was" : "s were"} made before today —
                    check the fridge, the system can't tell whether they've already gone out.</>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {data.strandedQueued.length > 0 && (
        <div className="mt-1.5 text-xs">
          <span className="font-semibold">
            {data.strandedQueued.reduce((s, q) => s + q.bags, 0)} queued bag(s) can't land:
          </span>{" "}
          {data.strandedQueued.map(q => `${q.bags} × ${q.recipeName} on the ${fmtNice(q.productionDate)} plan${q.orderName ? ` (${q.orderName})` : ""}`).join("; ")}
          {" "}— that plan exists but doesn't include the recipe. Add it to that plan, or the order goes out short.
        </div>
      )}

      {data.unmappedProducts.length > 0 && (
        <div className="mt-1.5 text-xs">
          <span className="font-semibold">Not counted:</span> {data.unmappedProducts.join(", ")} — these 8-pack lines
          don't map to a recipe, so their bags are invisible to this check.
        </div>
      )}

      {data.shortfalls.length === 0 && data.atRiskLines.length > 0 && (
        <div className="mt-1.5 flex items-start gap-1.5 text-xs">
          <CalendarClock className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>
            {data.atRiskLines.reduce((s, l) => s + l.atRisk, 0)} bag(s) are covered by orders queued against a plan that
            hasn't been made yet ({[...new Set(data.atRiskLines.flatMap(l => l.sources.filter(s => s.queued).map(s => fmtNice(s.date))))].join(", ")}).
            They'll land automatically when it is.
          </span>
        </div>
      )}

      {!problem && data.lines.length > 0 && (
        <ul className="mt-1 text-xs opacity-90 space-y-0.5">
          {data.lines.map(l => (
            <li key={`${l.dispatchDate}-${l.recipeId}`}>
              {fmtNice(l.dispatchDate)}: {l.needed} × {l.recipeName} — {sourceText(l.sources, data.today)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
