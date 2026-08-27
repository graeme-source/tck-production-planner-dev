// Create Plan: 8-pack bags already owed on this date.
//
// These come from orders processed before this plan existed — a customer
// ordering bags for a delivery weeks out (see lib/queued-bags.ts on the
// server). The bags are already inside the batch maths on this screen, and
// they get added to the plan's items automatically the moment it's saved.
//
// This panel exists because that automation must never be SILENT. Graeme's
// worry about queueing bags ahead was "I'd have to rely on it working first
// time" (2026-08-27), and the answer to that isn't a promise, it's showing
// the work: what's owed, which order it's for, and — loudly — when a recipe
// carrying queued bags isn't on the plan about to be saved, which is the one
// way the bags could quietly fail to land.

import { CalendarClock, AlertTriangle, Plus } from "lucide-react";

export interface QueuedBag {
  id: number;
  productionDate: string;
  deliveryDate: string;
  recipeId: number;
  recipeName: string;
  bags: number;
  shopifyOrderId: string;
  shopifyOrderName: string | null;
}

function fmtNice(s: string): string {
  return new Date(`${s}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

export function QueuedBagsPanel({
  queuedBags,
  includedRecipeIds,
  onAddRecipes,
}: {
  queuedBags: QueuedBag[];
  includedRecipeIds: Set<number>;
  onAddRecipes: (recipeIds: number[]) => void;
}) {
  if (queuedBags.length === 0) return null;

  const missing = queuedBags.filter(b => !includedRecipeIds.has(b.recipeId));
  const missingRecipeIds = [...new Set(missing.map(b => b.recipeId))];
  const totalBags = queuedBags.reduce((s, b) => s + b.bags, 0);

  return (
    <div className={`mb-3 rounded-xl border px-3 py-2.5 text-sm ${
      missing.length
        ? "border-amber-400/60 bg-amber-500/10 text-amber-900 dark:text-amber-200"
        : "border-indigo-400/50 bg-indigo-500/10 text-indigo-900 dark:text-indigo-200"
    }`}>
      <div className="flex items-center gap-2 font-semibold">
        <CalendarClock className="w-4 h-4 flex-shrink-0" />
        {totalBags} 8-pack bag{totalBags === 1 ? "" : "s"} queued for this date
      </div>

      <ul className="mt-1.5 space-y-0.5">
        {queuedBags.map(b => (
          <li key={b.id} className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-bold tabular-nums">{b.bags}×</span>
            <span className="font-medium">{b.recipeName}</span>
            <span className="opacity-70 text-xs">
              {b.shopifyOrderName ?? `order ${b.shopifyOrderId}`} · delivers {fmtNice(b.deliveryDate)}
            </span>
            {!includedRecipeIds.has(b.recipeId) && (
              <span className="text-xs font-semibold">— not on this plan</span>
            )}
          </li>
        ))}
      </ul>

      {missing.length === 0 ? (
        <p className="mt-1.5 text-xs opacity-80">
          Counted in the batch numbers above. They'll be added to the plan's bag counts when you save it.
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span className="text-xs font-medium">
            {missingRecipeIds.length === 1 ? "This recipe isn't" : "These recipes aren't"} on the plan, so
            {" "}{missing.reduce((s, b) => s + b.bags, 0)} bag{missing.reduce((s, b) => s + b.bags, 0) === 1 ? "" : "s"}
            {" "}can't be added. The order stays queued until they are.
          </span>
          <button
            type="button"
            onClick={() => onAddRecipes(missingRecipeIds)}
            className="ml-auto inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-current/40 text-xs font-semibold hover:bg-black/5 dark:hover:bg-white/5"
          >
            <Plus className="w-3.5 h-3.5" /> Add to plan
          </button>
        </div>
      )}
    </div>
  );
}
