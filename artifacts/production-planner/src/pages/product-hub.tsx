import { useState, useEffect, useRef } from "react";
import { useListRecipes } from "@workspace/api-client-react";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import {
  Loader2, ClipboardList, Beaker, AlertTriangle, Copy, Check, Tag, Settings2, Printer,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type TabType = "decks" | "nutritionals" | "labels";

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
    missingNutritionals: string[];
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

      {!data.completeness.isComplete && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 space-y-1">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200 flex items-center gap-1"><AlertTriangle className="w-4 h-4" /> Incomplete Data</p>
          {data.completeness.missingNutritionals.length > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-300">Missing nutritionals: {data.completeness.missingNutritionals.join(", ")}</p>
          )}
          {data.completeness.missingDeclarations.length > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-300">Missing label declarations: {data.completeness.missingDeclarations.join(", ")}</p>
          )}
        </div>
      )}
    </div>
  );
}

function DeckPanel({ recipe }: { recipe: RecipeItem }) {
  const [data, setData] = useState<DeckData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
        <button onClick={copyDeck} className="mt-2 text-xs text-primary hover:underline flex items-center gap-1">
          {copied ? <><Check className="w-3 h-3" /> Copied!</> : <><Copy className="w-3 h-3" /> Copy to clipboard</>}
        </button>
      </div>

      {!data.isComplete && data.missingDeclarations && data.missingDeclarations.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200 flex items-center gap-1">
            <AlertTriangle className="w-4 h-4" /> Missing label declarations
          </p>
          <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">{data.missingDeclarations.join(", ")}</p>
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
  ];

  return (
    <div className="flex-1 overflow-y-auto">
      <PageHeader title="Product Hub" subtitle="Nutritional data, ingredient decks, and labelling" />

      <div className="px-6 pb-6 space-y-6">
        <div className="flex gap-1 p-1 bg-secondary/40 rounded-xl max-w-lg">
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
