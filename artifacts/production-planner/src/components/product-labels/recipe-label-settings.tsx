/**
 * A recipe's label settings — label name, cooking values, bones warning,
 * use-by periods. The barcode is shown here but SET on the recipe page: it
 * is the one the packing scanner uses (components/barcodes), so the label
 * and the scanner can never disagree. Every field autosaves with a visible save state
 * (charter rule 5). Saving never changes the LIVE label: it changes the
 * current one, which then shows "Update needed" until someone checks it.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { Barcode, ChevronRight, Flame, Snowflake, Thermometer, AlertTriangle } from "lucide-react";
import { COOKING_KEYS, PERIOD_UNITS, type CookingMode, type CookingValues, type PeriodUnit, type ShelfPeriod } from "@workspace/product-labels";
import { StepPreview } from "./step-preview";
import { CookingSuggestion } from "./cooking-suggestion";
import { useAutosave } from "@/hooks/use-autosave";
import { SaveChip } from "@/components/save-chip";
import { cn } from "@/lib/utils";
import { api, useInvalidateLabels, useLabelTemplates, type RecipeLabel } from "./api";

type Patch = Record<string, unknown>;

const inputCls = "h-12 rounded-xl border-2 border-border bg-card px-3 text-lg font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60";

/** "" → null; whole number in range → it; otherwise undefined (invalid). */
function parseWhole(text: string, max: number): number | null | undefined {
  const t = text.trim();
  if (t === "") return null;
  if (!/^\d+$/.test(t)) return undefined;
  const n = Number(t);
  return n <= max ? n : undefined;
}

