/**
 * A recipe's label settings — barcode, label name, cooking values, bones
 * warning, use-by periods. Every field autosaves with a visible save state
 * (charter rule 5). Saving never changes the LIVE label: it changes the
 * current one, which then shows "Update needed" until someone checks it.
 */
import { useEffect, useRef, useState } from "react";
import { Barcode, Flame, Snowflake, Thermometer, AlertTriangle } from "lucide-react";
import { checkEan13, PERIOD_UNITS, type PeriodUnit, type ShelfPeriod } from "@workspace/product-labels";
import { useAutosave } from "@/hooks/use-autosave";
import { SaveChip } from "@/components/save-chip";
import { cn } from "@/lib/utils";
import { api, useInvalidateLabels, type RecipeLabel } from "./api";

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
  const [barcode, setBarcode] = useState("");
  const [labelName, setLabelName] = useState("");
  const [nums, setNums] = useState<Record<string, string>>({});
  const [flags, setFlags] = useState({ ovenOn: data.settings.ovenOn, airFryerOn: data.settings.airFryerOn, warningOn: data.settings.warningOn, frozenOn: data.settings.frozenOn });
  useEffect(() => {
    if (loaded) return;
    setBarcode(s.barcode ?? "");
    setLabelName(s.labelName ?? "");
    const n: Record<string, string> = {};
    for (const [k, v] of Object.entries(s.cooking)) n[k] = v == null ? "" : String(v);
    setNums(n);
    setLoaded(true);
  }, [loaded, s]);

  const bc = barcode.trim() === "" ? null : checkEan13(barcode);
  const changeBarcode = (v: string) => {
    const clean = v.replace(/[^\d ]/g, "").slice(0, 17);
    setBarcode(clean);
    const c = clean.trim() === "" ? null : checkEan13(clean);
    if (c === null) save({ barcode: null });
    else if (c.ok) save({ barcode: c.digits });
  };

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
            className={cn(inputCls, "w-24", parsed === undefined && "border-destructive")}
          />
          <span className="text-muted-foreground">{unit}</span>
        </span>
        <span className="text-xs text-muted-foreground">{text === "" ? (def == null ? "Blank — left off the label" : `Using the standard ${def}`) : "This recipe's own value"}</span>
      </label>
    );
  };

  const toggle = (key: "ovenOn" | "airFryerOn" | "warningOn" | "frozenOn", on: boolean, label: string) => (
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

      {/* Barcode */}
      <div className="space-y-2">
        <label htmlFor="label-barcode" className="flex items-center gap-2 text-base font-bold"><Barcode className="w-5 h-5 text-primary" /> Barcode number (EAN-13)</label>
        <input
          id="label-barcode"
          inputMode="numeric"
          value={barcode}
          disabled={!canEdit}
          onChange={e => changeBarcode(e.target.value)}
          onBlur={() => void auto.flush()}
          placeholder="13 digits, e.g. 5065018206009"
          className={cn(inputCls, "w-full max-w-sm font-mono tracking-wider", bc && !bc.ok && "border-destructive")}
        />
        {bc && !bc.ok && <p className="text-sm text-destructive font-semibold">Not saved — {bc.reason}.</p>}
        {bc?.ok && <p className="text-sm text-emerald-700 dark:text-emerald-400">Check digit correct. The barcode is drawn by the app — no image needed.</p>}
      </div>

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

      {/* Cooking */}
      <div className="space-y-3">
        <h3 className="flex items-center gap-2 text-base font-bold"><Flame className="w-5 h-5 text-primary" /> Cooking instructions on the label</h3>
        <p className="text-sm text-muted-foreground">
          Blank boxes use the standard values from the label design. A part with nothing in it drops out of the sentence.
          {data.recipe.factoryOvenTempC != null && (
            <> This is NOT the factory bake ({data.recipe.factoryOvenTempC}°C{data.recipe.factoryOvenTimeSeconds ? ` for ${Math.round(data.recipe.factoryOvenTimeSeconds / 60)} min` : ""}) — that's never printed.</>
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          {toggle("ovenOn", flags.ovenOn, "Oven")}
          {toggle("airFryerOn", flags.airFryerOn, "Air fryer")}
        </div>
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
      </div>

      {/* Warning */}
      <div className="space-y-2">
        <h3 className="flex items-center gap-2 text-base font-bold"><AlertTriangle className="w-5 h-5 text-primary" /> Bones warning</h3>
        {toggle("warningOn", flags.warningOn, "Print the warning")}
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
