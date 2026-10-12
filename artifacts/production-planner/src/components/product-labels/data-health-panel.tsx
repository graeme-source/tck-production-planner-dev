/**
 * Data health: every recipe-used ingredient missing a label declaration or a
 * nutritional value, with AI estimates / supplier-page scrapes to approve.
 * Moved unchanged from the old Product Hub (12 Oct 2026) — it is now the
 * Data health tab on /labels (?tab=health). Objective F.
 */
import { useState, useEffect } from "react";
import { useListSuppliers } from "@workspace/api-client-react";
import type { Ingredient } from "@workspace/api-client-react";
import { useAppMutations } from "@/hooks/use-mutations";
import { cn } from "@/lib/utils";
import { Loader2, Check, UploadCloud, Sparkles, Edit2 } from "lucide-react";
import { IngredientFormDialog } from "@/components/ingredient-form-dialog";
import { buildIngredientPayload, type IngredientFormValues } from "@/lib/ingredient-form";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

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

type ScrapedIngredient = {
  ingredients: string | null;
  allergens: string[];
  energyKj: number | null; energyKcal: number | null; fat: number | null;
  saturates: number | null; carbohydrate: number | null; sugars: number | null;
  protein: number | null; fibre: number | null; salt: number | null;
  name: string | null; brand: string | null; notes: string | null;
};

// Free-form allergen names from a scraped page → UK14 codes (same map as
// the ingredient form dialog). Unmatched names are dropped.
const SCRAPE_ALLERGEN_MAP: Record<string, string> = {
  celery: "celery",
  gluten: "cereals_containing_gluten", wheat: "cereals_containing_gluten",
  rye: "cereals_containing_gluten", barley: "cereals_containing_gluten", oats: "cereals_containing_gluten",
  crustaceans: "crustaceans", prawns: "crustaceans",
  eggs: "eggs", egg: "eggs",
  fish: "fish",
  lupin: "lupin",
  milk: "milk", dairy: "milk",
  molluscs: "molluscs",
  mustard: "mustard",
  "tree nuts": "nuts", nuts: "nuts",
  peanuts: "peanuts",
  sesame: "sesame",
  soybeans: "soybeans", soya: "soybeans", soy: "soybeans",
  "sulphur dioxide": "sulphur_dioxide", sulphites: "sulphur_dioxide", sulfites: "sulphur_dioxide",
};

function mapScrapedAllergens(names: string[]): string[] {
  const out = new Set<string>();
  for (const n of names) {
    const code = SCRAPE_ALLERGEN_MAP[n.toLowerCase().trim()];
    if (code) out.add(code);
  }
  return Array.from(out);
}

// Short names for the health badge, so "1 nutrient value missing" can say
// WHICH one instead of leaving the operator to hunt through the form.
const HEALTH_NUTRIENT_SHORT: Record<string, string> = {
  energyKj: "energy kJ", energyKcal: "energy kcal", fat: "fat", saturates: "saturates",
  carbohydrate: "carbs", sugars: "sugars", protein: "protein", fibre: "fibre", salt: "salt",
};