export function RecipeLabelSettings({ data, canEdit }: { data: RecipeLabel; canEdit: boolean }) {
  const invalidate = useInvalidateLabels();
  const merged = useRef<Patch>({});
  const auto = useAutosave(async (patch: Patch) => {
    await api(`/recipes/${data.recipe.id}/settings`, { method: "PUT", body: JSON.stringify(patch) });
    if (merged.current === patch) merged.current = {};
    await invalidate();
  });
  const save = (p: Patch) => {
    merged.current = { ...merged.current, ...p };
    auto.schedule(merged.current);
  };

  const s = data.settings;
  const t = data.template;
  const [loaded, setLoaded] = useState(false);
  const [labelName, setLabelName] = useState("");
  const [netQuantity, setNetQuantity] = useState(data.settings.netQuantity ?? "");
  const [nums, setNums] = useState<Record<string, string>>({});
  const [flags, setFlags] = useState({ ovenOn: data.settings.ovenOn, airFryerOn: data.settings.airFryerOn, frozenOn: data.settings.frozenOn });
  const templates = useLabelTemplates();
  const [templateChoice, setTemplateChoice] = useState<number | null>(data.templateChoice);
  // Bones warning: null = Automatic, true / false = always on / off.
  const [bones, setBones] = useState<boolean | null>(data.settings.warningOn);
  useEffect(() => {
    if (loaded) return;
    setLabelName(s.labelName ?? "");
    const n: Record<string, string> = {};
    for (const [k, v] of Object.entries(s.cooking)) n[k] = v == null ? "" : String(v);
    setNums(n);
    setLoaded(true);
  }, [loaded, s]);

  // Customer cooking times: Suggested (the weight tier) or Manual (the boxes).
  const ct = data.cookingTimes;
  const [mode, setMode] = useState<CookingMode>(ct.mode);
  const useSuggestion = mode === "suggested" && ct.tiersOn && ct.suggestion != null;

  // What prints — same rule as the server (resolveCooking): Manual = this
  // recipe's own number, else the standard; Suggested = the tier's times when
  // the design has them switched on, else the standard; an appliance
  // switched off is blank (its line drops).
  const resolvedCooking = Object.fromEntries(COOKING_KEYS.map(k => {
    const on = k.startsWith("airFryer") ? flags.airFryerOn : flags.ovenOn;
    const own = parseWhole(nums[k] ?? "", 400);
    const value = useSuggestion ? ct.suggestion!.cooking[k] ?? t.cooking[k]
      : mode === "manual" ? own ?? t.cooking[k]
      : t.cooking[k];
    return [k, !on ? null : value];
  })) as unknown as CookingValues;

  const chooseMode = (m: CookingMode) => { setMode(m); save({ cookingMode: m }); };
  /** Suggestion → the Manual boxes (then adjust by hand). */
  const copySuggestion = () => {
    if (!ct.suggestion) return;
    const values = ct.suggestion.cooking;
    setNums(Object.fromEntries(COOKING_KEYS.map(k => [k, values[k] == null ? "" : String(values[k])])));
    setMode("manual");
    save({ cookingMode: "manual", ...values });
  };
  const overCap = (key: keyof CookingValues, v: number | null | undefined) =>
    v != null && ((key === "ovenMaxMinutes" || key === "ovenMinMinutes") ? ct.maxOvenMinutes != null && v > ct.maxOvenMinutes
      : (key === "airFryerMaxMinutes" || key === "airFryerMinMinutes") ? ct.maxAirFryerMinutes != null && v > ct.maxAirFryerMinutes : false);

  const numField = (key: keyof RecipeLabel["settings"]["cooking"], label: string, unit: string, max: number, disabled: boolean) => {
    const text = nums[key] ?? "";
    const parsed = parseWhole(text, max);
    const def = t.cooking[key];
    return (
      <label className="flex flex-col gap-1">
        <span className="text-sm font-semibold">{label}</span>
        <span className="flex items-center gap-2">
          <input
            inputMode="numeric"
            value={text}
            disabled={!canEdit || disabled}
            placeholder={def == null ? "—" : String(def)}
            onChange={e => {
              const v = e.target.value.replace(/[^\d]/g, "").slice(0, 3);
              setNums(n => ({ ...n, [key]: v }));
              const p = parseWhole(v, max);
              if (p !== undefined) save({ [key]: p });
            }}
            onBlur={() => void auto.flush()}
            className={cn(inputCls, "w-24", (parsed === undefined || overCap(key, parsed)) && "border-destructive")}
          />
          <span className="text-muted-foreground">{unit}</span>
        </span>
        <span className={cn("text-xs", overCap(key, parsed) ? "font-semibold text-destructive" : "text-muted-foreground")}>
          {overCap(key, parsed)
            ? `Over the longest cook we print (${key.startsWith("oven") ? ct.maxOvenMinutes : ct.maxAirFryerMinutes} min)`
            : text === "" ? (def == null ? "Blank — left off the label" : `Using the standard ${def}`) : "This recipe's own value"}
        </span>
      </label>
    );
  };

  const toggle = (key: "ovenOn" | "airFryerOn" | "frozenOn", on: boolean, label: string) => (
    <button
      type="button"
      disabled={!canEdit}
      onClick={() => { setFlags(f => ({ ...f, [key]: !on })); save({ [key]: !on }); }}
      className={cn(
        "h-11 px-4 rounded-full border-2 text-sm font-bold transition-colors disabled:opacity-60",
        on ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground",
      )}
      aria-pressed={on}
    >
      {label}: {on ? "On" : "Off"}
    </button>
  );

  return (
    <section className="rounded-2xl border-2 border-border bg-card p-5 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold">This recipe's label settings</h2>
        {canEdit ? <SaveChip state={auto.state} error={auto.error} onRetry={() => void auto.flush()} /> : <span className="text-sm text-muted-foreground">View only — managers can change these</span>}
      </div>

      {/* Barcode — set on the recipe page, the one the packing scanner uses. */}
      <div className="space-y-2">
        <p className="flex items-center gap-2 text-base font-bold"><Barcode className="w-5 h-5 text-primary" /> Barcode</p>
        <p className="text-lg font-mono font-semibold tracking-wider">{s.barcode ?? "None yet"}</p>
        <Link href={`/recipes?edit=${data.recipe.id}`} className="inline-flex items-center gap-1 text-sm font-semibold text-primary">
          Set it on the recipe page — the packing scanner uses the same number <ChevronRight className="w-4 h-4" />
        </Link>
      </div>

      {/* Template */}
      {(templates.data?.templates.length ?? 0) > 1 && (
        <div className="space-y-2">
          <label htmlFor="label-template" className="text-base font-bold">Label template</label>
          <select
            id="label-template"
            value={templateChoice ?? ""}
            disabled={!canEdit}
            onChange={e => { const v = e.target.value === "" ? null : Number(e.target.value); setTemplateChoice(v); save({ templateId: v }); }}
            className={cn(inputCls, "w-full max-w-md text-base")}
          >
            {/* Automatic = the default for this recipe's category, else the standard one. */}
            <option value="">Automatic — {data.templateAutomatic.name ?? "standard"}</option>
            {templates.data!.templates.map(t => (
              <option key={t.id} value={t.id}>{t.name}{t.isDefault ? " (standard)" : ""}</option>
            ))}
          </select>
          <p className="text-sm text-muted-foreground">The layout, wording and cooking steps come from the template. Automatic uses the template set as the default for this recipe's category, else the standard one. <Link href={(templateChoice ?? data.templateAutomatic.id) ? `/labels/settings?template=${templateChoice ?? data.templateAutomatic.id}` : "/labels/settings"} className="font-semibold text-primary underline">Open this template's design</Link></p>
        </div>
      )}

      {/* Label name */}
      <div className="space-y-2">
        <label htmlFor="label-name" className="text-base font-bold">Name on the label</label>
        <input
          id="label-name"
          value={labelName}
          disabled={!canEdit}
          onChange={e => { setLabelName(e.target.value); save({ labelName: e.target.value }); }}
          onBlur={() => void auto.flush()}
          placeholder={data.recipe.name}
          className={cn(inputCls, "w-full max-w-md text-base")}
        />
        <p className="text-sm text-muted-foreground">Leave blank to use the recipe name ({data.recipe.name}). The title adds the pack size: {data.recipe.packSize} PACK.</p>
      </div>

      {/* Net quantity — only on templates that print it (e.g. Fried chicken). */}
      {t.netQuantityOn && (
        <div className="space-y-2">
          <label htmlFor="net-quantity" className="text-base font-bold">Net quantity</label>
          <input
            id="net-quantity"
            value={netQuantity}
            disabled={!canEdit}
            maxLength={40}
            onChange={e => { setNetQuantity(e.target.value); save({ netQuantity: e.target.value }); }}
            onBlur={() => void auto.flush()}
            placeholder="e.g. 500g"
            className={cn(inputCls, "w-40 text-base", !netQuantity.trim() && "border-amber-400")}
          />
          <p className="text-sm text-muted-foreground">Printed big and bold above the barcode. The label can't go live without it.</p>
        </div>
      )}

      {/* Cooking */}
      <div className="space-y-3">
        <h3 className="flex items-center gap-2 text-base font-bold"><Flame className="w-5 h-5 text-primary" /> Cooking instructions on the label</h3>
        <p className="text-sm text-muted-foreground">
          Suggested works the times out from the recipe's weight per calzone and how much meat is in it. Manual uses the boxes below — blank boxes use the standard values from the label design, and a part with nothing in it drops out of the sentence.
          {data.recipe.factoryOvenTempC != null && (
            <> This is NOT the factory bake ({data.recipe.factoryOvenTempC}°C{data.recipe.factoryOvenTimeSeconds ? ` for ${Math.round(data.recipe.factoryOvenTimeSeconds / 60)} min` : ""}) — that's never printed.</>
          )}
        </p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Cooking times">
          {([["suggested", "Suggested (by weight)"], ["manual", "Manual"]] as const).map(([m, label]) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              disabled={!canEdit}
              onClick={() => chooseMode(m)}
              className={cn(
                "h-11 px-4 rounded-full border-2 text-sm font-bold transition-colors disabled:opacity-60",
                mode === m ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <CookingSuggestion info={ct} mode={mode} canEdit={canEdit} onCopy={copySuggestion} />
        <div className="flex flex-wrap gap-2">
          {toggle("ovenOn", flags.ovenOn, "Oven")}
          {toggle("airFryerOn", flags.airFryerOn, "Air fryer")}
        </div>
        {mode === "manual" && (
          <>
            <div className={cn("grid grid-cols-2 sm:grid-cols-4 gap-4", !flags.ovenOn && "opacity-50")}>
              {numField("ovenTempC", "Oven", "°C", 400, !flags.ovenOn)}
              {numField("fanTempC", "Fan oven", "°C", 400, !flags.ovenOn)}
              {numField("ovenMinMinutes", "From", "min", 240, !flags.ovenOn)}
              {numField("ovenMaxMinutes", "To", "min", 240, !flags.ovenOn)}
            </div>
            <div className={cn("grid grid-cols-2 sm:grid-cols-4 gap-4", !flags.airFryerOn && "opacity-50")}>
              {numField("airFryerTempC", "Air fryer", "°C", 400, !flags.airFryerOn)}
              {numField("airFryerMinMinutes", "From", "min", 240, !flags.airFryerOn)}
              {numField("airFryerMaxMinutes", "To", "min", 240, !flags.airFryerOn)}
            </div>
          </>
        )}
        <StepPreview steps={data.current.snapshot.template.text.steps} cooking={resolvedCooking} />
      </div>

      {/* Warning */}
      <div className="space-y-2">
        <h3 className="flex items-center gap-2 text-base font-bold"><AlertTriangle className="w-5 h-5 text-primary" /> Bones warning</h3>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Bones warning">
          {([[null, "Automatic"], [true, "Always on"], [false, "Always off"]] as const).map(([v, label]) => (
            <button
              key={label}
              type="button"
              role="radio"
              aria-checked={bones === v}
              disabled={!canEdit}
              onClick={() => { setBones(v); save({ warningOn: v }); }}
              className={cn(
                "h-11 px-4 rounded-full border-2 text-sm font-bold transition-colors disabled:opacity-60",
                bones === v ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <BonesExplain mode={bones} found={data.bonesWarning.auto} words={data.boneRiskWords} />
      </div>

      {/* Use-by */}
      <div className="grid sm:grid-cols-2 gap-5">
        <PeriodField
          icon={<Thermometer className="w-5 h-5 text-primary" />}
          title="Chilled use-by"
          value={s.chilled}
          fallback={data.recipe.shelfLifeDays ? `${data.recipe.shelfLifeDays} days (the recipe's shelf life)` : t.chilledDefault ? `${t.chilledDefault.amount} ${t.chilledDefault.unit} (the standard)` : "none"}
          canEdit={canEdit}
          onSave={p => save({ chilled: p })}
          onBlur={() => void auto.flush()}
        />
        <div className="space-y-2">
          <PeriodField
            icon={<Snowflake className="w-5 h-5 text-primary" />}
            title="Frozen use-by"
            value={s.frozen}
            fallback={t.frozenDefault ? `${t.frozenDefault.amount} ${t.frozenDefault.unit} (the standard)` : "none"}
            canEdit={canEdit && flags.frozenOn}
            onSave={p => save({ frozen: p })}
            onBlur={() => void auto.flush()}
          />
          {toggle("frozenOn", flags.frozenOn, "Frozen line")}
        </div>
      </div>
      <p className="text-sm text-muted-foreground">Use-by is counted from the day the label is printed: 31 Jan + 1 month = 28 Feb (29 in a leap year).</p>
    </section>
  );
}

function PeriodField({ icon, title, value, fallback, canEdit, onSave, onBlur }: {
  icon: React.ReactNode; title: string; value: ShelfPeriod | null; fallback: string; canEdit: boolean;
  onSave: (p: ShelfPeriod | null) => void; onBlur: () => void;
}) {
  const [amount, setAmount] = useState(value ? String(value.amount) : "");
  const [unit, setUnit] = useState<PeriodUnit>(value?.unit ?? "days");
  const push = (a: string, u: PeriodUnit) => {
    const n = parseWhole(a, 999);
    if (n === undefined) return;
    onSave(n == null || n === 0 ? null : { amount: n, unit: u });
  };
  return (
    <div className="space-y-2">
      <h3 className="flex items-center gap-2 text-base font-bold">{icon} {title}</h3>
      <div className="flex items-center gap-2">
        <input
          inputMode="numeric"
          value={amount}
          disabled={!canEdit}
          placeholder="—"
          onChange={e => { const v = e.target.value.replace(/[^\d]/g, "").slice(0, 3); setAmount(v); push(v, unit); }}
          onBlur={onBlur}
          className={cn(inputCls, "w-24")}
        />
        <select
          value={unit}
          disabled={!canEdit}
          onChange={e => { const u = e.target.value as PeriodUnit; setUnit(u); push(amount, u); }}
          className={cn(inputCls, "text-base")}
        >
          {PERIOD_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
        </select>
      </div>
      <p className="text-xs text-muted-foreground">{amount === "" ? `Blank — using ${fallback}` : "This recipe's own period"}</p>
    </div>
  );
}

/** What prints, and why — Automatic's finding is shown even beside a manual
 *  choice, so an override that disagrees is obvious. */
function BonesExplain({ mode, found, words }: { mode: boolean | null; found: { word: string; ingredient: string } | null; words: string[] }) {
  const autoText = found
    ? `contains ${found.word.toLowerCase()} (${found.ingredient})`
    : words.length
      ? `no ${words.map(w => w.toLowerCase()).join(" / ")} found`
      : "no automatic words are set in the label design";
  if (mode === null) {
    return <p className="text-sm font-semibold">{found ? "On" : "Off"} — {autoText}.</p>;
  }
  const disagrees = mode !== (found != null);
  return (
    <p className={cn("text-sm", disagrees ? "font-semibold text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
      {mode ? "On" : "Off"} — set by hand. Automatic would be {found ? "on" : "off"}: {autoText}.
    </p>
  );
}
