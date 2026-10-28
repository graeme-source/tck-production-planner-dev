/**
 * The Ingredients tab of the recipe AND sub-recipe editors: ONE big table of
 * every line — ingredients and sub-recipes together, drawn by the same row
 * (Graeme, 28 Oct 2026: "this is the primary part of any recipe … it almost
 * wants to look like it's in one table"; "when we add subrecipes into a
 * recipe, it's a slightly different user interface from adding ingredients
 * and I want that to be consistent"). Objectives A and F.
 *
 *   • Name and quantity are the biggest, boldest things on the row.
 *   • A sub-recipe row differs only by a small "Sub-recipe" tag and an
 *     accent edge; it searches, measures, costs and opens exactly like an
 *     ingredient row.
 *   • Two Add buttons side by side add a row of either kind; the new row's
 *     search opens straight away. Rows added now stay at the bottom, under
 *     the ones already saved (lib/recipe-editor-tabs orderLines).
 *   • Every picked line has an open button (#id ↗) — the ingredient record,
 *     or the sub-recipe in its own editor on top (and so on down).
 *   • The total cost of the lines sits at the foot of the table.
 *
 * The table is presentation only: the form keeps its two arrays (recipes:
 * `ingredients` + `subRecipes`; sub-recipes: `ingredients` +
 * `subRecipeComponents`), so what is saved never changes shape
 * (lib/recipe-editor-payload).
 *
 * What only one editor needs is switched on by props, never by page name:
 *   productionTicks  Fill / Top / Prep / Mix +g (final products, both kinds)
 *   hideFromPrep     "Hide from prep sheet" (sub-recipe ingredients)
 *   ratioNote        processing-ratio note (sub-recipe ingredients)
 *   link             what a row can be linked to and the wording ("Linked
 *                    to …" in recipes, "Marinade for …" raw meat in
 *                    sub-recipes)
 *   lineCost         the cost rule per kind (lib/recipe-line-cost)
 * Field paths are built from each kind's `name`, so the form's own types
 * aren't visible here.
 */
import { lazy, Suspense, useMemo, useRef, useState } from "react";
import type React from "react";
import { useFieldArray, type FieldErrors, type UseFormReturn } from "react-hook-form";
import { useQueryClient } from "@tanstack/react-query";
import { FlaskConical, Layers, Plus, SquareArrowOutUpRight, X } from "lucide-react";
import { getGetUpfSummaryQueryKey, useListIngredients } from "@workspace/api-client-react";
import { ingredientGapChips, type NutrientKey } from "@workspace/product-labels";
import { toGrams, convertQuantity } from "@workspace/units";
import { IngredientCombobox } from "@/components/ingredient-combobox";
import { EditIngredientDialog } from "@/components/declaration-fix";
import { UpfChip, UpfPercentPill } from "@/components/upf-badge";
import { sharedNameDetail, sharedNameIds } from "@/lib/ingredient-duplicates";
import { formatLineCost } from "@/lib/recipe-line-cost";
import { orderLines } from "@/lib/recipe-editor-tabs";
import { cn } from "@/lib/utils";
import { QuantityInput } from "./quantity-input";
import type { EditorIngredientOption, EditorSubRecipeOption } from "./types";

// The sub-recipe editor lives on the Sub-recipes page, which itself uses
// this table — loaded on demand so the two don't import each other.
const SubRecipeEditorPopup = lazy(() => import("@/pages/sub-recipes").then(m => ({ default: m.SubRecipeEditorPopup })));

const MIX_EXTRA_HELP =
  "Extra grams per production day (not per batch), added once at the mixing station. " +
  "If this item is prepped (meat, veg, sauces…) the extra is added to the prep requirement too, " +
  "so it's ready by mixing. Fridge items (e.g. fior di latte) are just pulled out at mixing.";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyForm = UseFormReturn<any>;
type Row = Record<string, unknown>;
type LinkTarget = { id: number; name: string };
type UpfSummary = { upfPercent?: number | null; unclassifiedIngredients: unknown[]; upfIngredients: Array<{ name: string }> };

