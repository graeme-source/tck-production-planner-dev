import { useEffect, useMemo, useRef, useState } from "react";
import { useListRecipes, useListIngredients } from "@workspace/api-client-react";
import { Loader2, Trash2, Save, FilePlus2, Package, Plus, Carrot } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

type Recipe = {
  id: number; name: string; type?: string;
  rrp: number; packagingCost: number; labourCost: number;
  packIngredientCost: number; totalPackCost: number;
};
type Ingredient = { id: number; name: string; costPerPack: number; packWeight: number; unit: string };

type RecipeLine = { kind: "recipe"; recipeId: number; quantity: number; free: boolean };
type ManualLine = { kind: "manual"; key: string; label: string; unitCost: number; unitRrp: number; quantity: number; free: boolean };
type Line = RecipeLine | ManualLine;

type CostInputs = { smallBoxCost: number; largeBoxCost: number; courierCost: number };
type SavedItem =
  | { kind: "recipe"; recipeId: number; quantity: number; free: boolean }
  | { kind: "manual"; label: string; unitCost: number; unitRrp: number; quantity: number; free: boolean };
type SavedBundle = { id: number; name: string; bundlePrice: number; boxSize: string; notes: string | null; items: SavedItem[] };

const gbp = (n: number) => `£${(Number.isFinite(n) ? n : 0).toFixed(2)}`;

