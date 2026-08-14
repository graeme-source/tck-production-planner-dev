import { useState, useEffect, useRef } from "react";
import { useListRecipes } from "@workspace/api-client-react";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import {
  Loader2, ClipboardList, Beaker, AlertTriangle, Copy, Check, Tag, Settings2, Printer, Calculator,
  CheckCircle2, UploadCloud, Sparkles, HeartPulse,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BundleCalculator } from "@/components/bundle-calculator";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type TabType = "decks" | "nutritionals" | "labels" | "bundles" | "health";

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

type DeckData = {
  recipeName: string;
  deckText: string;
  allergens: string[];
  mayContainStatement: string | null;
  isComplete: boolean;
  missingDeclarations: string[];
  // Compound ingredients whose declaration lists components without naming the
  // ingredient itself — e.g. "Pork, Salt" instead of "Chorizo (Pork, Salt)".
  unwrappedDeclarations?: string[];
  ingredients: {
    type?: "ingredient" | "compound";
    name: string;
    declaration: string;
    percentage: number;
    allergens: string[];
    isQuid?: boolean;
    subIngredients?: { name: string; declaration: string; percentage: number; allergens: string[] }[];
  }[];
};

type RecipeItem = { id: number; name: string };

const NUTRIENT_LABELS: Record<string, string> = {
  energyKj: "Energy (kJ)", energyKcal: "Energy (kcal)", fat: "Fat", saturates: "  of which saturates",
  carbohydrate: "Carbohydrate", sugars: "  of which sugars", protein: "Protein", fibre: "Fibre", salt: "Salt",
};

const NUTRIENT_UNITS: Record<string, string> = {
  energyKj: "kJ", energyKcal: "kcal",
};

// How many per-100g values a fully-populated ingredient carries. Used to tell
// "this ingredient has no data at all" apart from "it's missing a couple".
const NUTRIENT_KEY_COUNT = Object.keys(NUTRIENT_LABELS).length;