/** One kind of line (ingredients, or sub-recipes) as the form holds it. */
type LineKindConfig = {
  /** Field array name, e.g. "ingredients", "subRecipes", "subRecipeComponents". */
  name: string;
  /** Row field holding the picked id, e.g. "ingredientId", "subRecipeId". */
  idField: string;
  /** A fresh row (quantity 0 = blank box). */
  newRow: () => Row;
  lineCost: (row: Row | undefined) => number | null;
  addDisabled?: boolean;
  /** Said under the Add button while it's disabled. */
  addDisabledText?: string;
  /** "Hide from prep sheet" under each row. */
  hideFromPrep?: boolean;
  /** Processing-ratio note under each row. */
  ratioNote?: boolean;
  /** Linking a line to another line (marinades, connected pairs). */
  link?: {
    targets: (row: Row | undefined) => LinkTarget[];
    /** "Linked to" / "Marinade for". */
    word: string;
    addLabel: string;
  };
};

export type LinesTableProps = {
  form: AnyForm;
  ingredients: LineKindConfig & { options: EditorIngredientOption[]; onQuickAdd?: (index: number) => void };
  subRecipes: LineKindConfig & { options: EditorSubRecipeOption[]; upfById?: Map<number, UpfSummary> };
  /** Fill / Top / Prep / Mix +g columns (final products). */
  productionTicks?: boolean;
  /** "per portion" / "per batch" — what the costs are for. */
  costLabel: string;
  /** What the quantities mean, shown by the table's title, e.g. "cooked qty". */
  qtyNote?: string;
  /** Shown under the total (a recipe's RRP and live margin); gets the total. */
  totalFooter?: (totalCost: number | null) => React.ReactNode;
};

// The row is a grid on a wide screen and stacks on a narrow one. With the
// production ticks it needs an iPad-landscape width before it goes flat.
const LAYOUT = {
  ticks: {
    row: "lg:grid lg:grid-cols-[minmax(12rem,1fr)_12rem_5rem_3rem_3rem_3rem_5rem_3rem] lg:gap-x-2 lg:items-center",
    head: "hidden lg:grid lg:grid-cols-[minmax(12rem,1fr)_12rem_5rem_3rem_3rem_3rem_5rem_3rem] lg:gap-x-2",
    full: "w-full lg:w-auto",
    contents: "lg:contents",
    stackOnly: "lg:hidden",
    gridOnly: "hidden lg:inline",
    remove: "ml-auto lg:ml-0",
    tickCell: "lg:justify-center lg:border-0 lg:bg-transparent lg:px-0 lg:min-w-0",
  },
  plain: {
    row: "md:grid md:grid-cols-[minmax(12rem,1fr)_13rem_5.5rem_3rem] md:gap-x-3 md:items-center",
    head: "hidden md:grid md:grid-cols-[minmax(12rem,1fr)_13rem_5.5rem_3rem] md:gap-x-3",
    full: "w-full md:w-auto",
    contents: "md:contents",
    stackOnly: "md:hidden",
    gridOnly: "hidden md:inline",
    remove: "ml-auto md:ml-0",
    tickCell: "",
  },
} as const;

function errorAt(errors: FieldErrors, path: string): string | null {
  let cur: unknown = errors;
  for (const part of path.split(".")) {
    if (cur == null || typeof cur !== "object") return null;
    cur = (cur as Record<string, unknown>)[part];
  }
  const msg = (cur as { message?: unknown } | null | undefined)?.message;
  return typeof msg === "string" && msg ? msg : null;
}

