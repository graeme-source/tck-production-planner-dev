/**
 * "Targets" — the founder's one menu (Graeme, 5 Nov 2026): the monthly sales
 * MINIMUM and each month's STRETCH (2026-10-08), readable and editable per month
 * or per day, one target either way, then every other Numbers panel's. Objective I.
 *
 * Changing a target by accident must be hard, so saving is a double
 * confirmation: (1) a plain list of exactly what will change, then (2) a
 * deliberate tick on "Yes, change the targets" before Confirm works. After
 * saving, a toast offers Undo (which puts back exactly what changed).
 *
 * Only rendered for the founder (canEdit); the server refuses anyone else.
 * Closable (X / backdrop / Cancel), max-h-[92dvh] with internal scrolling.
 */
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { format, parseISO } from "date-fns";
import { ArrowLeft, Check, Loader2, Pencil, ShieldCheck, Target, X } from "lucide-react";
import {
  applyChanges, daysInMonth, describeChanges, diffTargets, formatGbp, invertChanges, monthLabel, monthsFrom, parseAmount, resolveStretch,
  stretchBelowMinimum, type TargetChange, type TargetsState,
} from "@workspace/revenue-targets";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { BenchmarkRows } from "@/components/numbers-benchmarks/benchmarks-dialog";
import { dailyFromMonthly, monthlyFromDaily } from "@/lib/numbers-benchmarks";
import { useRevenueTargets, useSaveTargetChanges, type RevenueTargetsPayload } from "./api";

const WINDOW = 13;

/** The dialog, for the button or a sales panel's pencil to open. */
export function useTargetsEditor() {
  const { data } = useRevenueTargets();
  // The save lives here, not in the dialog, so the toast's Undo still works
  // after the dialog has closed.
  const save = useSaveTargetChanges();
  const [isOpen, setOpen] = useState(false);

  const undo = (applied: TargetChange[], before: TargetsState) => {
    save.mutate(invertChanges(applied), {
      onSuccess: () => toast({
        title: "Targets put back",
        description: describeChanges(applyChanges(before, applied), invertChanges(applied)).join(" · "),
      }),
      onError: (e: Error) => toast({ title: "Couldn't undo", description: e.message, variant: "destructive" }),
    });
  };
  return {
    canEdit: !!data?.canEdit,
    open: () => setOpen(true),
    element: isOpen && data?.canEdit
      ? <EditTargetsDialog data={data} save={save} onUndo={undo} onClose={() => setOpen(false)} />
      : null,
  };
}

/** The button + dialog. Renders nothing unless this person may edit. */
export function EditTargetsButton({ className }: { className?: string }) {
  const editor = useTargetsEditor();
  if (!editor.canEdit) return null;
  return (
    <>
      <button
        type="button"
        onClick={editor.open}
        className={cn("inline-flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-xl border-2 border-border bg-card hover:bg-secondary/60", className)}
      >
        <Target className="w-4 h-4 text-primary" /> Targets
      </button>
      {editor.element}
    </>
  );
}

const asText = (n: number | null | undefined) => (n == null ? "" : Math.round(n).toLocaleString("en-GB"));

