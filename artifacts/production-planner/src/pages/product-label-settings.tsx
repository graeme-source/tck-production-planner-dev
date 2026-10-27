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
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Info, Loader2, Type, Ruler, Flame, CalendarClock, PenLine, ShieldCheck, Snowflake, Scale } from "lucide-react";
import {
  allowedWidths, barsShorterThanGs1, BODY_WEIGHTS, dividerDots, labelFormat, EAN13_GS1_MIN_BAR_HEIGHT_MM, EAN13_MIN_BAR_HEIGHT_MM, FIELD_KEYS, MAX_STEPS, FIELD_LABEL, PERIOD_UNITS, TEMPLATE_PLACEHOLDERS, WIDTH_LABEL, WIDTH_ORDER,
  type CookingValues, type FieldKey, type FieldStyle, type LabelTemplate, type PeriodUnit, type TemplateText, type WidthVariant,
} from "@workspace/product-labels";
import { PageHeader } from "@/components/page-header";
import { SaveChip } from "@/components/save-chip";
import { useAuth } from "@/contexts/auth-context";
import { useAutosave } from "@/hooks/use-autosave";
import { activeRecipes } from "@/lib/recipe-archive";
import { cn } from "@/lib/utils";
import { api, useInvalidateLabels, useLabelTemplate, useLabelTemplates, type Proof, type TemplateList, type TemplatePayload } from "@/components/product-labels/api";
import { ProofImage } from "@/components/product-labels/proof-image";
import { StepPreview } from "@/components/product-labels/step-preview";
import { MayContainEditor } from "@/components/product-labels/may-contain-editor";
import { Num, Toggle } from "@/components/product-labels/form-bits";
import { CookingTiersEditor } from "@/components/product-labels/cooking-tiers-editor";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const inputCls = "h-11 rounded-xl border-2 border-border bg-card px-3 text-base font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60";
const WEIGHT_LABEL: Record<number, string> = { 400: "Regular", 500: "Medium", 700: "Bold" };

type SingleTextKey = Exclude<keyof TemplateText, "steps">;
const TEXT_FIELDS: Array<{ key: SingleTextKey; label: string; rows?: number }> = [
  { key: "title", label: "Title" },
  { key: "subtitle", label: "Subtitle — a small line under the title (blank = none)" },
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
  // Which template is being edited (?template=N in the address); none = the standard one.
  const [templateId, setTemplateId] = useState<number | null>(() => {
    const n = Number(new URLSearchParams(window.location.search).get("template"));
    return Number.isInteger(n) && n > 0 ? n : null;
  });
  const q = useLabelTemplate(templateId);
  const list = useLabelTemplates();
  const pick = (id: number | null) => {
    setTemplateId(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("template", String(id)); else url.searchParams.delete("template");
    window.history.replaceState(null, "", url);
  };
  if (!canEdit) return <p className="text-muted-foreground">Only managers and admins can change the label design. <Link href="/labels" className="underline">Back to labels</Link></p>;
  return (
    <div className="space-y-5">
      <TemplatePicker list={list.data} currentId={q.data?.id ?? null} onPick={pick} />
      {q.isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-10"><Loader2 className="w-5 h-5 animate-spin" /> Loading the label design…</div>
      ) : q.isError || !q.data ? (
        <p className="text-destructive">Couldn't load the label design — {(q.error as Error | null)?.message}</p>
      ) : (
        <Editor key={q.data.id} initial={q.data} reload={() => void q.refetch()} />
      )}
    </div>
  );
}

/** Choose which label template to edit, or add one from a starting design
 *  (e.g. Fried chicken). Recipes pick their template in their own label
 *  settings; with none picked they use the standard one. */