export function LinesTable({ form, ingredients: ingCfg, subRecipes: subCfg, productionTicks, costLabel, qtyNote, totalFooter }: LinesTableProps) {
  const { control, register, setValue, watch, formState: { errors } } = form;
  const ingArray = useFieldArray({ control, name: ingCfg.name });
  const subArray = useFieldArray({ control, name: subCfg.name });
  const ingRows = (watch(ingCfg.name) ?? []) as Row[];
  const subRows = (watch(subCfg.name) ?? []) as Row[];
  const L = productionTicks ? LAYOUT.ticks : LAYOUT.plain;

  // Rows added in this sitting, oldest first — they stay at the bottom of
  // the table, under the saved ones. The keys there when the editor opened
  // are remembered once; any key not among them is new.
  const seen = useRef<{ initial: Set<string>; added: string[] } | null>(null);
  if (seen.current == null) seen.current = { initial: new Set([...ingArray.fields, ...subArray.fields].map(f => f.id)), added: [] };
  for (const f of [...ingArray.fields, ...subArray.fields]) {
    if (!seen.current.initial.has(f.id) && !seen.current.added.includes(f.id)) seen.current.added.push(f.id);
  }
  const lines = orderLines(ingArray.fields.map(f => f.id), subArray.fields.map(f => f.id), seen.current.added);
  const lastAdded = seen.current.added[seen.current.added.length - 1] ?? null;

  // g / kg display per row, keyed by the row's stable id (so removing a row
  // doesn't hand its setting to the next one).
  const [display, setDisplay] = useState<Record<string, "g" | "kg">>({});

  // Ingredient rows: tell look-alike records apart and open the one in use
  // (Graeme, 2026-10-23). Sub-recipe rows open the same way, in their own
  // editor on top (Graeme, 28 Oct 2026); its rows open further down in turn.
  const qc = useQueryClient();
  const [openIngredientId, setOpenIngredientId] = useState<number | null>(null);
  const [openSubRecipeId, setOpenSubRecipeId] = useState<number | null>(null);
  // The full records (nutrients aren't on the page's option list) — the same
  // cached /api/ingredients query the pages use, so a save refreshes both.
  const { data: allIngredients } = useListIngredients();
  const recordById = useMemo(() => {
    const m = new Map<number, Partial<Record<NutrientKey, number | string | null>> & { novaClass?: number | null }>();
    for (const i of allIngredients ?? []) m.set(i.id, i as unknown as Partial<Record<NutrientKey, number | string | null>> & { novaClass?: number | null });
    return m;
  }, [allIngredients]);
  const sharedIds = useMemo(() => sharedNameIds(ingCfg.options), [ingCfg.options]);
  const ingPicker = useMemo(
    () => ingCfg.options.map(o => ({ id: o.id, name: o.name, unit: o.unit, detail: sharedNameDetail(o, sharedIds) })),
    [ingCfg.options, sharedIds],
  );
  const subPicker = useMemo(() => subCfg.options.map(s => ({ id: s.id, name: s.name, unit: s.yieldUnit })), [subCfg.options]);

  const set = (path: string, v: unknown) => setValue(path, v, { shouldDirty: true, shouldValidate: true });

  let totalCost = 0;
  let anyCost = false;
  for (const r of ingRows) { const c = ingCfg.lineCost(r); if (c != null && Number.isFinite(c)) { totalCost += c; anyCost = true; } }
  for (const r of subRows) { const c = subCfg.lineCost(r); if (c != null && Number.isFinite(c)) { totalCost += c; anyCost = true; } }
  const ingCount = ingArray.fields.length;
  const subCount = subArray.fields.length;
  const rootError = errorAt(errors, ingCfg.name) ?? errorAt(errors, `${ingCfg.name}.root`) ?? errorAt(errors, subCfg.name) ?? errorAt(errors, `${subCfg.name}.root`);

  return (
    <div data-testid="lines-table" className="space-y-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h3 className="text-lg font-bold">
          Ingredients &amp; sub-recipes
          {qtyNote && <span className="ml-2 text-sm font-normal text-muted-foreground">({qtyNote})</span>}
        </h3>
        <span className="text-sm text-muted-foreground">
          {ingCount} ingredient{ingCount !== 1 ? "s" : ""} · {subCount} sub-recipe{subCount !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="rounded-2xl border-2 border-border bg-card overflow-visible">
        {lines.length > 0 && (
          <div className={cn("px-4 py-2 border-b border-border bg-secondary/30 rounded-t-2xl text-xs font-semibold uppercase tracking-wide text-muted-foreground", L.head)}>
            <span>Name</span>
            <span>Quantity</span>
            <span className="text-right">Cost</span>
            {productionTicks && (
              <>
                <span className="text-center" title="Include in filling mix">Fill</span>
                <span className="text-center" title="Topping — skips prep">Top</span>
                <span className="text-center" title="Show in prep station (for filling items)">Prep</span>
                <span className="text-center text-amber-600" title={MIX_EXTRA_HELP}>Mix +g</span>
              </>
            )}
            <span />
          </div>
        )}

        {lines.length === 0 && (
          <p className="px-4 py-8 text-center text-base text-muted-foreground">
            Nothing in it yet — add the first ingredient or sub-recipe below.
          </p>
        )}

        <div className="divide-y divide-border">
          {lines.map(line => {
            const isSub = line.kind === "subRecipe";
            const cfg = isSub ? subCfg : ingCfg;
            const row = (isSub ? subRows : ingRows)[line.index];
            const path = `${cfg.name}.${line.index}`;
            const pickedId = Number(row?.[cfg.idField] ?? 0);
            const ing = !isSub ? ingCfg.options.find(i => i.id === pickedId) : undefined;
            const sub = isSub ? subCfg.options.find(s => s.id === pickedId) : undefined;
            const unit = ing?.unit ?? sub?.yieldUnit ?? "";
            const cost = cfg.lineCost(row);
            const marinadeVal = row?.marinadeForIngredientId;
            // Selects hand back strings; "" and "0" both mean not linked.
            const linked = marinadeVal != null && marinadeVal !== "" && Number(marinadeVal) !== 0;
            const targets = cfg.link ? cfg.link.targets(row) : [];
            const ratio = ing?.processingRatio;
            const subUpf = sub ? subCfg.upfById?.get(sub.id) : undefined;
            const record = ing ? recordById.get(ing.id) : undefined;
            const gaps = record ? ingredientGapChips(record) : [];
            const pickError = errorAt(errors, `${path}.${cfg.idField}`);
            const qtyError = errorAt(errors, `${path}.quantity`);
            const remove = () => (isSub ? subArray.remove(line.index) : ingArray.remove(line.index));
            const showExtras = gaps.length > 0 || (cfg.ratioNote && ratio != null && ratio < 1) || cfg.hideFromPrep || (cfg.link && targets.length > 0);
            return (
              <div
                key={line.key}
                className={cn("px-3 sm:px-4 py-3 border-l-4", isSub ? "border-l-accent bg-accent/[0.03]" : "border-l-transparent")}
                data-testid={`line-${line.kind}-${line.index}`}
              >
                <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-2", L.row)}>
                  {/* Name — the biggest thing on the row */}
                  <div className={cn("flex items-start gap-2 min-w-0", L.full)}>
                    <div className="flex-1 min-w-0">
                      <IngredientCombobox
                        size="lg"
                        autoOpen={line.key === lastAdded && pickedId === 0}
                        value={pickedId}
                        onChange={id => set(`${path}.${cfg.idField}`, id)}
                        options={isSub ? subPicker : ingPicker}
                        placeholder={isSub ? "Choose a sub-recipe…" : "Choose an ingredient…"}
                        emptyText={isSub ? "No sub-recipes found" : undefined}
                        onCreateNew={!isSub && ingCfg.onQuickAdd ? () => ingCfg.onQuickAdd?.(line.index) : undefined}
                      />
                      <div className="px-3 flex items-center gap-2 flex-wrap text-sm text-muted-foreground min-h-5">
                        {isSub && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 text-accent px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide">
                            <Layers className="w-3 h-3" /> Sub-recipe
                          </span>
                        )}
                        {!isSub && ing && (
                          <>
                            <UpfChip novaClass={ing.novaClass} markers={ing.novaMarkers} />
                            {ing.supplierName && <span className="break-words min-w-0">{ing.supplierName}</span>}
                          </>
                        )}
                        {isSub && subUpf != null && (subUpf.upfPercent ?? 0) > 0 && (
                          <UpfPercentPill
                            percent={subUpf.upfPercent}
                            unclassifiedCount={subUpf.unclassifiedIngredients.length}
                            upfNames={subUpf.upfIngredients.map(u => u.name)}
                          />
                        )}
                      </div>
                      {pickError && <span className="px-3 text-destructive text-sm font-medium block">{pickError}</span>}
                    </div>
                    {(ing || sub) && (
                      <button
                        type="button"
                        onClick={() => (ing ? setOpenIngredientId(ing.id) : sub && setOpenSubRecipeId(sub.id))}
                        className={cn(
                          "shrink-0 inline-flex items-center justify-center gap-1 h-12 min-w-[4rem] px-2.5 rounded-xl border-2 border-border text-sm font-semibold transition-colors",
                          isSub ? "text-accent hover:bg-accent/10" : "text-primary hover:bg-primary/10",
                        )}
                        title={ing ? `Open ${ing.name} (#${ing.id}) — its full ingredient record` : `Open ${sub!.name} (#${sub!.id}) — the sub-recipe and its ingredients`}
                        aria-label={ing ? `Open ingredient ${ing.name}, number ${ing.id}` : `Open sub-recipe ${sub!.name}, number ${sub!.id}`}
                        data-testid={ing ? `open-ingredient-${ing.id}` : `open-sub-recipe-${sub!.id}`}
                      >
                        <span className="tabular-nums text-muted-foreground">#{ing?.id ?? sub?.id}</span>
                        <SquareArrowOutUpRight className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  {/* Quantity — big and bold */}
                  <div className="flex-1 min-w-[10rem] max-w-[14rem] md:max-w-none">
                    <QuantityInput
                      size="lg"
                      unit={unit}
                      storedValue={row?.quantity}
                      display={display[line.key] ?? "g"}
                      onDisplayChange={d => setDisplay(s => ({ ...s, [line.key]: d }))}
                      onKgChange={kg => set(`${path}.quantity`, kg)}
                      register={register(`${path}.quantity`)}
                      invalid={!!qtyError}
                    />
                    {qtyError && <span className="text-destructive text-sm font-medium block">{qtyError}</span>}
                  </div>

                  <div className="text-right">
                    <span className={cn("block text-[11px] uppercase tracking-wide text-muted-foreground font-semibold", L.stackOnly)}>Cost</span>
                    <span className="text-base font-semibold tabular-nums">{formatLineCost(cost)}</span>
                  </div>

                  {productionTicks && (
                    <div className={cn("w-full flex flex-wrap items-center gap-2 order-last", L.contents)}>
                      {([
                        ["includeInFillingMix", "Fill", "Include in filling mix", "accent-primary"],
                        ["isTopping", "Top", "Topping — skips prep", "accent-amber-500"],
                        ["showInPrep", "Prep", "Show in prep station", "accent-emerald-500"],
                      ] as const).map(([field, label, title, accent]) => (
                        <label
                          key={field}
                          title={title}
                          className={cn(
                            "inline-flex items-center gap-2 min-h-11 min-w-11 px-3 rounded-xl border border-border bg-secondary/20 cursor-pointer select-none",
                            L.tickCell,
                          )}
                        >
                          <input type="checkbox" {...register(`${path}.${field}`)} className={cn("w-6 h-6 rounded border-border cursor-pointer", accent)} />
                          <span className={cn("text-sm font-medium", L.stackOnly)}>{label}</span>
                        </label>
                      ))}
                      <div className={cn("flex items-center", L.tickCell)}>
                        {row?.includeInFillingMix ? (() => {
                          // Stored in the line's own unit (a kg line stores kg),
                          // entered as grams — converted through @workspace/units.
                          const stored = Number(row?.mixingOverage) || 0;
                          const grams = Math.round(toGrams(stored, unit) * 1000) / 1000;
                          return (
                            <label className="flex items-center gap-1" title={MIX_EXTRA_HELP}>
                              <span className={cn("text-sm font-medium text-amber-700", L.stackOnly)}>Mix +</span>
                              <input
                                type="number"
                                inputMode="numeric"
                                step="1"
                                min="0"
                                placeholder="0"
                                value={grams || ""}
                                onChange={e => {
                                  const g = Number(e.target.value) || 0;
                                  set(`${path}.mixingOverage`, convertQuantity(g, "g", unit) ?? g);
                                }}
                                className="w-14 h-11 rounded-lg border-2 border-amber-300 bg-amber-50/50 dark:bg-amber-900/10 px-1 text-base font-semibold tabular-nums text-center focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                              />
                              <span className="text-sm text-amber-700">g</span>
                            </label>
                          );
                        })() : <span className={cn("text-sm text-muted-foreground/40", L.gridOnly)}>—</span>}
                      </div>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={remove}
                    className={cn(L.remove, "flex items-center justify-center w-12 h-12 rounded-xl text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors")}
                    aria-label="Remove line"
                    title="Remove this line"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {showExtras && (
                  <div className="mt-2 pl-3 space-y-2">
                    {gaps.length > 0 && ing && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {gaps.map(g => (
                          <button
                            key={g.kind}
                            type="button"
                            onClick={() => setOpenIngredientId(ing.id)}
                            title={g.title}
                            className="min-h-9 px-3 py-1 rounded-full border border-amber-400 bg-amber-50 dark:bg-amber-900/20 text-xs font-semibold text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
                            data-testid={`gap-${g.kind}-${ing.id}`}
                          >
                            {g.label}
                          </button>
                        ))}
                      </div>
                    )}

                    {cfg.ratioNote && ratio != null && ratio < 1 && (
                      <div className="text-sm text-amber-600 flex items-center gap-1.5">
                        <FlaskConical className="w-4 h-4" />
                        Processing ratio: {(ratio * 100).toFixed(2)}% — yield adjusted from raw input
                      </div>
                    )}

                    {(cfg.hideFromPrep || (cfg.link && targets.length > 0)) && (
                      <div className="flex items-center gap-x-4 gap-y-2 flex-wrap text-sm text-muted-foreground">
                        {cfg.hideFromPrep && (
                          <label className="inline-flex items-center gap-2 min-h-10 cursor-pointer select-none">
                            <input type="checkbox" {...register(`${path}.hideFromPrep`)} className="w-5 h-5 rounded border-border" />
                            <span>Hide from prep sheet</span>
                            <span className="text-xs text-muted-foreground/80">(keeps the quantity for ratio maths; doesn&rsquo;t show for prep)</span>
                          </label>
                        )}
                        {cfg.link && targets.length > 0 && (linked ? (
                          <span className="inline-flex items-center gap-2 flex-wrap">
                            <select
                              {...register(`${path}.marinadeForIngredientId`)}
                              className="min-h-10 px-2 py-1 bg-muted/50 border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary/30"
                            >
                              <option value="">Not linked</option>
                              {targets.map(t => <option key={t.id} value={t.id}>{cfg.link!.word} {t.name}</option>)}
                            </select>
                            <button type="button" onClick={() => set(`${path}.marinadeForIngredientId`, null)} className="text-muted-foreground/70 hover:text-muted-foreground w-10 h-10 inline-flex items-center justify-center" aria-label="Unlink">
                              <X className="w-4 h-4" />
                            </button>
                            {/* Held back from prep day — the mixing/cooking station adds
                                it on production day. Still counts toward tray sizing. */}
                            <label className="inline-flex items-center gap-1.5 min-h-10 cursor-pointer" title="Don't add at raw meat prep — the mixing station adds this at cooking on production day. Still counted in tray sizing.">
                              <input type="checkbox" {...register(`${path}.marinadeAddAtCooking`)} className="w-5 h-5 accent-primary" />
                              add at cooking
                            </label>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => set(`${path}.marinadeForIngredientId`, targets[0]?.id ?? null)}
                            className="min-h-10 text-sm text-muted-foreground/80 hover:text-foreground transition-colors"
                          >
                            {cfg.link.addLabel}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {lines.length > 0 && (
          <div className={cn("flex items-center justify-between gap-3 flex-wrap px-4 py-3 border-t-2 border-border bg-secondary/30", !totalFooter && "rounded-b-2xl")}>
            <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Total cost of the lines</span>
            <span className="text-xl font-bold tabular-nums">
              {anyCost ? formatLineCost(totalCost) : "—"}
              <span className="ml-1.5 text-sm font-normal text-muted-foreground">{costLabel}</span>
            </span>
          </div>
        )}
        {lines.length > 0 && totalFooter?.(anyCost ? totalCost : null)}
      </div>

      {rootError && <span className="text-destructive text-sm font-medium block">{rootError}</span>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => ingArray.append(ingCfg.newRow())}
          disabled={ingCfg.addDisabled}
          className="min-h-14 px-4 rounded-2xl border-2 border-dashed border-primary/50 text-primary text-base font-semibold flex items-center justify-center gap-2 hover:bg-primary/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid="add-ingredient-line"
        >
          <Plus className="w-5 h-5" /> Add ingredient
        </button>
        <button
          type="button"
          onClick={() => subArray.append(subCfg.newRow())}
          disabled={subCfg.addDisabled}
          className="min-h-14 px-4 rounded-2xl border-2 border-dashed border-accent/50 text-accent text-base font-semibold flex items-center justify-center gap-2 hover:bg-accent/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid="add-sub-recipe-line"
        >
          <Layers className="w-5 h-5" /> Add sub-recipe
        </button>
      </div>
      {subCfg.addDisabled && subCfg.addDisabledText && <p className="text-sm text-muted-foreground text-right">{subCfg.addDisabledText}</p>}

      {openIngredientId != null && (
        <EditIngredientDialog
          ingredientId={openIngredientId}
          focusDeclaration={false}
          onClose={() => setOpenIngredientId(null)}
          // The list, the record and the nutrition / deck checks are refreshed
          // by the dialog; the UPF roll-up behind the row badges is ours.
          onSaved={() => { void qc.invalidateQueries({ queryKey: getGetUpfSummaryQueryKey() }); }}
        />
      )}

      {openSubRecipeId != null && (
        <Suspense fallback={null}>
          <SubRecipeEditorPopup id={openSubRecipeId} onClose={() => setOpenSubRecipeId(null)} />
        </Suspense>
      )}
    </div>
  );
}