export function DataHealthPanel() {
  const [rows, setRows] = useState<HealthRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [estimates, setEstimates] = useState<Record<number, HealthEstimate | "loading" | { error: string }>>({});
  const [scrapeUrls, setScrapeUrls] = useState<Record<number, string>>({});
  const [scrapes, setScrapes] = useState<Record<number, ScrapedIngredient | "loading" | { error: string }>>({});
  const [labelDrafts, setLabelDrafts] = useState<Record<number, string>>({});
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);

  // Full ingredient edit dialog, opened straight from a health row — same
  // dialog as the Inventory page, so every field is fixable without leaving
  // the review queue.
  const { data: suppliers } = useListSuppliers();
  const { updateIngredient } = useAppMutations();
  const [editTarget, setEditTarget] = useState<Ingredient | null>(null);
  const [editLoadingId, setEditLoadingId] = useState<number | null>(null);

  const openEditor = async (row: HealthRow) => {
    setEditLoadingId(row.id);
    try {
      const res = await fetch(`${BASE}/api/ingredients/${row.id}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Could not load ingredient (${res.status})`);
      setEditTarget(await res.json() as Ingredient);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setEditLoadingId(null);
    }
  };

  const handleDialogSave = (data: IngredientFormValues, id: number | null) => {
    if (id == null) return;
    updateIngredient.mutate({ id, data: buildIngredientPayload(data) }, {
      onSuccess: () => { setEditTarget(null); void load(); },
    });
  };

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

  const fetchScrape = async (row: HealthRow): Promise<void> => {
    const url = (scrapeUrls[row.id] ?? "").trim();
    if (!url) return;
    setScrapes(prev => ({ ...prev, [row.id]: "loading" }));
    try {
      const res = await fetch(`${BASE}/api/ingredients/scrape-url`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Scrape failed (${res.status})`);
      setScrapes(prev => ({ ...prev, [row.id]: body.extracted as ScrapedIngredient }));
    } catch (e) {
      setScrapes(prev => ({ ...prev, [row.id]: { error: e instanceof Error ? e.message : String(e) } }));
    }
  };

  // Scraped data comes from a labelled supplier page, so applied values
  // clear the AI-estimated flag (unlike estimates, which set it).
  const applyScrape = async (row: HealthRow, scraped: ScrapedIngredient) => {
    const curRes = await fetch(`${BASE}/api/ingredients/${row.id}`, { credentials: "include" });
    if (!curRes.ok) { setError("Could not load current ingredient"); return; }
    const current = await curRes.json();
    const changes: Record<string, unknown> = {};
    for (const key of ESTIMATE_NUTRIENT_KEYS) {
      if (current[key] == null && scraped[key] != null) changes[key] = scraped[key];
    }
    const currentAllergens: string[] = current.allergens ?? [];
    const merged = [...new Set([...currentAllergens, ...mapScrapedAllergens(scraped.allergens ?? [])])];
    if (merged.length !== currentAllergens.length) changes["allergens"] = merged;
    if ((current.labelDeclaration == null || current.labelDeclaration === "") && scraped.ingredients) {
      changes["labelDeclaration"] = scraped.ingredients;
    }
    if (Object.keys(changes).length === 0) return;
    if (Object.keys(changes).some(k => (ESTIMATE_NUTRIENT_KEYS as readonly string[]).includes(k))) {
      changes["nutritionalsAiEstimated"] = false;
    }
    await saveIngredient(row, changes);
    setScrapes(prev => { const next = { ...prev }; delete next[row.id]; return next; });
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
                <div className="flex gap-1.5 flex-wrap items-center">
                  {row.missingLabel && <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200 font-medium">No label declaration</span>}
                  {row.missingNutrition.length > 0 && <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200 font-medium">{row.missingNutrition.length === 9 ? "No nutritionals" : `Missing: ${row.missingNutrition.map(k => HEALTH_NUTRIENT_SHORT[k] ?? k).join(", ")}`}</span>}
                  {row.emptyAllergens && <span className="text-[11px] px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground font-medium">No allergens tagged</span>}
                  <button
                    onClick={() => void openEditor(row)}
                    disabled={editLoadingId === row.id}
                    className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg border border-border hover:bg-secondary font-medium disabled:opacity-50"
                    title="Open the full ingredient edit dialog"
                  >
                    {editLoadingId === row.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Edit2 className="w-3 h-3" />} Edit ingredient
                  </button>
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

              {(() => {
                const scr = scrapes[row.id];
                return (
                  <div className="space-y-2">
                    <div className="flex gap-2 items-center flex-wrap">
                      <input
                        value={scrapeUrls[row.id] ?? ""}
                        onChange={e => setScrapeUrls(prev => ({ ...prev, [row.id]: e.target.value }))}
                        placeholder="Or paste the supplier product page URL…"
                        className="flex-1 min-w-[220px] px-3 py-1.5 bg-background border border-border rounded-lg text-sm"
                      />
                      <button
                        onClick={() => void fetchScrape(row)}
                        disabled={scr === "loading" || !(scrapeUrls[row.id] ?? "").trim()}
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-secondary font-medium disabled:opacity-50"
                      >
                        {scr === "loading" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UploadCloud className="w-3.5 h-3.5" />} Scrape page
                      </button>
                    </div>
                    {typeof scr === "object" && "error" in scr && <p className="text-xs text-destructive">{scr.error}</p>}
                    {typeof scr === "object" && !("error" in scr) && (
                      <div className="bg-secondary/40 rounded-lg p-3 space-y-2">
                        {(scr.name || scr.brand) && <p className="text-xs font-medium">{[scr.brand, scr.name].filter(Boolean).join(" — ")}</p>}
                        {scr.ingredients && <p className="text-xs"><span className="font-medium">Label declaration:</span> {scr.ingredients}</p>}
                        <p className="text-xs font-mono">
                          {ESTIMATE_NUTRIENT_KEYS.map(k => `${k}: ${scr[k] ?? "—"}`).join("  ·  ")}
                        </p>
                        {scr.allergens && scr.allergens.length > 0 && (
                          <p className="text-xs"><span className="font-medium">Allergens:</span> {mapScrapedAllergens(scr.allergens).join(", ") || "(none matched UK14 list)"}</p>
                        )}
                        <div className="flex gap-2 flex-wrap">
                          <button
                            onClick={() => void applyScrape(row, scr)}
                            disabled={busy}
                            className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-primary text-primary-foreground font-medium disabled:opacity-50"
                          >
                            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Approve &amp; save scraped data
                          </button>
                          {scr.ingredients && row.missingLabel && (
                            <button
                              onClick={() => setLabelDrafts(prev => ({ ...prev, [row.id]: scr.ingredients ?? "" }))}
                              className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-secondary"
                            >
                              Edit declaration first
                            </button>
                          )}
                          <button
                            onClick={() => setScrapes(prev => { const next = { ...prev }; delete next[row.id]; return next; })}
                            className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-secondary"
                          >
                            Discard
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>

      <IngredientFormDialog
        open={editTarget !== null}
        onClose={() => setEditTarget(null)}
        editingItem={editTarget}
        defaultMode="ingredient"
        suppliers={(suppliers ?? []).map(s => ({ id: s.id, name: s.name }))}
        onSave={handleDialogSave}
      />
    </div>
  );
}
