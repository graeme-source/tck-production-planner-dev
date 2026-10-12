/**
 * Label design → "Cooking times by weight": the tiers that suggest each
 * recipe's customer cooking times from its weight per calzone and its meat
 * (lib/product-labels cooking-tiers.ts), the longest cook ever printed, which
 * ingredient categories count as meat / veg / cheese / dough, and a table of
 * where every calzone lands with the draft as it is now (POST
 * /template/cooking-tiers), so the tiers can be checked before they're
 * switched on. Changes autosave with the rest of the design.
 */
import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Loader2, Plus, Trash2 } from "lucide-react";
import {
  COOKING_CLASS_LABEL, COOKING_CLASSES, describeTierLimits, MAX_COOKING_TIERS,
  type CookingClass, type CookingTier, type CookingTiersConfig, type CookingValues, type HalvedRange, type LabelTemplate,
} from "@workspace/product-labels";
import { cn } from "@/lib/utils";
import { api, type TierPreviewRow } from "./api";
import { labelInputCls, Num, Toggle } from "./form-bits";

const range = (a: number | null, b: number | null) => (a == null || b == null ? "—" : a === b ? `${a}` : `${a}–${b}`);
const half = (h: HalvedRange | null) => (h ? `${h.first} ➜ ${range(h.second[0], h.second[1])}` : "");

const TIME_FIELDS: Array<{ key: keyof CookingValues; label: string; unit: string; max: number }> = [
  { key: "ovenMinMinutes", label: "Oven from", unit: "min", max: 240 },
  { key: "ovenMaxMinutes", label: "Oven to", unit: "min", max: 240 },
  { key: "ovenTempC", label: "Oven", unit: "°C", max: 400 },
  { key: "fanTempC", label: "Fan oven", unit: "°C", max: 400 },
  { key: "airFryerMinMinutes", label: "Air fryer from", unit: "min", max: 240 },
  { key: "airFryerMaxMinutes", label: "Air fryer to", unit: "min", max: 240 },
  { key: "airFryerTempC", label: "Air fryer", unit: "°C", max: 400 },
];

export function CookingTiersEditor({ template, onChange }: { template: LabelTemplate; onChange: (c: CookingTiersConfig) => void }) {
  const cfg = template.cookingTiers;
  const set = (patch: Partial<CookingTiersConfig>) => onChange({ ...cfg, ...patch });
  const setTier = (i: number, patch: Partial<CookingTier>) => set({ tiers: cfg.tiers.map((t, j) => (j === i ? { ...t, ...patch } : t)) });
  const addTier = () => set({
    tiers: [...cfg.tiers, { key: `tier-${Date.now()}`, name: `Tier ${cfg.tiers.length + 1}`, maxWeightG: null, maxMeatG: null, cooking: { ...cfg.tiers[cfg.tiers.length - 1]?.cooking ?? template.cooking } }],
  });

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Each recipe goes in the <b>first</b> tier (top to bottom, lightest first) it fits — at most the weight per calzone (dough + filling) and at most the meat per calzone. A recipe that fits none goes in the last tier. A blank limit means no limit; a blank time or temperature uses the standard cooking values above.
      </p>
      <Toggle on={cfg.on} onChange={on => set({ on })} label="Suggest cooking times by weight" />
      <p className={cn("text-sm", cfg.on ? "font-semibold" : "text-muted-foreground")}>
        {cfg.on
          ? "On: every recipe on Suggested prints its tier's times. Recipes on Manual keep their own. Any live label whose times change shows “Update needed” until someone checks it."
          : "Off: nothing on any label changes — every recipe prints the standard times (or its own Manual ones). The suggestions still show on each recipe's label page."}
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Num label="Longest oven cook" unit="min" value={cfg.maxOvenMinutes} step={1} min={1} max={240} allowBlank onChange={v => set({ maxOvenMinutes: v })} />
        <Num label="Longest air-fryer cook" unit="min" value={cfg.maxAirFryerMinutes} step={1} min={1} max={240} allowBlank onChange={v => set({ maxAirFryerMinutes: v })} />
      </div>
      <p className="text-sm text-muted-foreground">No suggested time goes over these, and a label whose times do (even typed by hand) can't go live.</p>

      <div className="space-y-4">
        {cfg.tiers.map((t, i) => (
          <div key={t.key} className="rounded-2xl border-2 border-border p-4 space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-sm font-semibold">Tier {i + 1}</span>
                <input value={t.name} maxLength={40} onChange={e => setTier(i, { name: e.target.value })} className={cn(labelInputCls, "w-44")} />
              </label>
              <Num label="Up to (per calzone)" unit="g" value={t.maxWeightG} step={1} min={0} max={5000} allowBlank placeholder="no limit" onChange={v => setTier(i, { maxWeightG: v })} />
              <Num label="Meat up to" unit="g" value={t.maxMeatG} step={1} min={0} max={5000} allowBlank placeholder="no limit" onChange={v => setTier(i, { maxMeatG: v })} />
              {cfg.tiers.length > 1 && (
                <button type="button" onClick={() => set({ tiers: cfg.tiers.filter((_, j) => j !== i) })}
                  className="ml-auto inline-flex h-11 items-center gap-1 rounded-full border-2 border-border px-3 text-sm font-semibold text-muted-foreground" aria-label={`Remove ${t.name}`}>
                  <Trash2 className="w-4 h-4" /> Remove
                </button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{i === cfg.tiers.length - 1 ? `${describeTierLimits(t)} — and anything that fits no other tier` : describeTierLimits(t)}</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {TIME_FIELDS.map(f => (
                <Num key={f.key} label={f.label} unit={f.unit} value={t.cooking[f.key]} step={1} min={0} max={f.max} allowBlank
                  placeholder={template.cooking[f.key] == null ? "—" : String(template.cooking[f.key])}
                  onChange={v => setTier(i, { cooking: { ...t.cooking, [f.key]: v } })} />
              ))}
            </div>
          </div>
        ))}
        {cfg.tiers.length < MAX_COOKING_TIERS && (
          <button type="button" onClick={addTier} className="inline-flex h-11 items-center gap-2 rounded-full border-2 border-dashed border-border px-4 text-sm font-bold text-muted-foreground">
            <Plus className="w-4 h-4" /> Add a tier
          </button>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-base font-bold">Which ingredient categories count as…</h3>
        <p className="text-sm text-muted-foreground">The categories set on each ingredient, separated by commas. A component that's mostly dough-category ingredients is the dough; the rest is the filling. Sub-recipes are followed through to their ingredients.</p>
        <div className="grid sm:grid-cols-2 gap-3">
          {COOKING_CLASSES.map(k => (
            <CategoryList key={k} cls={k} value={cfg.categories[k]} onChange={list => set({ categories: { ...cfg.categories, [k]: list } })} />
          ))}
        </div>
      </div>

      <TierPreview template={template} />
    </div>
  );
}

function CategoryList({ cls, value, onChange }: { cls: CookingClass; value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState(value.join(", "));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setText(value.join(", ")); }, [value, focused]);
  const parse = (t: string) => t.split(",").map(s => s.trim()).filter(Boolean);
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-semibold">{COOKING_CLASS_LABEL[cls]}</span>
      <input value={text} onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); onChange(parse(text)); }}
        onChange={e => { setText(e.target.value); onChange(parse(e.target.value)); }} className={cn(labelInputCls, "w-full font-normal")} />
    </label>
  );
}

