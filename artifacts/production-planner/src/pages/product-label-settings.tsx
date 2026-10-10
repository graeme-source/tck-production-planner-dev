/**
 * Product → Labels → Label design & type: the label template — size and
 * printer resolution, the layout, typography per text field (font width,
 * weight, min/max size, letter spacing, line height, bold, capitals), the
 * fixed wording, and the standard cooking and frozen values. Autosaves with
 * a visible state; a live proof on a real recipe redraws as you change it.
 *
 * Saving the design never changes a live label — every label it affects
 * shows "Update needed" until someone checks and updates it.
 * Managers and admins only. Objectives A, D and F.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Info, Loader2, Type, Ruler, Flame, CalendarClock, PenLine, ShieldCheck } from "lucide-react";
import {
  BODY_WEIGHTS, EAN13_MIN_BAR_HEIGHT_MM, FIELD_KEYS, FIELD_LABEL, PERIOD_UNITS, TEMPLATE_PLACEHOLDERS, WIDTH_LABEL, WIDTH_ORDER,
  type CookingValues, type FieldKey, type FieldStyle, type LabelTemplate, type PeriodUnit, type TemplateText, type WidthVariant,
} from "@workspace/product-labels";
import { PageHeader } from "@/components/page-header";
import { SaveChip } from "@/components/save-chip";
import { useAuth } from "@/contexts/auth-context";
import { useAutosave } from "@/hooks/use-autosave";
import { activeRecipes } from "@/lib/recipe-archive";
import { cn } from "@/lib/utils";
import { api, useInvalidateLabels, useLabelTemplate, type Proof, type TemplatePayload } from "@/components/product-labels/api";
import { ProofImage } from "@/components/product-labels/proof-image";
import { StepPreview } from "@/components/product-labels/step-preview";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const inputCls = "h-11 rounded-xl border-2 border-border bg-card px-3 text-base font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60";
const WEIGHT_LABEL: Record<number, string> = { 400: "Regular", 500: "Medium", 700: "Bold" };

const TEXT_FIELDS: Array<{ key: keyof TemplateText; label: string; rows?: number }> = [
  { key: "title", label: "Title" },
  { key: "step1", label: "Step 1", rows: 2 },
  { key: "step2", label: "Step 2", rows: 3 },
  { key: "step3", label: "Step 3", rows: 2 },
  { key: "storageHeading", label: "Storage heading" },
  { key: "storage", label: "Storage instructions", rows: 3 },
  { key: "chilledLabel", label: "Chilled use-by label" },
  { key: "frozenLabel", label: "Frozen use-by label" },
  { key: "batchLabel", label: "Batch number label" },
  { key: "ingredientsHeading", label: "Ingredients heading" },
  { key: "allergenNote", label: "Allergen note" },
  { key: "warning", label: "Bones warning (recipes switch it on or off)", rows: 2 },
  { key: "address", label: "Address", rows: 2 },
];

const COOKING_FIELDS: Array<{ key: keyof CookingValues; label: string; unit: string }> = [
  { key: "ovenTempC", label: "Oven", unit: "°C" },
  { key: "fanTempC", label: "Fan oven", unit: "°C" },
  { key: "ovenMinMinutes", label: "Oven from", unit: "min" },
  { key: "ovenMaxMinutes", label: "Oven to", unit: "min" },
  { key: "airFryerTempC", label: "Air fryer", unit: "°C" },
  { key: "airFryerMinMinutes", label: "Air fryer from", unit: "min" },
  { key: "airFryerMaxMinutes", label: "Air fryer to", unit: "min" },
];

export default function ProductLabelSettingsPage() {
  const { state } = useAuth();
  const role = state.status === "authenticated" ? state.user.role : "viewer";
  const canEdit = role === "admin" || role === "manager";
  const q = useLabelTemplate();
  if (!canEdit) return <p className="text-muted-foreground">Only managers and admins can change the label design. <Link href="/labels" className="underline">Back to labels</Link></p>;
  if (q.isLoading) return <div className="flex items-center gap-2 text-muted-foreground py-10"><Loader2 className="w-5 h-5 animate-spin" /> Loading the label design…</div>;
  if (q.isError || !q.data) return <p className="text-destructive">Couldn't load the label design — {(q.error as Error | null)?.message}</p>;
  return <Editor initial={q.data} reload={() => void q.refetch()} />;
}

function Editor({ initial, reload }: { initial: TemplatePayload; reload: () => void }) {
  const invalidate = useInvalidateLabels();
  const [draft, setDraft] = useState<LabelTemplate>(initial.template);
  const [meta, setMeta] = useState(initial);
  const versionRef = useRef(initial.version);
  const [raisedNote, setRaisedNote] = useState<string | null>(null);

  const auto = useAutosave(async (tpl: LabelTemplate) => {
    const res = await api<TemplatePayload>("/template", {
      method: "PUT",
      body: JSON.stringify({ id: initial.id, expectedVersion: versionRef.current, settings: tpl }),
    });
    versionRef.current = res.version;
    setMeta(res);
    if (res.raised?.length) {
      setRaisedNote(`Raised to the legal minimum: ${res.raised.map(k => FIELD_LABEL[k]).join(", ")}.`);
      setDraft(d => {
        const next = { ...d, fields: { ...d.fields } };
        for (const k of res.raised!) next.fields[k] = { ...next.fields[k], minPt: res.template.fields[k].minPt, maxPt: res.template.fields[k].maxPt };
        return next;
      });
    }
    void invalidate();
  });

  const draftRef = useRef(draft);
  draftRef.current = draft;
  const update = (fn: (t: LabelTemplate) => LabelTemplate) => {
    const next = fn(draftRef.current);
    draftRef.current = next;
    setDraft(next);
    auto.schedule(next);
  };
  const setPage = <K extends keyof LabelTemplate["page"]>(k: K, v: LabelTemplate["page"][K]) => update(t => ({ ...t, page: { ...t.page, [k]: v } }));
  const setField = (f: FieldKey, patch: Partial<FieldStyle>) => update(t => ({ ...t, fields: { ...t.fields, [f]: { ...t.fields[f], ...patch } } }));
  const setText = (k: keyof TemplateText, v: string) => update(t => ({ ...t, text: { ...t.text, [k]: v } }));
  const setCooking = (k: keyof CookingValues, v: number | null) => update(t => ({ ...t, cooking: { ...t.cooking, [k]: v } }));

  // Legal minimum for a field = the largest across the widths it may use.
  const legalMin = (f: FieldKey) => {
    const st = draft.fields[f];
    const widths = st.allowNarrower ? WIDTH_ORDER.slice(WIDTH_ORDER.indexOf(st.width)) : [st.width];
    const m = meta.legalMinimums[f];
    const base = Math.max(...widths.map(w => m?.[w] ?? 0));
    // Server figures are for the saved small-pack setting; adjust if it was just flipped.
    if (draft.page.smallPack === meta.template.page.smallPack) return base;
    return Math.ceil((base * (draft.page.smallPack ? 0.9 / 1.2 : 1.2 / 0.9)) / 0.25) * 0.25;
  };

  return (
    <div className="space-y-5 max-w-[1400px]">
      <PageHeader title="Label design & type" description="The layout, fonts and wording every pack label uses. Changes here never alter a live label — affected labels show “Update needed” until someone checks them." />
      <div className="flex flex-wrap items-center gap-3 sticky top-0 z-20 bg-background/95 backdrop-blur py-2">
        <Link href="/labels" className="inline-flex items-center gap-2 h-11 px-4 rounded-xl border-2 border-border bg-card font-semibold hover:bg-secondary"><ArrowLeft className="w-5 h-5" /> All labels</Link>
        <SaveChip state={auto.state} error={auto.error} onRetry={() => void auto.flush()} />
        {auto.state === "error" && auto.error?.includes("Someone else") && (
          <button onClick={reload} className="h-11 px-4 rounded-xl border-2 border-destructive text-destructive font-semibold">Reload their version</button>
        )}
        <span className="text-sm text-muted-foreground">Version {meta.version}{meta.updatedByName ? ` · last saved by ${meta.updatedByName}` : ""}</span>
      </div>
      {raisedNote && <p className="rounded-xl border-2 border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3 font-semibold">{raisedNote}</p>}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="xl:order-2">
          <div className="xl:sticky xl:top-16"><LivePreview template={draft} /></div>
        </div>

        <div className="space-y-5 xl:order-1">
          {/* Fonts + law */}
          <Card icon={<ShieldCheck className="w-5 h-5" />} title="Fonts and the legal minimum">
            <p className="text-sm">
              Labels use the <b>Barlow</b> family — Barlow, Barlow Semi Condensed and Barlow Condensed (free SIL Open Font Licence, built into the app, so nothing downloads). It's a clear, DIN-style sans with a large x-height, close to the condensed grotesques most UK food labels use, and its three widths let a long ingredient list go <b>narrower before it goes smaller</b>.
            </p>
            <p className="text-sm">
              UK food law (FIC Art. 13) needs an x-height of at least {draft.page.smallPack ? "0.9" : "1.2"} mm for the mandatory information.
              Barlow's x-height is {(meta.xHeights.normal ?? 0.506).toFixed(3)} of the type size, so the smallest size allowed is <b>{legalMin("ingredients")} pt</b>. You can't set a minimum below that.
            </p>
            <Toggle on={draft.page.smallPack} onChange={v => setPage("smallPack", v)} label="The pack's largest surface is under 80 cm² (allows 0.9 mm)" />
          </Card>

          {/* Size */}
          <Card icon={<Ruler className="w-5 h-5" />} title="Label size and printer">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <Num label="Width" unit="mm" value={draft.page.widthMm} step={1} min={20} max={300} onChange={v => v != null && setPage("widthMm", v)} />
              <Num label="Height" unit="mm" value={draft.page.heightMm} step={1} min={20} max={300} onChange={v => v != null && setPage("heightMm", v)} />
              <label className="flex flex-col gap-1">
                <span className="text-sm font-semibold">Printer</span>
                <select value={draft.page.dpi} onChange={e => setPage("dpi", Number(e.target.value))} className={inputCls}>
                  {[203, 300, 600].map(d => <option key={d} value={d}>{d} dpi</option>)}
                </select>
              </label>
              <Num label="Margin" unit="mm" value={draft.page.marginMm} step={0.5} min={0} max={20} onChange={v => v != null && setPage("marginMm", v)} />
              <Num label="Left column" unit="%" value={draft.page.columnSplitPct} step={1} min={20} max={80} onChange={v => v != null && setPage("columnSplitPct", v)} />
              <Num label="Column gap" unit="mm" value={draft.page.columnGapMm} step={0.5} min={0} max={20} onChange={v => v != null && setPage("columnGapMm", v)} />
              <Num label="Title band" unit="mm" value={draft.page.titleBandMm} step={0.5} min={2} max={60} onChange={v => v != null && setPage("titleBandMm", v)} />
              <Num label="Steps band" unit="mm" value={draft.page.stepsBandMm} step={0.5} min={2} max={60} onChange={v => v != null && setPage("stepsBandMm", v)} />
              <Num label="Gap between bands" unit="mm" value={draft.page.bandGapMm} step={0.5} min={0} max={20} onChange={v => v != null && setPage("bandGapMm", v)} />
              <Num label="Gap between blocks" unit="mm" value={draft.page.fieldGapMm} step={0.5} min={0} max={20} onChange={v => v != null && setPage("fieldGapMm", v)} />
              <Num label="Step number circle" unit="mm" value={draft.page.stepCircleMm} step={0.2} min={2} max={20} onChange={v => v != null && setPage("stepCircleMm", v)} />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-semibold">Width of the three steps (relative — step 2 holds both cooking lines)</p>
              <div className="grid grid-cols-3 gap-4">
                {([0, 1, 2] as const).map(i => (
                  <Num key={i} label={`Step ${i + 1}`} value={draft.page.stepWeights[i]} step={0.1} min={0.5} max={5}
                    onChange={v => v != null && setPage("stepWeights", draft.page.stepWeights.map((w, j) => (j === i ? v : w)) as [number, number, number])} />
                ))}
              </div>
            </div>
            <p className="text-sm text-muted-foreground">Nothing is ever printed inside the margin — keep it at least 4 mm on rounded labels, or the edges can get cut off.</p>
          </Card>

          {/* Barcode */}
          <Card icon={<Ruler className="w-5 h-5" />} title="Barcode (EAN-13)">
            <div className="grid grid-cols-2 gap-4">
              <Num label="Size" unit="% of standard" value={draft.page.barcodeSizePct} step={1} min={80} max={200} onChange={v => v != null && setPage("barcodeSizePct", v)} />
              <Num label="Bar height" unit="mm" value={draft.page.barcodeHeightMm} step={0.5} min={EAN13_MIN_BAR_HEIGHT_MM} max={60} onChange={v => v != null && setPage("barcodeHeightMm", v)} />
            </div>
            <p className="text-sm text-muted-foreground">
              Standard size is 100% (bars 0.33 mm, 22.85 mm tall). The bars are snapped to whole printer dots so they scan, so the printed size is the nearest dot size — the live proof shows it.
              Never smaller than 80% ({EAN13_MIN_BAR_HEIGHT_MM} mm bars). Clear space is kept either side (11 bars' width on the left, 7 on the right) and the digits sit underneath.
            </p>
          </Card>

          {/* Typography */}
          <Card icon={<Type className="w-5 h-5" />} title="Text styles">
            <p className="text-sm text-muted-foreground">Each block starts at its biggest size and steps down a quarter point at a time, trying the narrower widths first. If it still won't fit at its smallest, the label says DOESN'T FIT — nothing is ever cut off.</p>
            <div className="space-y-3">
              {FIELD_KEYS.map(f => (
                <FieldCard key={f} field={f} style={draft.fields[f]} legal={legalMin(f)} onChange={p => setField(f, p)} />
              ))}
            </div>
          </Card>

          {/* Wording */}
          <Card icon={<PenLine className="w-5 h-5" />} title="Wording">
            <div className="rounded-xl bg-secondary/40 p-3 text-sm space-y-1">
              <p><b>**word**</b> prints <b>word</b> in bold. Fill-ins: {Object.entries(TEMPLATE_PLACEHOLDERS).map(([k, v]) => <span key={k} className="inline-block mr-2"><code className="font-mono">{k}</code> {v.toLowerCase()};</span>)}</p>
              <p>In the cooking steps, a part in <code>[square brackets]</code> disappears when a number inside it is blank, and <code>{"{or}"}</code> joins two parts with “, or” only when both are there.</p>
              <p>A new line in a step starts a new line on the label, and each such line is kept whole (it shrinks rather than splitting). <code>➜</code> prints as an arrow.</p>
            </div>
            <div className="space-y-3">
              {TEXT_FIELDS.map(t => (
                <label key={t.key} className="flex flex-col gap-1">
                  <span className="text-sm font-semibold">{t.label}</span>
                  <textarea
                    value={draft.text[t.key]}
                    rows={t.rows ?? 1}
                    onChange={e => setText(t.key, e.target.value)}
                    onBlur={() => void auto.flush()}
                    className="rounded-xl border-2 border-border bg-card px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </label>
              ))}
            </div>
            <Toggle on={draft.mayContainBoldList} onChange={v => update(t => ({ ...t, mayContainBoldList: v }))} label="Print the may-contain list in bold" />
          </Card>

          {/* Cooking */}
          <Card icon={<Flame className="w-5 h-5" />} title="Standard cooking values">
            <p className="text-sm text-muted-foreground">Used by every recipe that doesn't set its own. Type the FULL cooking time — the label splits it either side of TURN OVER. Leave an appliance blank to drop its line.</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {COOKING_FIELDS.map(c => (
                <Num key={c.key} label={c.label} unit={c.unit} value={draft.cooking[c.key]} step={1} min={0} max={400} allowBlank onChange={v => setCooking(c.key, v)} />
              ))}
            </div>
            <StepPreview wording={draft.text.step2} cooking={draft.cooking} />
          </Card>

          {/* Dates */}
          <Card icon={<CalendarClock className="w-5 h-5" />} title="Use-by and batch number">
            <div className="flex flex-wrap items-end gap-3">
              <Num label="Standard chilled use-by" value={draft.chilledDefault?.amount ?? null} step={1} min={1} max={999} allowBlank
                onChange={v => update(t => ({ ...t, chilledDefault: v ? { amount: v, unit: t.chilledDefault?.unit ?? "days" } : null }))} />
              <select
                value={draft.chilledDefault?.unit ?? "days"}
                onChange={e => update(t => ({ ...t, chilledDefault: t.chilledDefault ? { ...t.chilledDefault, unit: e.target.value as PeriodUnit } : null }))}
                className={inputCls}
              >
                {PERIOD_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <Num label="Standard frozen use-by" value={draft.frozenDefault?.amount ?? null} step={1} min={1} max={999} allowBlank
                onChange={v => update(t => ({ ...t, frozenDefault: v ? { amount: v, unit: t.frozenDefault?.unit ?? "months" } : null }))} />
              <select
                value={draft.frozenDefault?.unit ?? "months"}
                onChange={e => update(t => ({ ...t, frozenDefault: t.frozenDefault ? { ...t.frozenDefault, unit: e.target.value as PeriodUnit } : null }))}
                className={inputCls}
              >
                {PERIOD_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <p className="text-sm text-muted-foreground">Chilled use-by: a recipe's own label setting first, then its shelf life, then this standard. Frozen: the recipe's own setting, else this standard.</p>
            <div className="space-y-2">
              <p className="text-sm font-semibold">Batch number (YYDDD) is taken from…</p>
              <div className="flex flex-wrap gap-2">
                {(["production-day", "print-day"] as const).map(b => (
                  <button key={b} type="button" onClick={() => update(t => ({ ...t, batchBasis: b }))}
                    className={cn("h-11 px-4 rounded-full border-2 text-sm font-bold", draft.batchBasis === b ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground")}>
                    {b === "production-day" ? "The production day" : "The day it's printed"}
                  </button>
                ))}
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function LivePreview({ template }: { template: LabelTemplate }) {
  const recipes = useQuery({
    queryKey: ["recipes-for-label-preview"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/recipes`, { credentials: "include" });
      if (!res.ok) throw new Error("Couldn't load recipes");
      return activeRecipes(await res.json() as Array<{ id: number; name: string; archivedAt?: string | null }>);
    },
  });
  const [recipeId, setRecipeId] = useState<number | null>(null);
  useEffect(() => {
    if (recipeId == null && recipes.data?.length) setRecipeId(recipes.data[0].id);
  }, [recipes.data, recipeId]);

  // Redraw shortly after typing stops.
  const json = useMemo(() => JSON.stringify(template), [template]);
  const [debounced, setDebounced] = useState(json);
  useEffect(() => { const t = setTimeout(() => setDebounced(json), 400); return () => clearTimeout(t); }, [json]);

  const preview = useQuery({
    queryKey: ["product-labels", "preview", recipeId, debounced],
    queryFn: () => api<{ recipeName: string; proof: Proof }>("/template/preview", { method: "POST", body: JSON.stringify({ recipeId, settings: JSON.parse(debounced) }) }),
    enabled: recipeId != null,
    placeholderData: keepPreviousData,
  });

  return (
    <section className="rounded-2xl border-2 border-border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-bold flex-1">Live proof</h2>
        {preview.isFetching && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}
        <select value={recipeId ?? ""} onChange={e => setRecipeId(Number(e.target.value))} className={inputCls} aria-label="Recipe to preview">
          {(recipes.data ?? []).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </div>
      {preview.data ? (
        <>
          <ProofImage proof={preview.data.proof} />
          {preview.data.proof.fits && preview.data.proof.contentProblems.length === 0
            ? <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">Fits. {preview.data.proof.fields.map(f => `${FIELD_LABEL[f.key]} ${f.sizePt} pt`).join(" · ")}</p>
            : (
              <ul className="list-disc pl-6 text-sm text-rose-700 dark:text-rose-400 space-y-1">
                {preview.data.proof.fitProblems.map(p => <li key={p.message}>{p.message}</li>)}
                {preview.data.proof.contentProblems.map(p => <li key={p}>{p}</li>)}
              </ul>
            )}
          <p className="text-xs text-muted-foreground flex items-start gap-1"><Info className="w-3.5 h-3.5 mt-0.5 shrink-0" /> The exact {preview.data.proof.dpi} dpi image the printer would get, with today as a sample date.</p>
        </>
      ) : preview.isError ? (
        <p className="text-destructive text-sm">Couldn't draw the proof — {(preview.error as Error).message}</p>
      ) : (
        <div className="flex items-center gap-2 text-muted-foreground py-10"><Loader2 className="w-5 h-5 animate-spin" /> Drawing…</div>
      )}
    </section>
  );
}

function FieldCard({ field, style, legal, onChange }: { field: FieldKey; style: FieldStyle; legal: number; onChange: (p: Partial<FieldStyle>) => void }) {
  const belowLegal = style.minPt < legal;
  const fixed = field === "headings";
  return (
    <div className="rounded-xl border-2 border-border p-3 space-y-3">
      <p className="font-bold text-base">{FIELD_LABEL[field]}</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <label className="flex flex-col gap-1 col-span-2">
          <span className="text-sm font-semibold">Font width</span>
          <select value={style.width} onChange={e => onChange({ width: e.target.value as WidthVariant })} className={inputCls}>
            {WIDTH_ORDER.map(w => <option key={w} value={w}>{WIDTH_LABEL[w]}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 col-span-2">
          <span className="text-sm font-semibold">Weight</span>
          <select value={style.weight} onChange={e => onChange({ weight: Number(e.target.value) as FieldStyle["weight"] })} className={inputCls}>
            {BODY_WEIGHTS.map(w => <option key={w} value={w}>{WEIGHT_LABEL[w]}</option>)}
          </select>
        </label>
        {fixed ? (
          // Section headings print at one fixed size — never shrunk.
          <Num label="Size (fixed)" unit="pt" value={style.maxPt} step={0.25} min={legal} max={72}
            onChange={v => v != null && onChange({ minPt: Math.max(v, legal), maxPt: Math.max(v, legal) })} />
        ) : (
          <>
            <Num label="Smallest" unit="pt" value={style.minPt} step={0.25} min={legal} max={72}
              onChange={v => v != null && onChange({ minPt: Math.max(v, legal), maxPt: Math.max(style.maxPt, Math.max(v, legal)) })} />
            <Num label="Biggest" unit="pt" value={style.maxPt} step={0.25} min={style.minPt} max={72} onChange={v => v != null && onChange({ maxPt: Math.max(v, style.minPt) })} />
          </>
        )}
        <Num label="Letter spacing" unit="em" value={style.letterSpacingEm} step={0.01} min={-0.05} max={0.2} onChange={v => v != null && onChange({ letterSpacingEm: v })} />
        <Num label="Line height" unit="×" value={style.lineHeight} step={0.02} min={0.8} max={2} onChange={v => v != null && onChange({ lineHeight: v })} />
      </div>
      <p className={cn("text-xs", belowLegal ? "text-destructive font-semibold" : "text-muted-foreground")}>Legal minimum for this block: {legal} pt.</p>
      {fixed && <p className="text-sm text-muted-foreground">One style for “STORAGE INSTRUCTIONS:” and “THE INGREDIENTS:”, so they always match. They stay this size — only the text under them shrinks to fit.</p>}
      <div className="flex flex-wrap gap-2">
        {!fixed && <Toggle on={style.allowNarrower} onChange={v => onChange({ allowNarrower: v })} label="Go narrower before smaller" />}
        <Toggle on={style.bold} onChange={v => onChange({ bold: v })} label="All bold" />
        <Toggle on={style.caps} onChange={v => onChange({ caps: v })} label="CAPITALS" />
        <Toggle on={style.align === "center"} onChange={v => onChange({ align: v ? "center" : "left" })} label="Centred" />
      </div>
    </div>
  );
}

function Card({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border-2 border-border bg-card p-5 space-y-4">
      <h2 className="text-xl font-bold flex items-center gap-2"><span className="text-primary">{icon}</span>{title}</h2>
      {children}
    </section>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" onClick={() => onChange(!on)} aria-pressed={on}
      className={cn("min-h-11 px-4 py-2 rounded-full border-2 text-sm font-bold text-left", on ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground")}>
      {on ? "✓ " : ""}{label}
    </button>
  );
}

/** Number box that keeps what's typed while focused ("6." is fine) and
 *  hands back a clamped number — or null when blank and allowBlank. */
function Num({ label, unit, value, step, min, max, allowBlank, onChange }: {
  label: string; unit?: string; value: number | null; step: number; min: number; max: number; allowBlank?: boolean;
  onChange: (v: number | null) => void;
}) {
  const [text, setText] = useState(value == null ? "" : String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setText(value == null ? "" : String(value)); }, [value, focused]);
  const commit = (t: string) => {
    if (t.trim() === "") { if (allowBlank) onChange(null); return; }
    const n = Number(t);
    if (!Number.isFinite(n)) return;
    onChange(Math.min(max, Math.max(min, Math.round(n / step) * step)));
  };
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-semibold">{label}</span>
      <span className="flex items-center gap-1.5">
        <input
          inputMode="decimal"
          value={text}
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); commit(text); }}
          onChange={e => { setText(e.target.value); const n = Number(e.target.value); if (e.target.value.trim() !== "" && Number.isFinite(n) && n >= min && n <= max) onChange(n); else if (allowBlank && e.target.value.trim() === "") onChange(null); }}
          className={cn(inputCls, "w-24")}
        />
        {unit && <span className="text-muted-foreground text-sm">{unit}</span>}
      </span>
    </label>
  );
}