function TemplatePicker({ list, currentId, onPick }: { list: TemplateList | undefined; currentId: number | null; onPick: (id: number | null) => void }) {
  const invalidate = useInvalidateLabels();
  const add = useMutation({
    mutationFn: (preset: string) => api<TemplatePayload>("/templates", { method: "POST", body: JSON.stringify({ preset }) }),
    onSuccess: res => { void invalidate(); onPick(res.id); },
  });
  if (!list) return null;
  const toAdd = list.presets.filter(p => !p.added);
  return (
    <section className="rounded-2xl border-2 border-border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold mr-1">Label template:</span>
        {list.templates.map(t => (
          <button key={t.id} type="button" onClick={() => onPick(t.isDefault ? null : t.id)} aria-pressed={t.id === currentId}
            className={cn("min-h-11 px-4 rounded-full border-2 text-sm font-bold", t.id === currentId ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-secondary")}>
            {t.name}{t.isDefault ? " (standard)" : ""} <span className="font-normal">· {t.sizeText}</span>
          </button>
        ))}
      </div>
      {toAdd.map(p => (
        <div key={p.key} className="flex flex-wrap items-center gap-3">
          <button type="button" disabled={add.isPending} onClick={() => add.mutate(p.key)}
            className="min-h-11 px-4 rounded-xl border-2 border-dashed border-border text-sm font-semibold hover:bg-secondary disabled:opacity-60">
            {add.isPending ? <Loader2 className="inline w-4 h-4 animate-spin" /> : "+"} Add the “{p.name}” template
          </button>
          <span className="text-sm text-muted-foreground">{p.sizeText}. {p.description}</span>
        </div>
      ))}
      {add.isError && <p className="text-sm font-semibold text-destructive">Couldn't add it — {(add.error as Error).message}</p>}
      <p className="text-sm text-muted-foreground">Each recipe picks its template in its own label settings; recipes that haven't picked one use the template set as the default for their recipe category (below, in each design), else the standard template.</p>
    </section>
  );
}

function Editor({ initial, reload }: { initial: TemplatePayload; reload: () => void }) {
  const invalidate = useInvalidateLabels();
  const [draft, setDraft] = useState<LabelTemplate>(initial.template);
  const [meta, setMeta] = useState(initial);
  const versionRef = useRef(initial.version);
  const [raisedNote, setRaisedNote] = useState<string | null>(null);
  // Fixed when the template was made: decides which settings apply.
  const format = labelFormat(draft);

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
  const setText = (k: SingleTextKey, v: string) => update(t => ({ ...t, text: { ...t.text, [k]: v } }));
  const setSteps = (steps: string[]) => update(t => ({ ...t, text: { ...t.text, steps } }));
  const setCooking = (k: keyof CookingValues, v: number | null) => update(t => ({ ...t, cooking: { ...t.cooking, [k]: v } }));

  // Legal minimum for a field = the largest across the widths it may use.
  const legalMin = (f: FieldKey) => {
    const st = draft.fields[f];
    const widths = allowedWidths(st);
    const m = meta.legalMinimums[f];
    const base = Math.max(...widths.map(w => m?.[w] ?? 0));
    // Server figures are for the saved small-pack setting; adjust if it was just flipped.
    if (draft.page.smallPack === meta.template.page.smallPack) return base;
    return Math.ceil((base * (draft.page.smallPack ? 0.9 / 1.2 : 1.2 / 0.9)) / 0.25) * 0.25;
  };

  return (
    <div className="space-y-5">
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
          {!format.backLabel && (
            <Card icon={<Ruler className="w-5 h-5" />} title="Small label">
              <p className="text-base font-semibold">Size: {format.sizeText} <span className="text-sm font-normal text-muted-foreground">— fixed for this template</span></p>
              <p className="text-sm text-muted-foreground">Prints the recipe's name on the label (in capitals), USE BY from its use-by period, the batch number and its barcode — EAN-13, or Code 128 for longer codes like Shopify's. The layout is fixed and kept plain; there are no fonts, wording or cooking steps to set.</p>
              <CategoryDefaults categories={draft.defaultForCategories} onChange={defaultForCategories => update(t => ({ ...t, defaultForCategories }))} />
            </Card>
          )}
          {format.backLabel && (<>
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
              {/* The size is the template's, fixed when it was made (formats.ts). */}
              <p className="col-span-full text-base font-semibold">Size: {format.sizeText} <span className="text-sm font-normal text-muted-foreground">— fixed for this template</span></p>
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
              {/* Blank = the same as the gap between blocks. Tighter here gives a long deck room (fried chicken, 2026-10-27). */}
              <Num label="Gaps under the ingredients" unit="mm" value={draft.page.ingredientsGapMm} step={0.5} min={0} max={20} allowBlank placeholder={`${draft.page.fieldGapMm} (same)`} onChange={v => setPage("ingredientsGapMm", v)} />
              {!draft.page.stepCircleAuto && (
                <Num label="Step number circle" unit="mm" value={draft.page.stepCircleMm} step={0.2} min={2} max={20} onChange={v => v != null && setPage("stepCircleMm", v)} />
              )}
            </div>
            <Toggle on={draft.page.stepCircleAuto} onChange={v => setPage("stepCircleAuto", v)} label="Step numbers as tall as the step text" />
            <div className="flex flex-wrap items-end gap-4">
              <Toggle on={draft.page.dividerOn} onChange={v => setPage("dividerOn", v)} label="Thin line under the cooking steps" />
              {draft.page.dividerOn && (
                <Num label="Line thickness" unit={`mm (${dividerDots(draft.page)} printer dot${dividerDots(draft.page) === 1 ? "" : "s"})`} value={draft.page.dividerMm} step={0.05} min={0.05} max={2} onChange={v => v != null && setPage("dividerMm", v)} />
              )}
            </div>
            <p className="text-sm text-muted-foreground">The line splits the label into “how to cook” and “what's in it”. It sits in the middle of the gap between bands, so keep that gap at least 3 mm so it stays clear of the text either side.</p>
            <p className="text-sm text-muted-foreground">The steps share their row automatically: a step written as whole lines (the cooking times) gets exactly the width it needs, the others share the rest.</p>
            <p className="text-sm text-muted-foreground">Nothing is ever printed inside the margin — keep it at least 4 mm on rounded labels, or the edges can get cut off.</p>
          </Card>

          {/* Barcode */}
          <Card icon={<Ruler className="w-5 h-5" />} title="Barcode (EAN-13)">
            <div className="grid grid-cols-2 gap-4">
              <Num label="Size" unit="% of standard" value={draft.page.barcodeSizePct} step={1} min={80} max={200} onChange={v => v != null && setPage("barcodeSizePct", v)} />
              <Num label="Bar height" unit="mm" value={draft.page.barcodeHeightMm} step={0.5} min={EAN13_MIN_BAR_HEIGHT_MM} max={60} onChange={v => v != null && setPage("barcodeHeightMm", v)} />
            </div>
            {barsShorterThanGs1(draft.page.barcodeHeightMm) && (
              <p className="rounded-xl border-2 border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3 text-sm font-semibold">
                Shorter than GS1's recommended height — fine for handheld scanners; check it scans before going live.
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              Standard size is 100% (bars 0.33 mm, 22.85 mm tall). The bars are snapped to whole printer dots so they scan, so the printed size is the nearest dot size — the live proof shows it.
              Width never under 80%; bars never under {EAN13_MIN_BAR_HEIGHT_MM} mm (GS1 recommends at least {EAN13_GS1_MIN_BAR_HEIGHT_MM} mm). Clear space is kept either side (11 bars' width on the left, 7 on the right) and the digits sit underneath.
            </p>
          </Card>

          {/* Typography */}
          <Card icon={<Type className="w-5 h-5" />} title="Text styles">
            <p className="text-sm text-muted-foreground">Each block starts at its biggest size and steps down a quarter point at a time, trying the narrower widths first — but never narrower than its “Narrowest width”. If it still won't fit at its smallest, the label says DOESN'T FIT — nothing is ever cut off.</p>
            <p className="text-sm text-muted-foreground">Barlow Condensed is hard to read in small print, bold allergen words most of all — keep body text at Barlow Semi Condensed or wider and let it get a little smaller instead.</p>
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
            {/* Numbered steps — a list: blank ones aren't printed, numbering closes up. */}
            <div className="space-y-3 rounded-xl border-2 border-border p-3">
              <p className="text-sm font-bold">Numbered steps</p>
              {draft.text.steps.map((s, i) => (
                <div key={i} className="flex gap-2 items-start">
                  <span className="mt-2 w-8 h-8 shrink-0 rounded-full bg-foreground text-background font-bold flex items-center justify-center">{i + 1}</span>
                  <textarea
                    value={s}
                    rows={s.includes("\n") ? 3 : 2}
                    onChange={e => setSteps(draft.text.steps.map((x, j) => (j === i ? e.target.value : x)))}
                    onBlur={() => void auto.flush()}
                    aria-label={`Step ${i + 1}`}
                    className="flex-1 rounded-xl border-2 border-border bg-card px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  <button type="button" onClick={() => setSteps(draft.text.steps.filter((_, j) => j !== i))}
                    className="mt-1 h-11 px-3 rounded-xl border-2 border-border text-sm font-semibold hover:bg-secondary" aria-label={`Remove step ${i + 1}`}>
                    Remove
                  </button>
                </div>
              ))}
              {draft.text.steps.length < MAX_STEPS && (
                <button type="button" onClick={() => setSteps([...draft.text.steps, ""])}
                  className="h-11 px-4 rounded-xl border-2 border-dashed border-border text-sm font-semibold hover:bg-secondary">
                  + Add a step
                </button>
              )}
              <p className="text-xs text-muted-foreground">An empty step isn't printed and the numbers close up.</p>
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
            <Toggle on={draft.allergenNoteAfterMayContain} onChange={v => update(t => ({ ...t, allergenNoteAfterMayContain: v }))} label="Run the allergen note on after the may-contain sentence (saves a line under a long ingredient list)" />
            <BoneWords words={draft.boneRiskWords} onChange={boneRiskWords => update(t => ({ ...t, boneRiskWords }))} />
            <CategoryDefaults categories={draft.defaultForCategories} onChange={defaultForCategories => update(t => ({ ...t, defaultForCategories }))} />
          </Card>

          {/* Frozen products & extra lines (fried chicken, 2026-10-12) */}
          <Card icon={<Snowflake className="w-5 h-5" />} title="Frozen products and extra lines">
            <div className="space-y-3">
              <Toggle on={draft.storageBanner.on} onChange={on => update(t => ({ ...t, storageBanner: { ...t.storageBanner, on } }))} label="Black storage band at the top of the storage column" />
              {draft.storageBanner.on && (
                <div className="flex flex-wrap items-end gap-4 pl-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-sm font-semibold">Band words</span>
                    <input value={draft.storageBanner.text} maxLength={40} onChange={e => update(t => ({ ...t, storageBanner: { ...t.storageBanner, text: e.target.value } }))} onBlur={() => void auto.flush()} className={cn(inputCls, "w-56")} />
                  </label>
                  <Num label="Band height" unit="mm" value={draft.storageBanner.heightMm} step={0.5} min={3} max={20} onChange={v => v != null && update(t => ({ ...t, storageBanner: { ...t.storageBanner, heightMm: v } }))} />
                  <Toggle on={draft.storageBanner.snowflake} onChange={snowflake => update(t => ({ ...t, storageBanner: { ...t.storageBanner, snowflake } }))} label="Snowflakes" />
                </div>
              )}
              <Toggle on={draft.chilledUseByOn} onChange={chilledUseByOn => update(t => ({ ...t, chilledUseByOn }))} label="Print the chilled use-by line (off = frozen use-by only)" />
              {!draft.chilledUseByOn && <p className="text-sm text-muted-foreground pl-2">Only the frozen use-by prints, labelled with the “Frozen use-by label” wording (e.g. “USE BY:”).</p>}
              {/* Best before above the use-by, from the print (despatch) day —
                  cinnamon buns: + 3 days (Graeme, 2026-10-27). */}
              <div className="flex flex-wrap items-end gap-4">
                <Toggle on={draft.bestBefore.on} onChange={on => update(t => ({ ...t, bestBefore: { ...t.bestBefore, on } }))} label="Best before line (from the despatch day)" />
                {draft.bestBefore.on && (
                  <>
                    <label className="text-sm font-semibold space-y-1">
                      <span className="block">Best before label</span>
                      <input value={draft.bestBefore.label} onChange={e => { const label = e.target.value; update(t => ({ ...t, bestBefore: { ...t.bestBefore, label } })); }} className={inputCls} />
                    </label>
                    <Num label="Best before" unit="days after despatch" value={draft.bestBefore.period.amount} step={1} min={1} max={365}
                      onChange={v => v != null && update(t => ({ ...t, bestBefore: { ...t.bestBefore, period: { amount: v, unit: "days" } } }))} />
                  </>
                )}
              </div>
              <div className="flex flex-wrap items-end gap-4">
                <Toggle on={draft.netQuantity.on} onChange={on => update(t => ({ ...t, netQuantity: { ...t.netQuantity, on } }))} label="Net quantity line above the barcode" />
                {draft.netQuantity.on && (
                  <Num label="Net quantity size" unit="pt" value={draft.netQuantity.sizePt} step={0.5} min={6.75} max={40} onChange={v => v != null && update(t => ({ ...t, netQuantity: { ...t.netQuantity, sizePt: v } }))} />
                )}
              </div>
              {draft.netQuantity.on && <p className="text-sm text-muted-foreground pl-2">Each recipe types its own (e.g. 500g) in its label settings; a label can't go live without it.</p>}
              <Toggle on={draft.warningPlacement === "storage"} onChange={v => update(t => ({ ...t, warningPlacement: v ? "storage" : "allergens" }))} label="Put the bones warning under the storage text (off = with the allergens)" />
            </div>
          </Card>

          {/* Cooking */}
          <Card icon={<Flame className="w-5 h-5" />} title="Standard cooking values">
            <p className="text-sm text-muted-foreground">Used by every recipe that doesn't set its own. Type the FULL cooking time — the label splits it either side of TURN OVER. Leave an appliance blank to drop its line.</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {COOKING_FIELDS.map(c => (
                <Num key={c.key} label={c.label} unit={c.unit} value={draft.cooking[c.key]} step={1} min={0} max={400} allowBlank onChange={v => setCooking(c.key, v)} />
              ))}
            </div>
            <StepPreview steps={draft.text.steps} cooking={draft.cooking} />
          </Card>

          {/* Suggested cooking times by weight */}
          <Card icon={<Scale className="w-5 h-5" />} title="Cooking times by weight">
            <CookingTiersEditor template={draft} onChange={cookingTiers => update(t => ({ ...t, cookingTiers }))} />
          </Card>
          </>)}

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
            {format.backLabel && <div className="flex flex-wrap items-end gap-3">
              <Num label="Standard frozen use-by" value={draft.frozenDefault?.amount ?? null} step={1} min={1} max={999} allowBlank
                onChange={v => update(t => ({ ...t, frozenDefault: v ? { amount: v, unit: t.frozenDefault?.unit ?? "months" } : null }))} />
              <select
                value={draft.frozenDefault?.unit ?? "months"}
                onChange={e => update(t => ({ ...t, frozenDefault: t.frozenDefault ? { ...t.frozenDefault, unit: e.target.value as PeriodUnit } : null }))}
                className={inputCls}
              >
                {PERIOD_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>}
            <p className="text-sm text-muted-foreground">Chilled use-by: the recipe's shelf life (one source of truth — set on the recipe or its label page); this standard only for a recipe with none.{format.backLabel ? " Frozen: the recipe's own setting, else this standard." : ""}</p>
            {/* A despatch label counts a fixed period from the day it's
                printed (= despatched), whatever the recipe's shelf life
                (shelf-life.ts — cinnamon buns, 2026-10-27). */}
            <div className="space-y-2">
              <p className="text-sm font-semibold">The use-by counts…</p>
              <div className="flex flex-wrap items-end gap-2">
                <button type="button" onClick={() => update(t => ({ ...t, useBy: { from: "recipe-shelf-life" } }))}
                  className={cn("h-11 px-4 rounded-full border-2 text-sm font-bold", draft.useBy.from === "recipe-shelf-life" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground")}>
                  The recipe's shelf life
                </button>
                <button type="button" onClick={() => update(t => ({ ...t, useBy: { from: "despatch", period: t.useBy.from === "despatch" ? t.useBy.period : { amount: 5, unit: "days" } } }))}
                  className={cn("h-11 px-4 rounded-full border-2 text-sm font-bold", draft.useBy.from === "despatch" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground")}>
                  A fixed period from despatch
                </button>
                {draft.useBy.from === "despatch" && (
                  <Num label="Use by" unit="days after despatch" value={draft.useBy.period.amount} step={1} min={1} max={365}
                    onChange={v => v != null && update(t => ({ ...t, useBy: { from: "despatch", period: { amount: v, unit: "days" } } }))} />
                )}
              </div>
              {draft.useBy.from === "despatch" && <p className="text-sm text-muted-foreground">For a despatch label, printed the day the product goes out: the recipe's shelf life isn't used on it.</p>}
            </div>
            {!format.backLabel && (
              <Toggle on={draft.barcodeOn} onChange={on => update(t => ({ ...t, barcodeOn: on }))} label="Print the product's barcode (off = an internal label with none)" />
            )}
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

          {/* Shared by every deck and label; saved on its own, not part of
              the template version above. Moved from the old Product Hub. */}
          {format.backLabel && <MayContainEditor />}
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
          <select value={style.width} onChange={e => {
            const width = e.target.value as WidthVariant;
            // The narrowest can't be wider than the preferred width.
            const narrowest = fixed || WIDTH_ORDER.indexOf(style.narrowest) < WIDTH_ORDER.indexOf(width) ? width : style.narrowest;
            onChange({ width, narrowest });
          }} className={inputCls}>
            {WIDTH_ORDER.map(w => <option key={w} value={w}>{WIDTH_LABEL[w]}</option>)}
          </select>
        </label>
        {!fixed && (
          <label className="flex flex-col gap-1 col-span-2">
            <span className="text-sm font-semibold">Narrowest width</span>
            <select value={style.narrowest} onChange={e => onChange({ narrowest: e.target.value as WidthVariant })} className={inputCls}>
              {WIDTH_ORDER.slice(WIDTH_ORDER.indexOf(style.width)).map(w => (
                <option key={w} value={w}>{w === style.width ? `${WIDTH_LABEL[w]} (never narrower)` : WIDTH_LABEL[w]}</option>
              ))}
            </select>
          </label>
        )}
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
        <Toggle on={style.bold} onChange={v => onChange({ bold: v })} label="All bold" />
        <Toggle on={style.caps} onChange={v => onChange({ caps: v })} label="CAPITALS" />
        <Toggle on={style.align === "center"} onChange={v => onChange({ align: v ? "center" : "left" })} label="Centred" />
      </div>
    </div>
  );
}

/** The words that switch the bones warning on for recipes left on
 *  Automatic. Saved with the rest of the design (autosave). */
function BoneWords({ words, onChange }: { words: string[]; onChange: (w: string[]) => void }) {
  const [text, setText] = useState("");
  const add = () => {
    const w = text.trim().replace(/\s+/g, " ");
    if (!w) return;
    if (!words.some(x => x.toLowerCase() === w.toLowerCase())) onChange([...words, w]);
    setText("");
  };
  return (
    <div className="space-y-2 rounded-xl border-2 border-border p-3">
      <p className="font-bold">Bones warning — automatic words</p>
      <p className="text-sm text-muted-foreground">
        A recipe left on “Automatic” prints the bones warning when any of these words is in its ingredients (sub-recipes included; whole words, any capitals — “chicken” finds “Chicken Thigh” but not “chickpea”). With no words, Automatic is always off. Any recipe can still be set to always on or always off.
      </p>
      <div className="flex flex-wrap gap-2">
        {words.length === 0 && <span className="text-sm font-semibold text-amber-700 dark:text-amber-400">No words — Automatic never prints the warning.</span>}
        {words.map(w => (
          <span key={w} className="inline-flex items-center gap-2 h-11 pl-4 pr-1 rounded-full border-2 border-primary bg-primary/10 text-primary font-bold text-sm">
            {w}
            <button type="button" onClick={() => onChange(words.filter(x => x !== w))} aria-label={`Remove ${w}`}
              className="h-9 w-9 rounded-full hover:bg-primary/20 font-bold">×</button>
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder="Add a word, e.g. lamb" aria-label="Add a word" className={cn(inputCls, "w-56")} />
        <button type="button" onClick={add} className="h-11 px-4 rounded-xl border-2 border-border text-sm font-semibold hover:bg-secondary">Add</button>
      </div>
    </div>
  );
}

/** Recipe categories that get this template when a recipe hasn't picked
 *  one (e.g. "Macaroni Cheese"). Saved with the rest of the design. */
function CategoryDefaults({ categories, onChange }: { categories: string[]; onChange: (c: string[]) => void }) {
  const [text, setText] = useState("");
  const add = () => {
    const c = text.trim().replace(/\s+/g, " ");
    if (!c) return;
    if (!categories.some(x => x.toLowerCase() === c.toLowerCase())) onChange([...categories, c]);
    setText("");
  };
  return (
    <div className="space-y-2 rounded-xl border-2 border-border p-3">
      <p className="font-bold">Default for recipe categories</p>
      <p className="text-sm text-muted-foreground">
        A recipe in one of these categories (as set on the recipe page, any capitals) uses this template unless its own label settings pick another. So a new product in the category gets the right label from the start. Recipes in no listed category use the standard template.
      </p>
      <div className="flex flex-wrap gap-2">
        {categories.length === 0 && <span className="text-sm text-muted-foreground">None — recipes only get this template by picking it.</span>}
        {categories.map(c => (
          <span key={c} className="inline-flex items-center gap-2 h-11 pl-4 pr-1 rounded-full border-2 border-primary bg-primary/10 text-primary font-bold text-sm">
            {c}
            <button type="button" onClick={() => onChange(categories.filter(x => x !== c))} aria-label={`Remove ${c}`}
              className="h-9 w-9 rounded-full hover:bg-primary/20 font-bold">×</button>
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder="Add a category, e.g. Desserts" aria-label="Add a recipe category" className={cn(inputCls, "w-64")} />
        <button type="button" onClick={add} className="h-11 px-4 rounded-xl border-2 border-border text-sm font-semibold hover:bg-secondary">Add</button>
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
