import { useState, useEffect } from "react";
import { useListRecipes } from "@workspace/api-client-react";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import {
  Loader2, ClipboardList, Beaker, AlertTriangle, Copy, Check, Tag, Settings2,
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
  ingredients: { name: string; percentage: number; allergens: string[] }[];
};

type RecipeItem = { id: number; name: string };

const NUTRIENT_LABELS: Record<string, string> = {
  energyKj: "Energy (kJ)", energyKcal: "Energy (kcal)", fat: "Fat", saturates: "  of which saturates",
  carbohydrate: "Carbohydrate", sugars: "  of which sugars", protein: "Protein", fibre: "Fibre", salt: "Salt",
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
            {data.ingredients.map((ing, idx) => (
              <tr key={idx} className="border-b border-border/30">
                <td className="py-1">{ing.name}</td>
                <td className="text-right py-1 font-medium">{ing.percentage}%</td>
                <td className="text-right py-1 text-xs">{ing.allergens.length > 0 ? ing.allergens.join(", ") : "—"}</td>
              </tr>
            ))}
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

function RecipeDetailDialog({ recipe, tab, open, onOpenChange }: { recipe: RecipeItem; tab: TabType; open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] bg-card border-border rounded-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-xl flex items-center gap-2">
            {tab === "nutritionals" ? <Beaker className="w-5 h-5" /> : <ClipboardList className="w-5 h-5" />}
            {recipe.name} — {tab === "nutritionals" ? "Nutritionals" : "Ingredient Deck"}
          </DialogTitle>
        </DialogHeader>
        {tab === "nutritionals" ? <NutritionalsPanel recipe={recipe} /> : <DeckPanel recipe={recipe} />}
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
    { key: "labels", label: "Labels", icon: Tag },
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

        {activeTab === "labels" ? (
          <div className="space-y-4">
            <div className="bg-secondary/20 border border-border rounded-xl p-6 text-center">
              <Tag className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
              <h3 className="text-lg font-semibold mb-1">Label Management</h3>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Label design, printing, and compliance tools are coming soon. In the meantime, use the Ingredient Decks and Nutritionals tabs to generate the data you need for labels.
              </p>
            </div>
            <MayContainEditor />
          </div>
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
                        {activeTab === "nutritionals" ? <Beaker className="w-4 h-4 text-primary" /> : <ClipboardList className="w-4 h-4 text-primary" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold truncate group-hover:text-primary transition-colors">{recipe.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {activeTab === "nutritionals" ? "View nutritional breakdown" : "View ingredient deck"}
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
          tab={activeTab === "labels" ? "decks" : activeTab}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
        />
      )}
    </div>
  );
}
