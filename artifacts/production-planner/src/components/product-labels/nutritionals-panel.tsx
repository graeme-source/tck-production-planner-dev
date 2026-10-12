/**
 * A recipe's nutrition: raw / cooked / portion weights, the per-100g and
 * per-portion table, and whether every ingredient (sub-recipes included)
 * has full data. Moved unchanged from the old Product Hub (12 Oct 2026) — it
 * now sits on the Nutrition tab of /labels/:id. Objective F.
 */
import { useState, useEffect } from "react";
import { Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { PanelRecipe } from "./deck-panel";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type NutritionalsData = {
  recipeName: string;
  totalRawWeightG: number;
  cookedWeightG: number;
  cookingLossPercent: number;
  portionWeightG: number;
  portionsPerBatch: number;
  per100g: Record<string, number | null>;
  perPortion: Record<string, number | null>;
  completeness: {
    isComplete: boolean;
    totalIngredients: number;
    missingNutritionals: string[];
    // Per-ingredient breakdown of exactly which nutrients are absent. Covers
    // every ingredient in the tree, including those nested inside sub-recipes.
    missingNutritionalDetail?: { ingredientId: number; name: string; missing: string[] }[];
    missingDeclarations: string[];
  };
};

const NUTRIENT_LABELS: Record<string, string> = {
  energyKj: "Energy (kJ)", energyKcal: "Energy (kcal)", fat: "Fat", saturates: "  of which saturates",
  carbohydrate: "Carbohydrate", sugars: "  of which sugars", protein: "Protein", fibre: "Fibre", salt: "Salt",
};

// How many per-100g values a fully-populated ingredient carries. Used to tell
// "this ingredient has no data at all" apart from "it's missing a couple".
const NUTRIENT_KEY_COUNT = Object.keys(NUTRIENT_LABELS).length;

export function NutritionalsPanel({ recipe }: { recipe: PanelRecipe }) {
  const [data, setData] = useState<NutritionalsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`${BASE}/api/recipes/${recipe.id}/nutritionals`, { credentials: "include" })
      .then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setData(d); })
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [recipe.id]);

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  if (error) return <p className="text-destructive text-sm py-4">{error}</p>;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3 text-sm">
        <div className="bg-secondary/30 rounded-lg p-3 text-center">
          <p className="text-xs text-muted-foreground">Raw Weight</p>
          <p className="font-bold">{data.totalRawWeightG}g</p>
        </div>
        <div className="bg-secondary/30 rounded-lg p-3 text-center">
          <p className="text-xs text-muted-foreground">Cooked Weight</p>
          <p className="font-bold">{data.cookedWeightG}g</p>
          <p className="text-[10px] text-muted-foreground">(-{data.cookingLossPercent}% loss)</p>
        </div>
        <div className="bg-secondary/30 rounded-lg p-3 text-center">
          <p className="text-xs text-muted-foreground">Portion Weight</p>
          <p className="font-bold">{data.portionWeightG}g</p>
          <p className="text-[10px] text-muted-foreground">({data.portionsPerBatch} portions)</p>
        </div>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left py-1.5 font-semibold">Nutrient</th>
            <th className="text-right py-1.5 font-semibold">Per 100g</th>
            <th className="text-right py-1.5 font-semibold">Per portion ({data.portionWeightG}g)</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(NUTRIENT_LABELS).map(([key, label]) => (
            <tr key={key} className="border-b border-border/50">
              <td className={`py-1.5 ${label.startsWith("  ") ? "pl-4 text-muted-foreground text-xs" : "font-medium"}`}>{label.trim()}</td>
              <td className="text-right py-1.5">{data.per100g[key] != null ? data.per100g[key] : "—"}{data.per100g[key] != null && (key.startsWith("energy") ? "" : "g")}</td>
              <td className="text-right py-1.5">{data.perPortion[key] != null ? data.perPortion[key] : "—"}{data.perPortion[key] != null && (key.startsWith("energy") ? "" : "g")}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {!data.completeness.isComplete ? (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 space-y-2">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200 flex items-center gap-1">
            <AlertTriangle className="w-4 h-4" /> Incomplete data — figures above are understated
          </p>
          <p className="text-xs text-amber-700 dark:text-amber-300">
            Checked all {data.completeness.totalIngredients} ingredients, including those nested inside sub-recipes.
            Any nutrient below counts as zero in the totals, so this panel is not safe to publish until every value is filled.
          </p>
          {data.completeness.missingNutritionalDetail && data.completeness.missingNutritionalDetail.length > 0 && (
            <div className="space-y-0.5">
              <p className="text-xs font-medium text-amber-800 dark:text-amber-200">Missing nutritionals:</p>
              {data.completeness.missingNutritionalDetail.map(m => (
                <p key={m.ingredientId} className="text-xs text-amber-700 dark:text-amber-300 pl-2">
                  <span className="font-medium">{m.name}</span>
                  {" — "}
                  {m.missing.length === NUTRIENT_KEY_COUNT
                    ? "no nutritional data at all"
                    : `missing ${m.missing.map(k => (NUTRIENT_LABELS[k] ?? k).trim().toLowerCase()).join(", ")}`}
                </p>
              ))}
            </div>
          )}
          {data.completeness.missingDeclarations.length > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              <span className="font-medium">Missing label declarations:</span> {data.completeness.missingDeclarations.join(", ")}
            </p>
          )}
        </div>
      ) : (
        <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg p-3">
          <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200 flex items-center gap-1">
            <CheckCircle2 className="w-4 h-4" /> Complete — all {data.completeness.totalIngredients} ingredients have full nutritional data
          </p>
          <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-0.5">
            Includes every ingredient nested inside sub-recipes. Safe to publish.
          </p>
        </div>
      )}
    </div>
  );
}