/** Where every calzone lands with the draft as it is now. */
function TierPreview({ template }: { template: LabelTemplate }) {
  const json = JSON.stringify(template);
  const [debounced, setDebounced] = useState(json);
  useEffect(() => { const id = setTimeout(() => setDebounced(json), 500); return () => clearTimeout(id); }, [json]);
  const q = useQuery({
    queryKey: ["product-labels", "cooking-tiers", debounced],
    queryFn: () => api<{ recipes: TierPreviewRow[] }>("/template/cooking-tiers", { method: "POST", body: JSON.stringify({ settings: JSON.parse(debounced) }) }),
    placeholderData: keepPreviousData,
  });
  const rows = [...(q.data?.recipes ?? [])].sort((a, b) => a.profile.totalG - b.profile.totalG);
  return (
    <div className="space-y-2">
      <h3 className="flex items-center gap-2 text-base font-bold">
        Where each recipe lands {q.isFetching && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
      </h3>
      {q.isError && <p className="text-sm font-semibold text-destructive">Couldn't work out the tiers: {(q.error as Error).message}</p>}
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-secondary/60 text-left">
            <tr>
              <th className="p-2">Recipe</th><th className="p-2 text-right">Per calzone</th><th className="p-2 text-right">Meat</th>
              <th className="p-2">Tier</th><th className="p-2">Oven (turn at)</th><th className="p-2">Air fryer (turn at)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.recipeId} className="border-t border-border">
                <td className="p-2 font-semibold">{r.name}{r.isDraft && <span className="ml-1 text-xs text-muted-foreground">(draft)</span>}</td>
                <td className="p-2 text-right tabular-nums">{r.profile.totalG} g</td>
                <td className="p-2 text-right tabular-nums">{r.profile.meatG} g</td>
                <td className="p-2 font-bold">{r.tierName}</td>
                <td className="p-2 tabular-nums">{range(r.cooking.ovenMinMinutes, r.cooking.ovenMaxMinutes)} min <span className="text-muted-foreground">({half(r.halves.oven)})</span></td>
                <td className="p-2 tabular-nums">{range(r.cooking.airFryerMinMinutes, r.cooking.airFryerMaxMinutes)} min at {r.cooking.airFryerTempC ?? "—"}°C <span className="text-muted-foreground">({half(r.halves.airFryer)})</span></td>
              </tr>
            ))}
            {!q.isLoading && rows.length === 0 && <tr><td colSpan={6} className="p-3 text-muted-foreground">No recipes with dough and filling.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">Recipes on Manual print their own times whatever their tier.</p>
    </div>
  );
}
