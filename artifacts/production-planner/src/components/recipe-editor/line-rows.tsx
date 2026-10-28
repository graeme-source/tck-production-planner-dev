/**
 * The ingredient rows and sub-recipe rows of the recipe AND sub-recipe
 * editors. Every picked line has an "open" button (#id ↗) that opens its
 * ingredient record or sub-recipe in a pop-up on top, without losing your
 * place — sub-recipes all the way down — one component, so both editors search, add, measure, cost and
 * link lines exactly the same way (Graeme, 2026-10-12: "if it's got the same
 * thing … it should just use exactly the same structure and code").
 * Objectives A and F.
 *
 * What only one editor needs is switched on by props, never by page name:
 *   productionTicks  Fill / Top / Prep / Mix +g columns (final products)
 *   hideFromPrep     "Hide from prep sheet" (sub-recipe ingredients)
 *   ratioNote        processing-ratio note (sub-recipe ingredients)
 *   link             which lines a row can be linked to, and the wording
 *                    ("Linked to …" in recipes, "Marinade for …" raw meat
 *                    in sub-recipes)
 *   lineCost         the cost rule (lib/recipe-line-cost)
 *
 * The form is any react-hook-form form whose array rows carry the id field
 * named by `idField` plus quantity / marinadeForIngredientId /
 * marinadeAddAtCooking — field paths are built from `name`, so the form's
 * own types aren't visible here.
 */
import { lazy, Suspense, useMemo, useState, type ReactNode } from "react";
import { useFieldArray, type UseFormReturn } from "react-hook-form";
import { useQueryClient } from "@tanstack/react-query";
import { FlaskConical, Plus, SquareArrowOutUpRight, X } from "lucide-react";
import { getGetUpfSummaryQueryKey, useListIngredients } from "@workspace/api-client-react";
import { ingredientGapChips, type NutrientKey } from "@workspace/product-labels";
import { IngredientCombobox } from "@/components/ingredient-combobox";
import { EditIngredientDialog } from "@/components/declaration-fix";
import { UpfChip, UpfPercentPill } from "@/components/upf-badge";
import { sharedNameDetail, sharedNameIds } from "@/lib/ingredient-duplicates";
import { cn } from "@/lib/utils";
import { formatLineCost } from "@/lib/recipe-line-cost";
import { QuantityInput } from "./quantity-input";
import type { EditorIngredientOption, EditorSubRecipeOption } from "./types";
import { toGrams, convertQuantity } from "@workspace/units";

// The sub-recipe editor lives on the Sub-recipes page, which itself uses
// these rows — loaded on demand so the two don't import each other.
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

export type LineRowsProps = {
  form: AnyForm;
  /** Field array name, e.g. "ingredients", "subRecipes", "subRecipeComponents". */
  name: string;
  /** Row field holding the picked id, e.g. "ingredientId", "subRecipeId". */
  idField: string;
  title: ReactNode;
  tone?: "primary" | "accent";
  emptyText: string;
  addLabel: string;
  /** A fresh row (quantity 0 = blank box). */
  newRow: () => Row;
  addDisabled?: boolean;
  lineCost: (row: Row | undefined) => number | null;
  /** Fill / Top / Prep / Mix +g columns. */
  productionTicks?: boolean;
  /** "Hide from prep sheet" under each row. */
  hideFromPrep?: boolean;
  /** Processing-ratio note under each row (ingredients). */
  ratioNote?: boolean;
  /** Linking a line to another line (marinades, connected pairs). */
  link?: {
    targets: (row: Row | undefined) => LinkTarget[];
    /** "Linked to" / "Marinade for". */
    word: string;
    addLabel: string;
  };
} & (
  | { kind: "ingredient"; options: EditorIngredientOption[]; onQuickAdd?: (index: number) => void }
  | { kind: "subRecipe"; options: EditorSubRecipeOption[]; upfById?: Map<number, UpfSummary> }
);