function EditTargetsDialog({ data, save, onUndo, onClose }: {
  data: RevenueTargetsPayload;
  save: ReturnType<typeof useSaveTargetChanges>;
  onUndo: (applied: TargetChange[], before: TargetsState) => void;
  onClose: () => void;
}) {
  const months = useMemo(() => monthsFrom(data.currentMonth, WINDOW), [data.currentMonth]);
  const before: TargetsState = useMemo(() => ({ minimum: data.minimum, rows: data.rows, minimums: data.minimums }), [data]);
  const ownByMonth = useMemo(() => new Map(data.rows.map(r => [r.month, r.stretch])), [data.rows]);

  const [minText, setMinText] = useState(asText(data.minimum));
  const [stretchText, setStretchText] = useState<Record<string, string>>(
    () => Object.fromEntries(months.map(m => [m, asText(ownByMonth.get(m))])),
  );
  const [monthMinText, setMonthMinText] = useState<Record<string, string>>(
    () => Object.fromEntries(months.map(m => [m, asText(data.minimums.find(r => r.month === m)?.minimum)])),
  );
  const [step, setStep] = useState<"edit" | "review" | "confirm">("edit");
  const [ticked, setTicked] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // The edited state: rows outside the 13 months are untouched (earlier
  // ones still carry forward into this month).
  const minParsed = parseAmount(minText);
  const badMonths = months.filter(m => stretchText[m]!.trim() !== "" && parseAmount(stretchText[m]!) == null);
  const badMinMonths = months.filter(m => monthMinText[m]!.trim() !== "" && parseAmount(monthMinText[m]!) == null);
  const after: TargetsState = {
    minimum: minParsed ?? data.minimum,
    rows: [
      ...data.rows.filter(r => !months.includes(r.month)),
      ...months.flatMap(m => {
        const v = parseAmount(stretchText[m] ?? "");
        return v == null ? [] : [{ month: m, stretch: v }];
      }),
    ].sort((a, b) => a.month.localeCompare(b.month)),
    minimums: [
      ...data.minimums.filter(r => !months.includes(r.month)),
      ...months.flatMap(m => {
        const v = parseAmount(monthMinText[m] ?? "");
        return v == null ? [] : [{ month: m, minimum: v }];
      }),
    ].sort((a, b) => a.month.localeCompare(b.month)),
  };
  const belowMin = stretchBelowMinimum(after, months);
  const changes: TargetChange[] = diffTargets(before, after);
  const minInvalid = minParsed == null;
  const canReview = !minInvalid && badMonths.length === 0 && badMinMonths.length === 0 && belowMin.length === 0 && changes.length > 0;
  const summary = describeChanges(before, changes);

  const close = () => { if (!save.isPending) onClose(); };

  const confirm = () => {
    setSaveError(null);
    save.mutate(changes, {
      onSuccess: (res) => {
        onClose();
        const applied = res.applied;
        toast({
          title: "Targets changed",
          // Long enough to read the change and reach Undo on an iPad.
          duration: 20_000,
          description: describeChanges(before, applied).join(" · "),
          action: (
            <ToastAction altText="Undo the target change" onClick={() => onUndo(applied, before)}>Undo</ToastAction>
          ),
        });
      },
      onError: (e: Error) => setSaveError(e.message),
    });
  };

  return createPortal(
    // A tap outside closes only while nothing has been typed — a stray tap
    // must not throw away a year of stretch targets. X and Cancel always close.
    <div className="fixed inset-0 z-[130] bg-black/70 flex items-center justify-center p-3 md:p-8"
      onClick={() => { if (changes.length === 0) close(); }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-targets-title"
        className="bg-card border-2 border-border rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92dvh] flex flex-col overflow-hidden text-left font-normal text-foreground"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <Target className="w-6 h-6 text-primary flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <h2 id="edit-targets-title" className="font-display font-bold text-xl leading-tight">
              {step === "edit" ? "Targets" : step === "review" ? "Check the changes" : "Confirm the change"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {step === "edit" ? "Monthly sales first, then every other panel on Numbers."
                : step === "review" ? "Step 1 of 2 — this is exactly what will change."
                  : "Step 2 of 2 — tick the box to make it final."}
            </p>
          </div>
          <button onClick={close} disabled={save.isPending} className="p-2 rounded-lg hover:bg-secondary" aria-label="Close">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {step === "edit" && (
            <>
              <section className="space-y-2">
                <label htmlFor="target-minimum" className="text-base font-semibold block">Default sales minimum</label>
                <div className="grid grid-cols-2 gap-2 max-w-md">
                  <AmountInput id="target-minimum" value={minText} onChange={setMinText} invalid={minInvalid} ariaLabel="Default minimum per month" />
                  <DailyAmount monthly={minText} days={daysInMonth(data.currentMonth)} onMonthly={setMinText} ariaLabel="Default minimum per day" />
                </div>
                {minInvalid
                  ? <p className="text-sm text-red-600">Type an amount, e.g. 110,000 or 110k.</p>
                  : <p className="text-sm text-muted-foreground">Used for any month without its own minimum below.</p>}
              </section>

              <section className="space-y-2">
                <h3 className="text-base font-semibold">Sales targets by month</h3>
                <p className="text-sm text-muted-foreground">
                  Change a month or day figure and the other follows. A blank minimum uses the default. A blank stretch keeps the month before's.
                </p>
                <div className="hidden sm:grid grid-cols-[6rem_repeat(4,minmax(0,1fr))] gap-2 text-xs font-medium text-muted-foreground">
                  <span />
                  <span>Minimum</span><span>Per day</span><span>Stretch</span><span>Per day</span>
                </div>
                <ul className="space-y-3 sm:space-y-2">
                  {months.map((m, i) => {
                    const text = stretchText[m] ?? "";
                    const minOwn = monthMinText[m] ?? "";
                    const carried = resolveStretch(m, after.rows);
                    const placeholder = carried.value != null && text.trim() === ""
                      ? `${asText(carried.value)} (${monthLabel(carried.fromMonth!, { short: true, abbreviated: true })})`
                      : "no stretch";
                    const bad = badMonths.includes(m);
                    const badMin = badMinMonths.includes(m);
                    const low = belowMin.includes(m);
                    return (
                      <li key={m} className="grid grid-cols-2 sm:grid-cols-[6rem_repeat(4,minmax(0,1fr))] gap-2 items-center">
                        <span className="col-span-2 sm:col-span-1 text-base leading-tight">
                          {monthLabel(m, { short: m.slice(0, 4) === data.currentMonth.slice(0, 4), abbreviated: true })}
                          {i === 0 && <span className="block text-xs text-muted-foreground">this month</span>}
                        </span>
                        <AmountInput
                          value={minOwn}
                          onChange={v => setMonthMinText(s => ({ ...s, [m]: v }))}
                          placeholder={asText(after.minimum)}
                          invalid={badMin || low}
                          ariaLabel={`${monthLabel(m)} minimum`}
                        />
                        <DailyAmount
                          monthly={minOwn}
                          carried={after.minimum}
                          days={daysInMonth(m)}
                          onMonthly={v => setMonthMinText(s => ({ ...s, [m]: v }))}
                          ariaLabel={`${monthLabel(m)} minimum per day`}
                        />
                        <AmountInput
                          value={text}
                          onChange={v => setStretchText(s => ({ ...s, [m]: v }))}
                          placeholder={placeholder}
                          invalid={bad || low}
                          ariaLabel={`${monthLabel(m)} stretch target`}
                        />
                        <DailyAmount
                          monthly={text}
                          carried={carried.value}
                          days={daysInMonth(m)}
                          onMonthly={v => setStretchText(s => ({ ...s, [m]: v }))}
                          ariaLabel={`${monthLabel(m)} stretch target per day`}
                        />
                        {(bad || badMin) && <p className="col-span-full text-xs text-red-600">Not an amount — try 150,000 or 150k.</p>}
                        {low && <p className="col-span-full text-xs text-red-600">The stretch must be above this month's minimum.</p>}
                      </li>
                    );
                  })}
                </ul>
              </section>

              <section className="space-y-2">
                <h3 className="text-base font-semibold">Other panels</h3>
                <p className="text-sm text-muted-foreground">Each saves on its own as you type.</p>
                <BenchmarkRows />
              </section>

              {data.history.length > 0 && (
                <section className="space-y-1.5">
                  <h3 className="text-sm font-semibold text-muted-foreground">Recent changes</h3>
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    {data.history.slice(0, 5).map((h, i) => (
                      <li key={i}>
                        {format(parseISO(h.changedAt.replace(" ", "T")), "d MMM HH:mm")} · {h.changedByName ?? "someone"} ·{" "}
                        {h.kind === "minimum" ? "Default minimum" : `${monthLabel(h.month!)} ${h.kind === "month_minimum" ? "minimum" : "stretch"}`}{" "}
                        {h.oldValue == null ? "set" : formatGbp(h.oldValue)} → {h.newValue == null ? "cleared" : formatGbp(h.newValue)}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}

          {step !== "edit" && (
            <section className="rounded-2xl border-2 border-amber-500/50 bg-amber-500/10 p-4 space-y-2">
              <p className="text-base font-semibold">You're about to change:</p>
              <ul className="space-y-1.5">
                {summary.map((line, i) => (
                  <li key={i} className="text-base flex items-start gap-2"><Pencil className="w-4 h-4 mt-1 flex-shrink-0 text-amber-600" />{line}</li>
                ))}
              </ul>
            </section>
          )}

          {step === "confirm" && (
            <label className="flex items-center gap-3 rounded-2xl border-2 border-border px-4 py-4 cursor-pointer select-none">
              <input type="checkbox" checked={ticked} onChange={e => setTicked(e.target.checked)} className="w-6 h-6 accent-primary" />
              <span className="text-base font-semibold">Yes, change the targets</span>
            </label>
          )}

          {saveError && <p className="text-sm text-red-600" role="alert">{saveError}</p>}
        </div>

        <div className="flex items-center gap-3 px-5 py-4 border-t border-border">
          {step === "edit" ? (
            <>
              <button type="button" onClick={close} className="h-12 px-5 rounded-xl border-2 border-border font-semibold hover:bg-secondary/60">Cancel</button>
              <span className="flex-1 text-sm text-muted-foreground text-right">
                <span className="hidden sm:inline">
                  {changes.length === 0 ? "Nothing changed yet" : `${changes.length} change${changes.length === 1 ? "" : "s"}`}
                </span>
              </span>
              <button type="button" disabled={!canReview} onClick={() => { setTicked(false); setStep("review"); }}
                className="h-12 px-6 rounded-xl bg-primary text-primary-foreground font-bold disabled:opacity-50">
                Review changes
              </button>
            </>
          ) : step === "review" ? (
            <>
              <button type="button" onClick={() => setStep("edit")} className="h-12 px-4 rounded-xl border-2 border-border font-semibold hover:bg-secondary/60 inline-flex items-center gap-1.5">
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <span className="flex-1" />
              <button type="button" onClick={() => setStep("confirm")}
                className="h-12 px-6 rounded-xl bg-primary text-primary-foreground font-bold">
                These are right
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setStep("edit")} disabled={save.isPending}
                className="h-12 px-4 rounded-xl border-2 border-border font-semibold hover:bg-secondary/60 inline-flex items-center gap-1.5">
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <span className="flex-1" />
              <button type="button" onClick={confirm} disabled={!ticked || save.isPending}
                className="h-12 px-6 rounded-xl bg-primary text-primary-foreground font-bold disabled:opacity-50 inline-flex items-center gap-2">
                {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                Confirm
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** The same target as a figure per day: typing here sets the month's. */
function DailyAmount({ monthly, carried, days, onMonthly, ariaLabel }: {
  monthly: string;
  /** The stretch carried from an earlier month, when this one's blank. */
  carried?: number | null;
  days: number;
  onMonthly: (v: string) => void;
  ariaLabel: string;
}) {
  const [typing, setTyping] = useState<string | null>(null);
  const month = parseAmount(monthly);
  return (
    <AmountInput
      value={typing ?? (month == null ? "" : asText(dailyFromMonthly(month, days)))}
      placeholder={carried != null ? asText(dailyFromMonthly(carried, days)) : undefined}
      ariaLabel={ariaLabel}
      onChange={v => {
        setTyping(v);
        const day = parseAmount(v);
        if (day != null) onMonthly(asText(monthlyFromDaily(day, days)));
        else if (v.trim() === "") onMonthly("");
      }}
      onLeave={() => setTyping(null)}
    />
  );
}

function AmountInput({ id, value, onChange, onLeave, placeholder, invalid, ariaLabel }: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  onLeave?: () => void;
  placeholder?: string;
  invalid?: boolean;
  ariaLabel?: string;
}) {
  return (
    <div className={cn("flex items-center rounded-xl border-2 bg-background px-3 focus-within:ring-2 focus-within:ring-primary/30",
      invalid ? "border-red-500" : "border-border")}>
      <span className="text-muted-foreground text-lg">£</span>
      <input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={e => onChange(e.target.value)}
        // "150k" → "150,000" once you move on, so what's saved is visible.
        onBlur={() => { if (onLeave) onLeave(); else { const n = parseAmount(value); if (n != null) onChange(asText(n)); } }}
        className="flex-1 min-w-0 h-12 bg-transparent px-2 text-base sm:text-lg tabular-nums focus:outline-none placeholder:text-muted-foreground/70"
      />
      {value.trim() !== "" && parseAmount(value) != null && <Check className="w-4 h-4 text-primary flex-shrink-0" />}
    </div>
  );
}