export function BundleCalculator() {
  const { data: recipesData, isLoading: recipesLoading } = useListRecipes();
  const { data: ingredientsData } = useListIngredients();

  const recipes = useMemo(
    () => ((recipesData as unknown as Recipe[] | undefined) ?? [])
      .filter(r => r.type !== "sub_recipe")
      .sort((a, b) => a.name.localeCompare(b.name)),
    [recipesData],
  );
  const recipeById = useMemo(() => new Map(recipes.map(r => [r.id, r])), [recipes]);
  const ingredients = useMemo(
    () => ((ingredientsData as unknown as Ingredient[] | undefined) ?? []).slice().sort((a, b) => a.name.localeCompare(b.name)),
    [ingredientsData],
  );

  const [costInputs, setCostInputs] = useState<CostInputs>({ smallBoxCost: 2.5, largeBoxCost: 3.5, courierCost: 5.37 });
  const [saved, setSaved] = useState<SavedBundle[]>([]);

  const [bundleId, setBundleId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [boxSize, setBoxSize] = useState<"small" | "large">("large");
  const [lines, setLines] = useState<Line[]>([]);
  const [priceStr, setPriceStr] = useState("");
  const [priceEdited, setPriceEdited] = useState(false);
  const [recipePick, setRecipePick] = useState("");
  const [ingredientPick, setIngredientPick] = useState("");
  const [savingBundle, setSavingBundle] = useState(false);
  const keyCounter = useRef(0);
  const nextKey = () => `m${keyCounter.current++}`;

  const loadCostInputs = () => {
    fetch(`${BASE}/api/bundles/cost-inputs`, { credentials: "include" })
      .then(r => (r.ok ? r.json() : null)).then(d => { if (d) setCostInputs(d); }).catch(() => {});
  };
  const loadSaved = () => {
    fetch(`${BASE}/api/bundles`, { credentials: "include" })
      .then(r => (r.ok ? r.json() : [])).then(setSaved).catch(() => {});
  };
  useEffect(() => { loadCostInputs(); loadSaved(); }, []);

  // ── derived figures ──
  const lineRrp = (l: Line) => (l.kind === "recipe" ? (recipeById.get(l.recipeId)?.rrp ?? 0) : l.unitRrp) * l.quantity;
  const lineCost = (l: Line) => {
    if (l.kind === "manual") return l.unitCost * l.quantity;
    const r = recipeById.get(l.recipeId);
    return (r ? r.packIngredientCost + r.packagingCost : 0) * l.quantity;
  };
  const rrpTotal = lines.reduce((s, l) => s + lineRrp(l), 0); // perceived value (incl. free)
  const payableRrpTotal = lines.reduce((s, l) => s + (l.free ? 0 : lineRrp(l)), 0); // what they'd pay at RRP
  const productCost = lines.reduce((s, l) => s + lineCost(l), 0); // we bear all costs, incl. free
  const ppCost = (boxSize === "small" ? costInputs.smallBoxCost : costInputs.largeBoxCost) + costInputs.courierCost;
  const totalCost = productCost + ppCost;
  const price = Number(priceStr) || 0;
  const profit = price - totalCost;
  const gpm = price > 0 ? (profit / price) * 100 : 0;
  const discount = rrpTotal - price;
  const discountPct = rrpTotal > 0 ? (discount / rrpTotal) * 100 : 0;

  useEffect(() => {
    if (!priceEdited) setPriceStr(payableRrpTotal > 0 ? payableRrpTotal.toFixed(2) : "");
  }, [payableRrpTotal, priceEdited]);

  // ── line mutations (by index) ──
  const updateLine = (idx: number, patch: Partial<ManualLine>) =>
    setLines(prev => prev.map((l, i) => (i === idx ? { ...l, ...patch } as Line : l)));
  const removeAt = (idx: number) => setLines(prev => prev.filter((_, i) => i !== idx));

  const addRecipe = (recipeId: number) => setLines(prev => {
    const existing = prev.findIndex(l => l.kind === "recipe" && l.recipeId === recipeId);
    if (existing >= 0) return prev.map((l, i) => (i === existing ? { ...l, quantity: l.quantity + 1 } : l));
    return [...prev, { kind: "recipe", recipeId, quantity: 1, free: false }];
  });
  const addMisc = () => setLines(prev => [...prev, { kind: "manual", key: nextKey(), label: "", unitCost: 0, unitRrp: 0, quantity: 1, free: false }]);
  const addIngredient = (ing: Ingredient) => setLines(prev => [...prev, { kind: "manual", key: nextKey(), label: ing.name, unitCost: ing.costPerPack, unitRrp: 0, quantity: 1, free: false }]);

  const resetWorking = () => {
    setBundleId(null); setName(""); setBoxSize("large"); setLines([]);
    setPriceStr(""); setPriceEdited(false); setRecipePick(""); setIngredientPick("");
  };

  const loadBundle = (b: SavedBundle) => {
    setBundleId(b.id); setName(b.name);
    setBoxSize(b.boxSize === "small" ? "small" : "large");
    setLines(b.items.map(it => it.kind === "manual"
      ? { kind: "manual", key: nextKey(), label: it.label, unitCost: it.unitCost, unitRrp: it.unitRrp, quantity: it.quantity, free: it.free }
      : { kind: "recipe", recipeId: it.recipeId, quantity: it.quantity, free: it.free }));
    setPriceStr(b.bundlePrice.toFixed(2)); setPriceEdited(true);
    setRecipePick(""); setIngredientPick("");
  };

  const saveBundle = async () => {
    if (!name.trim()) { toast({ title: "Name required", description: "Give the bundle a name before saving.", variant: "destructive" }); return; }
    if (lines.length === 0) { toast({ title: "No items", description: "Add at least one item.", variant: "destructive" }); return; }
    setSavingBundle(true);
    try {
      const items: SavedItem[] = lines.map(l => l.kind === "recipe"
        ? { kind: "recipe", recipeId: l.recipeId, quantity: l.quantity, free: l.free }
        : { kind: "manual", label: l.label, unitCost: l.unitCost, unitRrp: l.unitRrp, quantity: l.quantity, free: l.free });
      const res = await fetch(`${BASE}/api/bundles${bundleId ? `/${bundleId}` : ""}`, {
        method: bundleId ? "PUT" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), bundlePrice: price, boxSize, items }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast({ title: "Save failed", description: data.error ?? "Could not save.", variant: "destructive" }); return; }
      toast({ title: bundleId ? "Bundle updated" : "Bundle saved", description: name.trim() });
      setBundleId(data.id ?? bundleId);
      loadSaved();
    } catch (err) {
      toast({ title: "Save failed", description: err instanceof Error ? err.message : "Network error", variant: "destructive" });
    } finally {
      setSavingBundle(false);
    }
  };

  const deleteBundle = async (id: number) => {
    try {
      const res = await fetch(`${BASE}/api/bundles/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok && res.status !== 204) { toast({ title: "Delete failed", variant: "destructive" }); return; }
      if (bundleId === id) resetWorking();
      loadSaved();
    } catch { toast({ title: "Delete failed", variant: "destructive" }); }
  };

  const unaddedRecipes = recipes.filter(r => !lines.some(l => l.kind === "recipe" && l.recipeId === r.id));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Saved bundles */}
      <div className="lg:col-span-1 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Saved bundles</h3>
          <button onClick={resetWorking} className="flex items-center gap-1 text-xs text-primary hover:underline">
            <FilePlus2 className="w-3.5 h-3.5" /> New
          </button>
        </div>
        {saved.length === 0 ? (
          <p className="text-xs text-muted-foreground">No saved bundles yet.</p>
        ) : (
          <div className="space-y-1.5">
            {saved.map(b => (
              <div key={b.id} className={cn("flex items-center gap-2 rounded-lg border p-2.5", bundleId === b.id ? "border-primary bg-primary/5" : "border-border")}>
                <button onClick={() => loadBundle(b)} className="flex-1 text-left min-w-0">
                  <p className="text-sm font-medium truncate">{b.name}</p>
                  <p className="text-xs text-muted-foreground">{gbp(b.bundlePrice)} · {b.items.length} item{b.items.length !== 1 ? "s" : ""}</p>
                </button>
                <button onClick={() => deleteBundle(b.id)} className="text-muted-foreground hover:text-destructive" title="Delete bundle">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Builder + results */}
      <div className="lg:col-span-2 space-y-4">
        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Bundle name (e.g. Friday Feast Box)"
            className="w-full px-3 py-2 border border-border rounded-lg text-sm"
          />
          {recipesLoading ? (
            <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={recipePick}
                onChange={e => { if (e.target.value) { addRecipe(Number(e.target.value)); setRecipePick(""); } }}
                className="flex-1 min-w-[180px] px-3 py-2 border border-border rounded-lg text-sm bg-background"
              >
                <option value="">Add a product…</option>
                {unaddedRecipes.map(r => <option key={r.id} value={r.id}>{r.name} — RRP {gbp(r.rrp)}</option>)}
              </select>
              <select
                value={ingredientPick}
                onChange={e => { const ing = ingredients.find(i => i.id === Number(e.target.value)); if (ing) { addIngredient(ing); setIngredientPick(""); } }}
                className="flex-1 min-w-[180px] px-3 py-2 border border-border rounded-lg text-sm bg-background"
              >
                <option value="">Add from ingredients…</option>
                {ingredients.map(i => <option key={i.id} value={i.id}>{i.name} — {gbp(i.costPerPack)}/{i.packWeight}{i.unit}</option>)}
              </select>
              <button onClick={addMisc} className="flex items-center gap-1.5 px-3 py-2 border border-border rounded-lg text-sm hover:bg-secondary/50">
                <Plus className="w-3.5 h-3.5" /> Misc item
              </button>
            </div>
          )}

          {lines.length === 0 ? (
            <p className="text-xs text-muted-foreground">No items yet — add a product, an ingredient, or a misc item above.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-border">
                  <th className="text-left py-1.5 font-medium">Item</th>
                  <th className="text-center py-1.5 font-medium w-16">Qty</th>
                  <th className="text-right py-1.5 font-medium w-24">RRP</th>
                  <th className="text-right py-1.5 font-medium w-24">Cost</th>
                  <th className="text-center py-1.5 font-medium w-12">Free</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, idx) => {
                  const isManual = l.kind === "manual";
                  const r = l.kind === "recipe" ? recipeById.get(l.recipeId) : undefined;
                  return (
                    <tr key={l.kind === "manual" ? l.key : `r${l.recipeId}`} className={cn("border-b border-border/40", l.free && "bg-emerald-50/50 dark:bg-emerald-950/15")}>
                      <td className="py-1.5 pr-2">
                        {isManual ? (
                          <input
                            value={(l as ManualLine).label}
                            onChange={e => updateLine(idx, { label: e.target.value })}
                            placeholder="Item name"
                            className="w-full px-2 py-1 border border-border rounded text-sm"
                          />
                        ) : (
                          <span>{r?.name ?? "?"}</span>
                        )}
                      </td>
                      <td className="py-1.5 text-center">
                        <input
                          type="number" min="1" value={l.quantity}
                          onChange={e => updateLine(idx, { quantity: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
                          className="w-14 px-1.5 py-1 border border-border rounded text-center"
                        />
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {isManual ? (
                          <input
                            type="number" step="0.01" min="0" value={(l as ManualLine).unitRrp}
                            onChange={e => updateLine(idx, { unitRrp: Number(e.target.value) || 0 })}
                            className="w-20 px-1.5 py-1 border border-border rounded text-right"
                          />
                        ) : gbp(lineRrp(l))}
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                        {isManual ? (
                          <input
                            type="number" step="0.01" min="0" value={(l as ManualLine).unitCost}
                            onChange={e => updateLine(idx, { unitCost: Number(e.target.value) || 0 })}
                            className="w-20 px-1.5 py-1 border border-border rounded text-right"
                          />
                        ) : gbp(lineCost(l))}
                      </td>
                      <td className="py-1.5 text-center">
                        <input
                          type="checkbox" checked={l.free}
                          onChange={e => updateLine(idx, { free: e.target.checked })}
                          title="Give this item free — keeps its RRP & cost, but the customer doesn't pay for it"
                          className="w-4 h-4 align-middle accent-emerald-600 cursor-pointer"
                        />
                      </td>
                      <td className="py-1.5 text-right">
                        <button onClick={() => removeAt(idx)} className="text-muted-foreground hover:text-destructive">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <p className="text-[11px] text-muted-foreground flex items-center gap-1">
            <Carrot className="w-3 h-3" /> Ingredient & misc items: enter the cost and RRP for the amount you're including in the bundle.
          </p>
        </div>

        {/* Pricing + results */}
        <div className="bg-card border border-border rounded-xl p-4 space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Full price (RRP)</label>
              <div className="text-lg font-semibold tabular-nums">{gbp(rrpTotal)}</div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Bundle price</label>
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground">£</span>
                <input
                  type="number" step="0.01" min="0" value={priceStr}
                  onChange={e => { setPriceStr(e.target.value); setPriceEdited(true); }}
                  className="w-28 px-2 py-1.5 border border-border rounded-lg text-right text-lg font-semibold tabular-nums"
                />
                {priceEdited && (
                  <button onClick={() => setPriceEdited(false)} className="text-xs text-primary hover:underline ml-1" title="Reset to summed RRP">reset</button>
                )}
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Box</label>
              <div className="flex rounded-lg border border-border overflow-hidden">
                {(["small", "large"] as const).map(b => (
                  <button key={b} onClick={() => setBoxSize(b)}
                    className={cn("px-3 py-1.5 text-sm capitalize", boxSize === b ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground")}
                  >{b}</button>
                ))}
              </div>
            </div>
          </div>

          <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-3">
            <span>Item cost (ex-labour): <span className="tabular-nums text-foreground">{gbp(productCost)}</span></span>
            <span><Package className="w-3 h-3 inline mb-0.5" /> Box {boxSize}: <span className="tabular-nums text-foreground">{gbp(boxSize === "small" ? costInputs.smallBoxCost : costInputs.largeBoxCost)}</span></span>
            <span>Courier: <span className="tabular-nums text-foreground">{gbp(costInputs.courierCost)}</span></span>
            <span>Total cost: <span className="tabular-nums text-foreground font-medium">{gbp(totalCost)}</span></span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <ResultCard label="Discount" value={gbp(discount)} sub={`${discountPct.toFixed(1)}% off`} tone={discount > 0.001 ? "amber" : "neutral"} />
            <ResultCard label="Bundle price" value={gbp(price)} sub={`${boxSize} box`} tone="neutral" />
            <ResultCard label="Profit" value={gbp(profit)} sub="after costs + courier" tone={profit > 0 ? "green" : "red"} />
            <ResultCard label="Margin" value={`${gpm.toFixed(1)}%`} sub="ex-labour" tone={profit > 0 ? "green" : "red"} />
          </div>

          <div className="flex justify-end pt-1">
            <button
              onClick={saveBundle}
              disabled={savingBundle || !name.trim() || lines.length === 0}
              className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              {savingBundle ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {bundleId ? "Update bundle" : "Save bundle"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ResultCard({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: "green" | "red" | "amber" | "neutral" }) {
  return (
    <div className={cn(
      "rounded-xl border p-3",
      tone === "green" && "border-emerald-300 bg-emerald-50/60 dark:bg-emerald-950/20",
      tone === "red" && "border-red-300 bg-red-50/60 dark:bg-red-950/20",
      tone === "amber" && "border-amber-300 bg-amber-50/60 dark:bg-amber-950/20",
      tone === "neutral" && "border-border bg-card",
    )}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-bold tabular-nums">{value}</p>
      <p className="text-[11px] text-muted-foreground">{sub}</p>
    </div>
  );
}