export function LineRows(props: LineRowsProps) {
  const { form, name, idField, title, tone = "primary", emptyText, addLabel, newRow, addDisabled, lineCost, productionTicks, hideFromPrep, ratioNote, link } = props;
  const { control, register, setValue, watch } = form;
  const { fields, append, remove } = useFieldArray({ control, name });
  const rows = (watch(name) ?? []) as Row[];
  // g / kg display per row, keyed by the row's stable id (not its index, so
  // removing a row doesn't hand its setting to the next one).
  const [display, setDisplay] = useState<Record<string, "g" | "kg">>({});

  // Ingredient rows: tell look-alike records apart and open the one in use
  // (Graeme, 2026-10-23: "click on these ingredients … so I can see exactly
  // which one we're using"). Objective G.
  const qc = useQueryClient();
  const [openIngredientId, setOpenIngredientId] = useState<number | null>(null);
  // Sub-recipe rows open the same way, in their own pop-up on top (Graeme,
  // 28 Oct 2026: "I want it to behave the same, whether it's an ingredient
  // or a subrecipe"); its rows open further down in turn.
  const [openSubRecipeId, setOpenSubRecipeId] = useState<number | null>(null);
  // The full records (nutrients aren't on the page's option list) — the same
  // cached /api/ingredients query the pages use, so a save refreshes both.
  const { data: allIngredients } = useListIngredients();
  const recordById = useMemo(() => {
    const m = new Map<number, Partial<Record<NutrientKey, number | string | null>> & { novaClass?: number | null }>();
    for (const i of allIngredients ?? []) m.set(i.id, i as unknown as Partial<Record<NutrientKey, number | string | null>> & { novaClass?: number | null });
    return m;
  }, [allIngredients]);
  const sharedIds = useMemo(
    () => (props.kind === "ingredient" ? sharedNameIds(props.options) : new Set<number>()),
    [props.kind, props.options],
  );

  const pickerOptions = props.kind === "ingredient"
    ? props.options.map(o => ({ id: o.id, name: o.name, unit: o.unit, detail: sharedNameDetail(o, sharedIds) }))
    : props.options.map(s => ({ id: s.id, name: s.name, unit: s.yieldUnit }));

  const grid = productionTicks
    ? "grid-cols-[minmax(10rem,1fr)_7rem_8rem_4rem_2.25rem_2.25rem_2.25rem_4.5rem_2.25rem]"
    : "grid-cols-[minmax(10rem,1fr)_7rem_8rem_4rem_2.25rem]";

  const set = (path: string, v: unknown) => setValue(path, v, { shouldDirty: true, shouldValidate: true });

  return (
    <div data-testid={`lines-${name}`}>
      <div className="py-1.5">
        <span className={cn("text-xs font-semibold uppercase tracking-wide", tone === "accent" ? "text-accent" : "text-primary")}>{title}</span>
      </div>

      {fields.length > 0 && (
        <div className={cn("grid gap-x-2 items-end px-1 mb-1", grid)}>
          <span className="text-[10px] text-muted-foreground font-medium">Name</span>
          <span className="text-[10px] text-muted-foreground font-medium">{props.kind === "ingredient" ? "Supplier" : "UPF"}</span>
          <span className="text-[10px] text-muted-foreground font-medium">Qty</span>
          <span className="text-[10px] text-muted-foreground font-medium text-right">Cost</span>
          {productionTicks && (
            <>
              <span className="text-[10px] text-muted-foreground font-medium text-center" title="Include in filling mix">Fill</span>
              <span className="text-[10px] text-muted-foreground font-medium text-center" title="Topping — skips prep">Top</span>
              <span className="text-[10px] text-muted-foreground font-medium text-center" title="Show in prep station (for filling items)">Prep</span>
              <span className="text-[10px] text-amber-600 font-medium text-center" title={MIX_EXTRA_HELP}>Mix +g</span>
            </>
          )}
          <span />
        </div>
      )}

      {fields.length === 0 && <p className="text-xs text-muted-foreground italic pl-1 pb-1">{emptyText}</p>}

      <div className="space-y-2">
        {fields.map((field, index) => {
          const row = rows[index];
          const path = `${name}.${index}`;
          const pickedId = Number(row?.[idField] ?? 0);
          const ing = props.kind === "ingredient" ? props.options.find(i => i.id === pickedId) : undefined;
          const sub = props.kind === "subRecipe" ? props.options.find(s => s.id === pickedId) : undefined;
          const unit = ing?.unit ?? sub?.yieldUnit ?? "";
          const cost = lineCost(row);
          const marinadeVal = row?.marinadeForIngredientId;
          // Selects hand back strings; "" and "0" both mean not linked.
          const linked = marinadeVal != null && marinadeVal !== "" && Number(marinadeVal) !== 0;
          const targets = link ? link.targets(row) : [];
          const ratio = ing?.processingRatio;
          const subUpf = sub && props.kind === "subRecipe" ? props.upfById?.get(sub.id) : undefined;
          const record = ing ? recordById.get(ing.id) : undefined;
          const gaps = record ? ingredientGapChips(record) : [];
          return (
            <div key={field.id} className="space-y-1">
              <div className={cn("grid gap-x-2 items-center", grid)}>
                <div className="flex items-center gap-1 min-w-0">
                  <IngredientCombobox
                    value={pickedId}
                    onChange={id => set(`${path}.${idField}`, id)}
                    options={pickerOptions}
                    placeholder={props.kind === "ingredient" ? "Select ingredient…" : "Select sub-recipe…"}
                    emptyText={props.kind === "ingredient" ? undefined : "No sub-recipes found"}
                    onCreateNew={props.kind === "ingredient" && props.onQuickAdd ? () => props.onQuickAdd?.(index) : undefined}
                  />
                  {props.kind === "ingredient" && ing && (
                    <button
                      type="button"
                      onClick={() => setOpenIngredientId(ing.id)}
                      className="shrink-0 inline-flex items-center gap-1 h-9 px-2 rounded-lg border border-border text-[11px] font-medium text-primary hover:bg-primary/10 transition-colors"
                      title={`Open ${ing.name} (#${ing.id}) — its full ingredient record`}
                      aria-label={`Open ingredient ${ing.name}, number ${ing.id}`}
                      data-testid={`open-ingredient-${ing.id}`}
                    >
                      <span className="tabular-nums text-muted-foreground">#{ing.id}</span>
                      <SquareArrowOutUpRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {props.kind === "subRecipe" && sub && (
                    <button
                      type="button"
                      onClick={() => setOpenSubRecipeId(sub.id)}
                      className="shrink-0 inline-flex items-center gap-1 h-9 px-2 rounded-lg border border-border text-[11px] font-medium text-accent hover:bg-accent/10 transition-colors"
                      title={`Open ${sub.name} (#${sub.id}) — the sub-recipe and its ingredients`}
                      aria-label={`Open sub-recipe ${sub.name}, number ${sub.id}`}
                      data-testid={`open-sub-recipe-${sub.id}`}
                    >
                      <span className="tabular-nums text-muted-foreground">#{sub.id}</span>
                      <SquareArrowOutUpRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                {props.kind === "ingredient" ? (
                  <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1 min-w-0">
                    <UpfChip novaClass={ing?.novaClass} markers={ing?.novaMarkers} />
                    <span className="break-words min-w-0">{ing?.supplierName ?? <span className="text-muted-foreground/40">—</span>}</span>
                  </span>
                ) : subUpf != null && (subUpf.upfPercent ?? 0) > 0 ? (
                  <UpfPercentPill
                    percent={subUpf.upfPercent}
                    unclassifiedCount={subUpf.unclassifiedIngredients.length}
                    upfNames={subUpf.upfIngredients.map(u => u.name)}
                  />
                ) : <span className="text-[11px] text-muted-foreground/40">—</span>}
                <QuantityInput
                  unit={unit}
                  storedValue={row?.quantity}
                  display={display[field.id] ?? "g"}
                  onDisplayChange={d => setDisplay(s => ({ ...s, [field.id]: d }))}
                  onKgChange={kg => set(`${path}.quantity`, kg)}
                  register={register(`${path}.quantity`)}
                />
                <span className="text-xs tabular-nums text-right text-muted-foreground">{formatLineCost(cost)}</span>
                {productionTicks && (
                  <>
                    <div className="flex justify-center">
                      <input type="checkbox" {...register(`${path}.includeInFillingMix`)} className="rounded border-border text-primary focus:ring-primary/30 w-4 h-4 cursor-pointer" title="Include in filling mix" />
                    </div>
                    <div className="flex justify-center">
                      <input type="checkbox" {...register(`${path}.isTopping`)} className="rounded border-border text-amber-500 focus:ring-amber-500/30 w-4 h-4 cursor-pointer" title="Topping" />
                    </div>
                    <div className="flex justify-center">
                      <input type="checkbox" {...register(`${path}.showInPrep`)} className="rounded border-border text-emerald-500 focus:ring-emerald-500/30 w-4 h-4 cursor-pointer" title="Show in prep station" />
                    </div>
                    <div className="flex justify-center">
                      {row?.includeInFillingMix ? (() => {
                        // Stored in the line's own unit (a kg line stores kg),
                        // entered as grams — converted through @workspace/units.
                        const stored = Number(row?.mixingOverage) || 0;
                        const grams = Math.round(toGrams(stored, unit) * 1000) / 1000;
                        return (
                          <div className="flex items-center gap-0.5">
                            <input
                              type="number"
                              step="1"
                              min="0"
                              placeholder="0"
                              title={MIX_EXTRA_HELP}
                              value={grams || ""}
                              onChange={e => {
                                const g = Number(e.target.value) || 0;
                                set(`${path}.mixingOverage`, convertQuantity(g, "g", unit) ?? g);
                              }}
                              className="w-12 h-8 rounded border border-amber-300 bg-amber-50/50 dark:bg-amber-900/10 px-1 text-xs tabular-nums text-center focus:outline-none focus:ring-1 focus:ring-amber-500/30"
                            />
                            <span className="text-[10px] text-amber-600">g</span>
                          </div>
                        );
                      })() : <span className="text-[10px] text-muted-foreground/30">—</span>}
                    </div>
                  </>
                )}
                <button type="button" onClick={() => remove(index)} className="flex items-center justify-center h-9 text-muted-foreground hover:text-destructive transition-colors" aria-label="Remove line">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {gaps.length > 0 && ing && (
                <div className="pl-1 flex items-center gap-1.5 flex-wrap">
                  {gaps.map(g => (
                    <button
                      key={g.kind}
                      type="button"
                      onClick={() => setOpenIngredientId(ing.id)}
                      title={g.title}
                      className="min-h-7 px-2 py-0.5 rounded-full border border-amber-400 bg-amber-50 dark:bg-amber-900/20 text-[11px] font-semibold text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
                      data-testid={`gap-${g.kind}-${ing.id}`}
                    >
                      {g.label}
                    </button>
                  ))}
                </div>
              )}

              {ratioNote && ratio != null && ratio < 1 && (
                <div className="ml-1 text-xs text-amber-600 flex items-center gap-1">
                  <FlaskConical className="w-3 h-3" />
                  Processing ratio: {(ratio * 100).toFixed(2)}% — yield adjusted from raw input
                </div>
              )}

              {(hideFromPrep || (link && targets.length > 0)) && (
                <div className="pl-1 flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
                  {hideFromPrep && (
                    <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                      <input type="checkbox" {...register(`${path}.hideFromPrep`)} className="rounded border-border" />
                      <span>Hide from prep sheet</span>
                      <span className="text-[10px] text-muted-foreground/80">(keeps the quantity for ratio maths; doesn&rsquo;t show for prep)</span>
                    </label>
                  )}
                  {link && targets.length > 0 && (linked ? (
                    <span className="inline-flex items-center gap-1.5 flex-wrap">
                      <select
                        {...register(`${path}.marinadeForIngredientId`)}
                        className="px-2 py-1 bg-muted/50 border border-border rounded-lg text-xs text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
                      >
                        <option value="">Not linked</option>
                        {targets.map(t => <option key={t.id} value={t.id}>{link.word} {t.name}</option>)}
                      </select>
                      <button type="button" onClick={() => set(`${path}.marinadeForIngredientId`, null)} className="text-muted-foreground/60 hover:text-muted-foreground p-1" aria-label="Unlink">
                        <X className="w-3 h-3" />
                      </button>
                      {/* Held back from prep day — the mixing/cooking station adds
                          it on production day. Still counts toward tray sizing. */}
                      <label className="inline-flex items-center gap-1 cursor-pointer" title="Don't add at raw meat prep — the mixing station adds this at cooking on production day. Still counted in tray sizing.">
                        <input type="checkbox" {...register(`${path}.marinadeAddAtCooking`)} className="w-3.5 h-3.5 accent-primary" />
                        add at cooking
                      </label>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => set(`${path}.marinadeForIngredientId`, targets[0]?.id ?? null)}
                      className="text-xs text-muted-foreground/70 hover:text-muted-foreground transition-colors py-1"
                    >
                      {link.addLabel}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => append(newRow())}
        disabled={addDisabled}
        className={cn(
          "mt-2 w-full min-h-10 px-2 py-2 rounded-lg border border-dashed transition-colors text-sm font-medium flex items-center justify-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent",
          tone === "accent" ? "border-accent/40 text-accent hover:bg-accent/10" : "border-primary/40 text-primary hover:bg-primary/10",
        )}
      >
        <Plus className="w-4 h-4" /> {addLabel}
      </button>

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