function NutritionalsPanel({ recipe }: { recipe: RecipeItem }) {
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

function DeckPanel({ recipe }: { recipe: RecipeItem }) {
  const [data, setData] = useState<DeckData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<null | "plain" | "label">(null);
  // Shopify push: dry-run first so the founder sees exactly which website
  // products will be overwritten, then a confirm click does the real write.
  const [pushState, setPushState] = useState<
    | { phase: "idle" }
    | { phase: "checking" }
    | { phase: "confirm"; products: string[] }
    | { phase: "pushing"; products: string[] }
    | { phase: "done"; products: string[] }
    | { phase: "error"; message: string }
  >({ phase: "idle" });

  async function pushToShopify(confirm: boolean) {
    setPushState(confirm ? { phase: "pushing", products: pushState.phase === "confirm" ? pushState.products : [] } : { phase: "checking" });
    try {
      const res = await fetch(`${BASE}/api/recipes/${recipe.id}/push-ingredient-deck${confirm ? "" : "?dryRun=1"}`, {
        method: "POST",
        credentials: "include",
      });
      const body = await res.json();
      if (!res.ok) {
        const detail = [body.error, ...(body.missingDeclarations ?? []), ...(body.unwrappedDeclarations ?? [])]
          .filter(Boolean).join(" — ");
        throw new Error(detail || `HTTP ${res.status}`);
      }
      if (body.dryRun) setPushState({ phase: "confirm", products: body.wouldPush });
      else setPushState({ phase: "done", products: body.pushed });
    } catch (e) {
      setPushState({ phase: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`${BASE}/api/recipes/${recipe.id}/ingredient-deck`, { credentials: "include" })
      .then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setData(d); })
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [recipe.id]);

  const copyDeck = () => {
    if (!data) return;
    const plain = data.deckText.replace(/\*\*/g, "");
    navigator.clipboard.writeText(plain);
    setCopied("plain");
    setTimeout(() => setCopied(null), 2000);
  };

  // Label Live (the back-label printing software) renders <b> tags, so this
  // variant keeps the allergen emphasis: the server marks every allergen as
  // **X** in deckText, which goes onto the clipboard as <b>X</b>.
  const copyForLabelLive = () => {
    if (!data) return;
    const tagged = data.deckText.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
    navigator.clipboard.writeText(tagged);
    setCopied("label");
    setTimeout(() => setCopied(null), 2000);
  };

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  if (error) return <p className="text-destructive text-sm py-4">{error}</p>;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <div className="bg-secondary/20 rounded-lg p-4 border border-border">
        <p className="text-sm leading-relaxed" dangerouslySetInnerHTML={{
          __html: data.deckText
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
            .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        }} />
        <div className="mt-2 flex items-center gap-4">
          <button onClick={copyDeck} className="text-xs text-primary hover:underline flex items-center gap-1">
            {copied === "plain" ? <><Check className="w-3 h-3" /> Copied!</> : <><Copy className="w-3 h-3" /> Copy to clipboard</>}
          </button>
          <button onClick={copyForLabelLive} className="text-xs text-primary hover:underline flex items-center gap-1" title="Copies the deck with <b> tags around allergens, ready to paste into Label Live">
            {copied === "label" ? <><Check className="w-3 h-3" /> Copied!</> : <><Copy className="w-3 h-3" /> Copy for Label Live</>}
          </button>
        </div>
      </div>

      {/* ── Push to the Shopify website (custom.ingredient_deck) ─────────── */}
      <div className="bg-secondary/20 rounded-lg p-4 border border-border space-y-2">
        <p className="text-sm font-medium flex items-center gap-1.5">
          <UploadCloud className="w-4 h-4 text-primary" /> Website ingredient deck
        </p>
        <p className="text-xs text-muted-foreground">
          Publishes this deck — with the allergen statement and legal disclaimer — to the
          ingredient-deck field on every Shopify product linked to this recipe.
        </p>
        {pushState.phase === "confirm" ? (
          <div className="space-y-2">
            <p className="text-sm">
              This will overwrite the website deck on:{" "}
              <b>{pushState.products.join(", ")}</b>
            </p>
            <div className="flex gap-2">
              <button onClick={() => pushToShopify(true)}
                className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90">
                Confirm — publish to website
              </button>
              <button onClick={() => setPushState({ phase: "idle" })}
                className="px-3 py-1.5 rounded-lg border border-border text-xs hover:bg-secondary/50">
                Cancel
              </button>
            </div>
          </div>
        ) : pushState.phase === "done" ? (
          <p className="text-sm text-primary flex items-center gap-1.5">
            <Check className="w-4 h-4" /> Published to {pushState.products.join(", ")}.
          </p>
        ) : (
          <div className="space-y-1.5">
            <button
              onClick={() => pushToShopify(false)}
              disabled={pushState.phase === "checking" || pushState.phase === "pushing" || !data.isComplete}
              title={!data.isComplete ? "Fix the flagged declarations below before publishing." : undefined}
              className="px-3 py-1.5 rounded-lg border border-border text-xs font-medium hover:bg-secondary/50 disabled:opacity-50 flex items-center gap-1.5"
            >
              {pushState.phase === "checking" || pushState.phase === "pushing"
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <UploadCloud className="w-3.5 h-3.5" />}
              {pushState.phase === "checking" ? "Checking…" : pushState.phase === "pushing" ? "Publishing…" : "Push to Shopify…"}
            </button>
            {pushState.phase === "error" && (
              <p className="text-xs text-destructive">{pushState.message}</p>
            )}
          </div>
        )}
      </div>

      {data.missingDeclarations && data.missingDeclarations.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200 flex items-center gap-1">
            <AlertTriangle className="w-4 h-4" /> Missing label declarations
          </p>
          <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">{data.missingDeclarations.join(", ")}</p>
        </div>
      )}

      {data.unwrappedDeclarations && data.unwrappedDeclarations.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200 flex items-center gap-1">
            <AlertTriangle className="w-4 h-4" /> Compound ingredients not named
          </p>
          <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
            {data.unwrappedDeclarations.join(", ")} — {data.unwrappedDeclarations.length === 1 ? "this declaration lists" : "these declarations list"}
            {" "}components without naming the ingredient they belong to, so they run together in the deck above.
            Edit to the form <span className="font-mono">Chorizo (Pork, Salt, Paprika…)</span>.
          </p>
        </div>
      )}

      {data.allergens.length > 0 && (
        <div>
          <p className="text-sm font-semibold mb-1">Allergens Present</p>
          <div className="flex flex-wrap gap-1.5">
            {data.allergens.map(a => (
              <span key={a} className="px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">{a}</span>
            ))}
          </div>
        </div>
      )}

      {data.mayContainStatement && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
          <p className="text-xs font-medium text-amber-800 dark:text-amber-200">{data.mayContainStatement}</p>
        </div>
      )}

      <div>
        <p className="text-sm font-semibold mb-1">Breakdown by Weight</p>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-1">Ingredient</th>
              <th className="text-right py-1">%</th>
              <th className="text-right py-1">Allergens</th>
            </tr>
          </thead>
          <tbody>
            {data.ingredients.flatMap((ing, idx) => {
              const rows = [
                <tr key={`ing-${idx}`} className={cn("border-b border-border/30", ing.type === "compound" && "bg-primary/5")}>
                  <td className={cn("py-1", ing.type === "compound" && "font-semibold")}>{ing.name}{ing.type === "compound" ? " (compound)" : ""}</td>
                  <td className="text-right py-1 font-medium">{ing.percentage}%</td>
                  <td className="text-right py-1 text-xs">{ing.allergens.length > 0 ? ing.allergens.join(", ") : "—"}</td>
                </tr>
              ];
              ing.subIngredients?.forEach((sub, si) => {
                rows.push(
                  <tr key={`ing-${idx}-sub-${si}`} className="border-b border-border/20">
                    <td className="py-0.5 pl-6 text-xs text-muted-foreground">{sub.name}</td>
                    <td className="text-right py-0.5 text-xs text-muted-foreground">{sub.percentage}%</td>
                    <td className="text-right py-0.5 text-xs text-muted-foreground">{sub.allergens.length > 0 ? sub.allergens.join(", ") : ""}</td>
                  </tr>
                );
              });
              return rows;
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MayContainEditor() {
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch(`${BASE}/api/app-settings/may_contain_statement`, { credentials: "include" })
      .then(r => r.json())
      .then(d => { setValue(d.value ?? ""); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await fetch(`${BASE}/api/app-settings/may_contain_statement`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ value }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      void e;
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Settings2 className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Global "May Contain" Statement</h3>
      </div>
      <p className="text-xs text-muted-foreground">This statement appears on all ingredient decks. It is typically required for allergen cross-contamination disclosures.</p>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={2}
        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
        placeholder="e.g. May also contain traces of nuts, peanuts, egg, soya..."
      />
      <div className="flex items-center gap-2">
        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {saving ? "Saving..." : saved ? "Saved!" : "Save"}
        </button>
        {saved && <span className="text-xs text-green-600 flex items-center gap-1"><Check className="w-3 h-3" /> Updated</span>}
      </div>
    </div>
  );
}

function LabelPreviewPanel({ recipe }: { recipe: RecipeItem }) {
  const [deckData, setDeckData] = useState<DeckData | null>(null);
  const [nutritionalsData, setNutritionalsData] = useState<NutritionalsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const labelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      fetch(`${BASE}/api/recipes/${recipe.id}/ingredient-deck`, { credentials: "include" }).then(r => r.json()),
      fetch(`${BASE}/api/recipes/${recipe.id}/nutritionals`, { credentials: "include" }).then(r => r.json()),
    ])
      .then(([deck, nutr]) => {
        if (deck.error) throw new Error(deck.error);
        if (nutr.error) throw new Error(nutr.error);
        setDeckData(deck);
        setNutritionalsData(nutr);
      })
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [recipe.id]);

  const copyAll = () => {
    if (!labelRef.current) return;
    const text = labelRef.current.innerText;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const printLabel = () => {
    if (!labelRef.current) return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    const safeName = recipe.name.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    printWindow.document.write(`
      <html><head><title>${safeName} - Label</title>
      <style>
        body { font-family: Arial, Helvetica, sans-serif; max-width: 400px; margin: 20px auto; font-size: 11px; }
        h2 { font-size: 16px; margin: 0 0 8px 0; }
        h3 { font-size: 12px; margin: 12px 0 4px 0; text-transform: uppercase; border-bottom: 2px solid #000; padding-bottom: 2px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 2px 4px; border-bottom: 1px solid #ccc; font-size: 11px; }
        th { text-align: left; font-weight: bold; border-bottom: 2px solid #000; }
        td:last-child, th:last-child { text-align: right; }
        .sub-row td { padding-left: 16px; font-size: 10px; }
        .allergen-statement { margin-top: 8px; font-weight: bold; }
        .may-contain { margin-top: 4px; font-style: italic; }
        @media print { body { margin: 0; } }
      </style></head><body>${labelRef.current.innerHTML}</body></html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  if (error) return <p className="text-destructive text-sm py-4">{error}</p>;
  if (!deckData || !nutritionalsData) return null;

  const deckHtml = deckData.deckText
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <button onClick={copyAll} className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary rounded-lg text-xs font-medium transition-colors">
          {copied ? <><Check className="w-3.5 h-3.5" /> Copied!</> : <><Copy className="w-3.5 h-3.5" /> Copy All Text</>}
        </button>
        <button onClick={printLabel} className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary rounded-lg text-xs font-medium transition-colors">
          <Printer className="w-3.5 h-3.5" /> Print Label
        </button>
      </div>

      <div ref={labelRef} className="bg-white text-black rounded-xl border-2 border-black p-5 space-y-3 font-[Arial,Helvetica,sans-serif]">
        <h2 className="text-base font-bold border-b border-black pb-1">{recipe.name}</h2>

        <div>
          <h3 className="text-[11px] font-bold uppercase tracking-wide border-b-2 border-black pb-0.5 mb-1">Ingredients</h3>
          <p className="text-[11px] leading-relaxed" dangerouslySetInnerHTML={{ __html: deckHtml }} />
        </div>

        {deckData.allergens.length > 0 && (
          <p className="text-[11px] font-bold">
            Allergens: Contains {deckData.allergens.join(", ")}.
          </p>
        )}

        {deckData.mayContainStatement && (
          <p className="text-[10px] italic">{deckData.mayContainStatement}</p>
        )}

        <div>
          <h3 className="text-[11px] font-bold uppercase tracking-wide border-b-2 border-black pb-0.5 mb-1">Nutrition Information</h3>
          <table className="w-full text-[11px] border-collapse">
            <thead>
              <tr className="border-b-2 border-black">
                <th className="text-left py-0.5 font-bold">Typical Values</th>
                <th className="text-right py-0.5 font-bold">Per 100g</th>
                <th className="text-right py-0.5 font-bold">Per portion ({nutritionalsData.portionWeightG}g)</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(NUTRIENT_LABELS).map(([key, label]) => {
                const unit = NUTRIENT_UNITS[key] || "g";
                const val100 = nutritionalsData.per100g[key];
                const valPortion = nutritionalsData.perPortion[key];
                return (
                  <tr key={key} className="border-b border-gray-300">
                    <td className={cn("py-0.5", label.startsWith("  ") ? "pl-3 text-[10px]" : "font-medium")}>{label.trim()}</td>
                    <td className="text-right py-0.5">{val100 != null ? `${val100}${unit}` : "—"}</td>
                    <td className="text-right py-0.5">{valPortion != null ? `${valPortion}${unit}` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {nutritionalsData.portionWeightG > 0 && (
          <p className="text-[10px] text-gray-600">Net weight: {nutritionalsData.portionWeightG}g (e)</p>
        )}
      </div>

      {(!deckData.isComplete || !nutritionalsData.completeness.isComplete) && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 space-y-1">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200 flex items-center gap-1"><AlertTriangle className="w-4 h-4" /> Incomplete Data</p>
          {deckData.missingDeclarations && deckData.missingDeclarations.length > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-300">Missing label declarations: {deckData.missingDeclarations.join(", ")}</p>
          )}
          {nutritionalsData.completeness.missingNutritionals.length > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-300">Missing nutritionals: {nutritionalsData.completeness.missingNutritionals.join(", ")}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Data Health: backdating review queue ─────────────────────────────
// Lists every recipe-used ingredient missing a label declaration or any
// nutritional value. AI estimates (existing /ai-nutrition endpoint) are
// fetched per row and NEVER auto-applied — each needs explicit approval.
// Label declarations are typed/confirmed by hand: no AI-generated
// declarations for compound/branded items (HACCP rule).

type HealthRow = {
  id: number; name: string; brand: string | null; category: string | null;
  missingLabel: boolean; missingNutrition: string[]; emptyAllergens: boolean;
  aiEstimated: boolean; usedBy: string[];
};

type HealthEstimate = {
  energyKj: number | null; energyKcal: number | null; fat: number | null;
  saturates: number | null; carbohydrate: number | null; sugars: number | null;
  protein: number | null; fibre: number | null; salt: number | null;
  allergens: string[]; confidence: "high" | "medium" | "low"; notes: string | null;
};

const ESTIMATE_NUTRIENT_KEYS = ["energyKj", "energyKcal", "fat", "saturates", "carbohydrate", "sugars", "protein", "fibre", "salt"] as const;

function DataHealthPanel() {
  const [rows, setRows] = useState<HealthRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [estimates, setEstimates] = useState<Record<number, HealthEstimate | "loading" | { error: string }>>({});
  const [labelDrafts, setLabelDrafts] = useState<Record<number, string>>({});
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);

  const load = async () => {
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/ingredients/data-health`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      const body = await res.json();
      setRows(body.ingredients as HealthRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRows([]);
    }
  };
  useEffect(() => { void load(); }, []);

  const fetchEstimate = async (row: HealthRow): Promise<void> => {
    setEstimates(prev => ({ ...prev, [row.id]: "loading" }));
    try {
      const res = await fetch(`${BASE}/api/ingredients/ai-nutrition`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: row.name, brand: row.brand ?? "", category: row.category ?? "" }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Estimate failed (${res.status})`);
      setEstimates(prev => ({ ...prev, [row.id]: body.estimate as HealthEstimate }));
    } catch (e) {
      setEstimates(prev => ({ ...prev, [row.id]: { error: e instanceof Error ? e.message : String(e) } }));
    }
  };

  const estimateAll = async () => {
    if (!rows) return;
    const targets = rows.filter(r => r.missingNutrition.length > 0 && typeof estimates[r.id] !== "object");
    setBatchRunning(true);
    setBatchProgress({ done: 0, total: targets.length });
    for (let i = 0; i < targets.length; i++) {
      // Sequential on purpose — one Claude call at a time.
      // eslint-disable-next-line no-await-in-loop
      await fetchEstimate(targets[i]);
      setBatchProgress({ done: i + 1, total: targets.length });
    }
    setBatchRunning(false);
  };

  // Round-trips the full current record because PUT /:id writes core
  // fields unconditionally — a partial body would blank them.
  const saveIngredient = async (row: HealthRow, changes: Record<string, unknown>) => {
    setBusyIds(prev => new Set(prev).add(row.id));
    try {
      const curRes = await fetch(`${BASE}/api/ingredients/${row.id}`, { credentials: "include" });
      if (!curRes.ok) throw new Error("Could not load current ingredient");
      const current = await curRes.json();
      const res = await fetch(`${BASE}/api/ingredients/${row.id}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...current, ...changes }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Save failed (${res.status})`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyIds(prev => { const next = new Set(prev); next.delete(row.id); return next; });
    }
  };

  const applyEstimate = async (row: HealthRow, est: HealthEstimate) => {
    const curRes = await fetch(`${BASE}/api/ingredients/${row.id}`, { credentials: "include" });
    if (!curRes.ok) { setError("Could not load current ingredient"); return; }
    const current = await curRes.json();
    const changes: Record<string, unknown> = {};
    // Fill-only-empty: an existing value always wins over the estimate.
    for (const key of ESTIMATE_NUTRIENT_KEYS) {
      if (current[key] == null && est[key] != null) changes[key] = est[key];
    }
    const currentAllergens: string[] = current.allergens ?? [];
    const merged = [...new Set([...currentAllergens, ...est.allergens])];
    if (merged.length !== currentAllergens.length) changes["allergens"] = merged;
    if (Object.keys(changes).length === 0) return;
    changes["nutritionalsAiEstimated"] = true;
    await saveIngredient(row, changes);
    setEstimates(prev => { const next = { ...prev }; delete next[row.id]; return next; });
  };

  const confidenceStyle: Record<HealthEstimate["confidence"], string> = {
    high: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200",
    medium: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
    low: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  };

  if (rows === null) return <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className="text-sm font-semibold">{rows.length === 0 ? "All recipe ingredients have label declarations and nutritionals." : `${rows.length} recipe ingredient${rows.length === 1 ? "" : "s"} with missing data`}</p>
          <p className="text-xs text-muted-foreground">AI estimates need your approval before saving. Label declarations for branded/compound items must come from the pack — never estimated.</p>
        </div>
        {rows.some(r => r.missingNutrition.length > 0) && (
          <button
            onClick={() => void estimateAll()}
            disabled={batchRunning}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-60"
          >
            {batchRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {batchRunning && batchProgress ? `Estimating ${batchProgress.done}/${batchProgress.total}…` : "AI-estimate all missing nutritionals"}
          </button>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="space-y-3">
        {rows.map(row => {
          const est = estimates[row.id];
          const busy = busyIds.has(row.id);
          return (
            <div key={row.id} className="bg-card border border-border rounded-xl p-4 space-y-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{row.name}{row.brand ? <span className="text-muted-foreground font-normal"> — {row.brand}</span> : null}</p>
                  <p className="text-xs text-muted-foreground truncate">Used by: {row.usedBy.join(", ")}</p>
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  {row.missingLabel && <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200 font-medium">No label declaration</span>}
                  {row.missingNutrition.length > 0 && <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200 font-medium">{row.missingNutrition.length === 9 ? "No nutritionals" : `${row.missingNutrition.length} nutrient value${row.missingNutrition.length === 1 ? "" : "s"} missing`}</span>}
                  {row.emptyAllergens && <span className="text-[11px] px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground font-medium">No allergens tagged</span>}
                </div>
              </div>

              {row.missingLabel && (
                <div className="flex gap-2 items-center flex-wrap">
                  <input
                    value={labelDrafts[row.id] ?? ""}
                    onChange={e => setLabelDrafts(prev => ({ ...prev, [row.id]: e.target.value }))}
                    placeholder="Type the label declaration from the pack…"
                    className="flex-1 min-w-[220px] px-3 py-1.5 bg-background border border-border rounded-lg text-sm"
                  />
                  <button
                    onClick={() => setLabelDrafts(prev => ({ ...prev, [row.id]: row.name }))}
                    className="text-xs px-2 py-1.5 rounded-lg border border-border hover:bg-secondary"
                    title="For single-ingredient foods the declaration is just the name"
                  >
                    Use name
                  </button>
                  <button
                    onClick={() => void saveIngredient(row, { labelDeclaration: labelDrafts[row.id]?.trim() || null })}
                    disabled={busy || !labelDrafts[row.id]?.trim()}
                    className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-primary text-primary-foreground font-medium disabled:opacity-50"
                  >
                    {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Save declaration
                  </button>
                </div>
              )}

              {row.missingNutrition.length > 0 && (
                <div>
                  {est === undefined && (
                    <button
                      onClick={() => void fetchEstimate(row)}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-secondary font-medium"
                    >
                      <Sparkles className="w-3.5 h-3.5" /> AI estimate nutritionals + allergens
                    </button>
                  )}
                  {est === "loading" && <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Estimating…</p>}
                  {typeof est === "object" && "error" in est && <p className="text-xs text-destructive">{est.error}</p>}
                  {typeof est === "object" && !("error" in est) && (
                    <div className="bg-secondary/40 rounded-lg p-3 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={cn("text-[11px] px-2 py-0.5 rounded-full font-semibold uppercase", confidenceStyle[est.confidence])}>{est.confidence} confidence</span>
                        {est.notes && <span className="text-xs text-muted-foreground">{est.notes}</span>}
                      </div>
                      <p className="text-xs font-mono">
                        {ESTIMATE_NUTRIENT_KEYS.filter(k => row.missingNutrition.includes(k)).map(k => `${k}: ${est[k] ?? "—"}`).join("  ·  ")}
                      </p>
                      {est.allergens.length > 0 && (
                        <p className="text-xs"><span className="font-medium">Allergens detected:</span> {est.allergens.join(", ")}</p>
                      )}
                      <div className="flex gap-2">
                        <button
                          onClick={() => void applyEstimate(row, est)}
                          disabled={busy}
                          className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-primary text-primary-foreground font-medium disabled:opacity-50"
                        >
                          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Approve &amp; save missing values
                        </button>
                        <button
                          onClick={() => setEstimates(prev => { const next = { ...prev }; delete next[row.id]; return next; })}
                          className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-secondary"
                        >
                          Discard
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RecipeDetailDialog({ recipe, tab, open, onOpenChange }: { recipe: RecipeItem; tab: TabType; open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] bg-card border-border rounded-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-xl flex items-center gap-2">
            {tab === "nutritionals" ? <Beaker className="w-5 h-5" /> : tab === "labels" ? <Tag className="w-5 h-5" /> : <ClipboardList className="w-5 h-5" />}
            {recipe.name} — {tab === "nutritionals" ? "Nutritionals" : tab === "labels" ? "Label Preview" : "Ingredient Deck"}
          </DialogTitle>
        </DialogHeader>
        {tab === "nutritionals" ? (
          <NutritionalsPanel recipe={recipe} />
        ) : tab === "labels" ? (
          <LabelPreviewPanel recipe={recipe} />
        ) : (
          <DeckPanel recipe={recipe} />
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function ProductHub() {
  const { data: recipes, isLoading } = useListRecipes();
  const [activeTab, setActiveTab] = useState<TabType>("decks");
  const [selectedRecipe, setSelectedRecipe] = useState<RecipeItem | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const recipeList: RecipeItem[] = (recipes ?? [])
    .filter((r: Record<string, unknown>) => r.type !== "sub_recipe")
    .map((r: Record<string, unknown>) => ({ id: r.id as number, name: r.name as string }))
    .sort((a: RecipeItem, b: RecipeItem) => a.name.localeCompare(b.name));

  const openDetail = (recipe: RecipeItem) => {
    setSelectedRecipe(recipe);
    setDialogOpen(true);
  };

  const tabs: { key: TabType; label: string; icon: typeof ClipboardList }[] = [
    { key: "decks", label: "Ingredient Decks", icon: ClipboardList },
    { key: "nutritionals", label: "Nutritionals", icon: Beaker },
    { key: "labels", label: "Label Preview", icon: Tag },
    { key: "bundles", label: "Bundle Calculator", icon: Calculator },
    { key: "health", label: "Data Health", icon: HeartPulse },
  ];

  return (
    <div className="flex-1 overflow-y-auto">
      <PageHeader title="Product Hub" subtitle="Nutritional data, ingredient decks, and labelling" />

      <div className="px-6 pb-6 space-y-6">
        <div className="flex gap-1 p-1 bg-secondary/40 rounded-xl max-w-3xl">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all",
                activeTab === t.key
                  ? "bg-card shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <t.icon className="w-4 h-4" /> {t.label}
            </button>
          ))}
        </div>

        {activeTab === "health" ? (
          <DataHealthPanel />
        ) : activeTab === "bundles" ? (
          <BundleCalculator />
        ) : (
        <>
        <MayContainEditor />

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
        ) : recipeList.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">No recipes found. Add recipes first to see their nutritional data.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {recipeList.map(recipe => (
              <button
                key={recipe.id}
                onClick={() => openDetail(recipe)}
                className="text-left bg-card border border-border rounded-xl p-4 hover:border-primary/40 hover:shadow-sm transition-all group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    {activeTab === "nutritionals" ? <Beaker className="w-4 h-4 text-primary" /> : activeTab === "labels" ? <Tag className="w-4 h-4 text-primary" /> : <ClipboardList className="w-4 h-4 text-primary" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate group-hover:text-primary transition-colors">{recipe.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {activeTab === "nutritionals" ? "View nutritional breakdown" : activeTab === "labels" ? "View label preview" : "View ingredient deck"}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
        </>
        )}
      </div>

      {selectedRecipe && (
        <RecipeDetailDialog
          recipe={selectedRecipe}
          tab={activeTab}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
        />
      )}
    </div>
  );
}
