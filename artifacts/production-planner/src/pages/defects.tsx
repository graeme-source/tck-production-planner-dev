/**
 * Defects & waste — Analytics (Graeme, 2026-10-01; waste £ added 2026-10-09 —
 * Objectives C and E).
 *
 * One building-wide figure: defect packs as a share of packs made. Defects
 * are wonkies + dog bins (counted automatically from the station taps) +
 * everything reported with "Report defect / waste" (mislabels, wrong items,
 * damaged packs, complaints…). Packs made is the same figure Team efficiency
 * uses. Waste (anything binned — an ingredient, a sub-recipe, finished packs)
 * is shown in £: ingredients, the time to make it again, and the two
 * together, for today, this week, this month or any range. Costs are
 * snapshot when each entry is saved (api-server lib/waste-cost.ts).
 * The API does the maths (lib/defects-kpi.ts); this page only shows it.
 */
import { useState, type ReactNode } from "react";
import { AlertOctagon, Check, Loader2, Package, Pencil, Plus, Trash2, X } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import { londonDay } from "@/lib/day-rollover";
import { RecordDefectModal, DEFECT_STATION_LABELS, REPORT_DEFECT_LABEL } from "@/components/record-defect-modal";
import {
  useDefectList, useDefectSummary, useDefectTypes, useDeleteDefect, useSaveDefectType, type DefectRange,
} from "@/hooks/use-defects";
import {
  barWidth, dayText, defectHeadline, gbpText, minutesText, orderRefList, pctText, plural, quantityText, rangeText, recordItemName, stationText,
  type DefectRecord, type DefectSummary, type DefectType,
} from "@/lib/defects-view";

type PeriodKey = "today" | "week" | "month" | "custom";

const PERIOD_LABEL: Record<PeriodKey, string> = {
  today: "Today", week: "This week", month: "This month", custom: "Custom range",
};

export default function DefectsPage() {
  const { state } = useAuth();
  const role = state.status === "authenticated" ? state.user.role : "viewer";
  const isAdmin = role === "admin";
  const today = londonDay(Date.now());

  const [selected, setSelected] = useState<PeriodKey>("week");
  const [custom, setCustom] = useState({ from: `${today.slice(0, 7)}-01`, to: today });
  const [recordOpen, setRecordOpen] = useState(false);
  const [editing, setEditing] = useState<DefectRecord | null>(null);

  const customValid = custom.from <= custom.to && custom.to <= today && /^\d{4}-\d{2}-\d{2}$/.test(custom.from);
  const ranges: Record<PeriodKey, DefectRange> = {
    today: { period: "today" },
    week: { period: "week" },
    month: { period: "month" },
    custom: custom,
  };

  const todayQ = useDefectSummary(ranges.today);
  const weekQ = useDefectSummary(ranges.week);
  const monthQ = useDefectSummary(ranges.month);
  const customQ = useDefectSummary(ranges.custom, customValid);
  const byPeriod = { today: todayQ, week: weekQ, month: monthQ, custom: customQ };
  const current = byPeriod[selected];
  const listQ = useDefectList(ranges[selected], selected !== "custom" || customValid);

  return (
    <div className="p-4 sm:p-8 space-y-6 max-w-6xl mx-auto">
      <PageHeader title="Defects & waste" />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <p className="text-lg text-muted-foreground max-w-2xl">
          Anything not done right that means product can't go out as normal — as a share of the packs we made — and what everything binned cost us. Wonkies and dog bins count automatically from the stations; everything else is reported here.
        </p>
        <button
          type="button"
          onClick={() => { setEditing(null); setRecordOpen(true); }}
          className="h-16 px-7 rounded-2xl bg-primary text-primary-foreground text-xl font-bold flex items-center gap-3 shadow-lg shadow-primary/20 active:scale-[0.99] transition-all"
        >
          <AlertOctagon className="w-6 h-6" /> {REPORT_DEFECT_LABEL}
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {(["today", "week", "month", "custom"] as PeriodKey[]).map(key => (
          <KpiCard
            key={key}
            label={PERIOD_LABEL[key]}
            active={selected === key}
            onSelect={() => setSelected(key)}
            summary={byPeriod[key].data}
            loading={byPeriod[key].isLoading && (key !== "custom" || customValid)}
            error={byPeriod[key].isError ? (byPeriod[key].error as Error).message : null}
            today={today}
          >
            {key === "custom" && (
              <div className="mt-3 grid grid-cols-2 gap-2" onClick={e => e.stopPropagation()}>
                <input type="date" value={custom.from} max={today} aria-label="From"
                  onChange={e => { setCustom(c => ({ ...c, from: e.target.value })); setSelected("custom"); }}
                  className="h-11 px-2 rounded-xl border-2 border-border bg-background text-sm min-w-0" />
                <input type="date" value={custom.to} max={today} aria-label="To"
                  onChange={e => { setCustom(c => ({ ...c, to: e.target.value })); setSelected("custom"); }}
                  className="h-11 px-2 rounded-xl border-2 border-border bg-background text-sm min-w-0" />
                {!customValid && <p className="col-span-2 text-sm text-destructive">Pick a start on or before the end, up to today.</p>}
              </div>
            )}
          </KpiCard>
        ))}
      </div>

      {current.data && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Breakdown
            title="By type"
            rows={current.data.byType.map(t => ({ key: t.key, label: t.label, packs: t.packs }))}
            empty="No defects in these dates."
          />
          <Breakdown
            title="By station"
            rows={current.data.byStation.map(s => ({ key: s.station ?? "_none", label: stationText(s.station, DEFECT_STATION_LABELS), packs: s.packs, muted: s.station == null }))}
            empty="No defects in these dates."
          />
        </div>
      )}

      {current.data && current.data.byDay.length > 1 && current.data.waste.totalCost > 0 && (
        <WasteByDay rows={current.data.byDay} today={today} />
      )}

      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="text-2xl font-bold">Recorded defects & waste</h2>
          {current.data && (
            <span className="text-base text-muted-foreground">{PERIOD_LABEL[selected]} · {rangeText(current.data.from, current.data.to, today)}</span>
          )}
        </div>
        {listQ.isLoading && <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />}
        {listQ.isError && <p className="text-destructive text-lg">Couldn't load the records — {(listQ.error as Error).message}</p>}
        {listQ.data && listQ.data.length === 0 && (
          <div className="rounded-3xl border border-dashed border-border p-8 text-center text-lg text-muted-foreground">
            Nothing recorded in these dates. Wonkies and dog bins still count in the figures above.
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {listQ.data?.map(d => (
            <DefectCard key={d.id} d={d} today={today} onEdit={() => { setEditing(d); setRecordOpen(true); }} />
          ))}
        </div>
      </section>

      {isAdmin && <TypeManager />}

      <RecordDefectModal open={recordOpen} editing={editing} onClose={() => { setRecordOpen(false); setEditing(null); }} />
    </div>
  );
}

function KpiCard({ label, active, onSelect, summary, loading, error, today, children }: {
  label: string; active: boolean; onSelect: () => void; summary: DefectSummary | undefined;
  loading: boolean; error: string | null; today: string; children?: ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={active}
      onClick={onSelect}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(); } }}
      className={cn(
        "rounded-3xl border-2 bg-card p-5 text-left cursor-pointer transition-colors",
        active ? "border-primary shadow-md" : "border-border hover:border-primary/40",
      )}
    >
      <p className="text-base font-semibold text-muted-foreground">{label}</p>
      {loading ? (
        <Loader2 className="mt-3 w-6 h-6 animate-spin text-muted-foreground" />
      ) : error ? (
        <p className="mt-2 text-base text-destructive">{error}</p>
      ) : summary ? (
        <>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-5xl font-extrabold tabular-nums">{summary.defects}</span>
            <span className="text-lg font-semibold">{summary.defects === 1 ? "defect" : "defects"}</span>
          </div>
          <p className="mt-1 text-lg font-semibold">
            {summary.pct == null ? "No packs made" : <>{pctText(summary.pct)} <span className="font-normal text-muted-foreground">of {plural(summary.packsMade, "pack")}</span></>}
          </p>
          <div className="mt-3 rounded-2xl bg-rose-50 dark:bg-rose-950/30 px-3 py-2">
            <p className="text-sm font-semibold text-rose-900 dark:text-rose-100">Waste</p>
            <p className="text-2xl font-extrabold tabular-nums text-rose-900 dark:text-rose-100">{gbpText(summary.waste?.totalCost ?? 0)}</p>
            <p className="text-sm text-rose-900/80 dark:text-rose-100/80 tabular-nums">
              {gbpText(summary.waste?.ingredientCost ?? 0)} ingredients · {gbpText(summary.waste?.timeCost ?? 0)} time
            </p>
          </div>
          <p className="mt-2 text-sm text-muted-foreground" title={defectHeadline(summary)}>
            {rangeText(summary.from, summary.to, today)}
          </p>
        </>
      ) : null}
      {children}
    </div>
  );
}

function Breakdown({ title, rows, empty }: {
  title: string; rows: Array<{ key: string; label: string; packs: number; muted?: boolean }>; empty: string;
}) {
  const max = Math.max(0, ...rows.map(r => r.packs));
  return (
    <section className="rounded-3xl border border-border bg-card p-5 space-y-3">
      <h2 className="text-xl font-bold">{title}</h2>
      {rows.length === 0 || max === 0 ? (
        <p className="text-base text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-3">
          {rows.map(r => (
            <li key={r.key}>
              <div className="flex items-baseline justify-between gap-3">
                <span className={cn("text-base font-semibold", r.muted && "text-muted-foreground")}>{r.label}</span>
                <span className="text-base font-bold tabular-nums">{plural(r.packs, "pack")}</span>
              </div>
              <div className="mt-1 h-3 rounded-full bg-secondary overflow-hidden">
                <div className={cn("h-full rounded-full", r.muted ? "bg-muted-foreground/40" : "bg-primary")} style={{ width: `${barWidth(r.packs, max)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** £ of waste day by day across the chosen range — only days with some. */
function WasteByDay({ rows, today }: { rows: DefectSummary["byDay"]; today: string }) {
  const withWaste = rows.filter(r => r.wasteCost > 0);
  const max = Math.max(0, ...withWaste.map(r => r.wasteCost));
  return (
    <section className="rounded-3xl border border-border bg-card p-5 space-y-3">
      <h2 className="text-xl font-bold">Waste by day</h2>
      <ul className="space-y-3">
        {[...withWaste].reverse().map(r => (
          <li key={r.date}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-base font-semibold">{dayText(r.date, today)}</span>
              <span className="text-base font-bold tabular-nums">{gbpText(r.wasteCost)}</span>
            </div>
            <div className="mt-1 h-3 rounded-full bg-secondary overflow-hidden">
              <div className="h-full rounded-full bg-rose-500" style={{ width: `${barWidth(r.wasteCost, max)}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function DefectCard({ d, today, onEdit }: { d: DefectRecord; today: string; onEdit: () => void }) {
  const del = useDeleteDefect();
  const [confirming, setConfirming] = useState(false);
  const refs = orderRefList(d.orderRefs);
  const itemName = recordItemName(d);
  const amount = quantityText(d);
  return (
    <article className="rounded-3xl border border-border bg-card p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-muted-foreground">{dayText(d.occurredOn, today)}</p>
          <h3 className="text-xl font-bold leading-tight">{itemName ?? d.typeName}</h3>
          {itemName && <p className="text-lg">{d.typeName}</p>}
        </div>
        {amount ? (
          <span className="flex-shrink-0 rounded-2xl bg-secondary px-3 py-2 text-lg font-bold tabular-nums">{amount}</span>
        ) : (
          <span className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-2xl bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-100 px-3 py-2 text-lg font-bold tabular-nums">
            <Package className="w-5 h-5" /> {d.packs}
          </span>
        )}
      </div>
      {d.totalCost != null && (
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-secondary/60 p-2">
            <p className="text-xs font-semibold text-muted-foreground">{d.itemKind === "product" ? "Ingredients & packaging" : "Ingredients"}</p>
            <p className="text-lg font-extrabold tabular-nums">{gbpText(d.ingredientCost)}</p>
          </div>
          <div className="rounded-xl bg-secondary/60 p-2">
            <p className="text-xs font-semibold text-muted-foreground">Time{d.remakeMinutes ? ` (${minutesText(d.remakeMinutes)})` : ""}</p>
            <p className="text-lg font-extrabold tabular-nums">{gbpText(d.timeCost)}</p>
          </div>
          <div className="rounded-xl bg-rose-100 dark:bg-rose-900/40 p-2">
            <p className="text-xs font-semibold text-rose-900 dark:text-rose-100">Total</p>
            <p className="text-lg font-extrabold tabular-nums text-rose-900 dark:text-rose-100">{gbpText(d.totalCost)}</p>
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-2 text-sm">
        {d.station && <span className="rounded-full bg-secondary px-3 py-1 font-semibold">{stationText(d.station, DEFECT_STATION_LABELS)}</span>}
        {refs.map(r => <span key={r} className="rounded-full bg-secondary px-3 py-1 font-mono">{r}</span>)}
      </div>
      {d.note && <p className="text-base whitespace-pre-wrap">{d.note}</p>}
      <p className="text-sm text-muted-foreground">
        Recorded by {d.recordedByName ?? "someone"}{d.updatedByName && d.updatedAt !== d.createdAt ? ` · edited by ${d.updatedByName}` : ""}
      </p>
      {d.canEdit && (
        <div className="flex flex-wrap gap-2 pt-1">
          {confirming ? (
            <>
              <button type="button" onClick={() => del.mutate(d.id)} disabled={del.isPending}
                className="h-12 px-5 rounded-2xl bg-destructive text-destructive-foreground text-base font-bold flex items-center gap-2 disabled:opacity-60">
                {del.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Trash2 className="w-5 h-5" />} Yes, delete it
              </button>
              <button type="button" onClick={() => { setConfirming(false); del.reset(); }}
                className="h-12 px-5 rounded-2xl border-2 border-border text-base font-bold">Keep it</button>
            </>
          ) : (
            <>
              <button type="button" onClick={onEdit}
                className="h-12 px-5 rounded-2xl border-2 border-border text-base font-bold flex items-center gap-2 hover:bg-secondary/50">
                <Pencil className="w-4 h-4" /> Edit
              </button>
              <button type="button" onClick={() => setConfirming(true)}
                className="h-12 px-5 rounded-2xl border-2 border-border text-base font-bold flex items-center gap-2 text-destructive hover:bg-destructive/10">
                <Trash2 className="w-4 h-4" /> Delete
              </button>
            </>
          )}
        </div>
      )}
      {del.isError && <p className="text-base font-semibold text-destructive">Not deleted — {(del.error as Error).message}</p>}
    </article>
  );
}

// ── Admin: defect types ─────────────────────────────────────────────────────

function TypeManager() {
  const typesQ = useDefectTypes();
  const add = useSaveDefectType();
  const [name, setName] = useState("");
  const submit = () => {
    if (!name.trim()) return;
    add.mutate({ id: null, patch: { name: name.trim() } }, { onSuccess: () => setName("") });
  };
  return (
    <section className="rounded-3xl border border-border bg-card p-5 space-y-4">
      <div>
        <h2 className="text-xl font-bold flex items-center gap-2">Defect types</h2>
        <p className="text-base text-muted-foreground">Admins only. Rename a type, or switch it off to hide it from the form — records already made with it keep it.</p>
      </div>
      {typesQ.isLoading && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}
      <ul className="space-y-2">
        {typesQ.data?.map(t => <TypeRow key={t.id} t={t} />)}
      </ul>
      <div className="flex flex-col sm:flex-row gap-2">
        <input value={name} onChange={e => setName(e.target.value)} maxLength={80} placeholder="New type, e.g. Out of date"
          onKeyDown={e => { if (e.key === "Enter") submit(); }}
          className="flex-1 h-12 px-4 rounded-2xl border-2 border-border bg-background text-base" />
        <button type="button" onClick={submit} disabled={!name.trim() || add.isPending}
          className="h-12 px-5 rounded-2xl bg-primary text-primary-foreground text-base font-bold flex items-center justify-center gap-2 disabled:opacity-50">
          {add.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />} Add type
        </button>
      </div>
      {add.isError && <p className="text-base font-semibold text-destructive">Not added — {(add.error as Error).message}</p>}
    </section>
  );
}

function TypeRow({ t }: { t: DefectType }) {
  const save = useSaveDefectType();
  const [name, setName] = useState(t.name);
  const [justSaved, setJustSaved] = useState(false);
  const dirty = name.trim() !== t.name;
  const commit = (patch: Partial<Pick<DefectType, "name" | "active">>) => {
    setJustSaved(false);
    save.mutate({ id: t.id, patch }, { onSuccess: () => setJustSaved(true) });
  };
  return (
    <li className={cn("rounded-2xl border-2 border-border p-3 flex flex-col sm:flex-row sm:items-center gap-2", !t.active && "opacity-70")}>
      <input
        value={name}
        onChange={e => { setName(e.target.value); setJustSaved(false); }}
        onBlur={() => { if (dirty && name.trim()) commit({ name: name.trim() }); }}
        onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        maxLength={80}
        aria-label="Type name"
        className="flex-1 h-12 px-4 rounded-xl border-2 border-border bg-background text-base font-semibold"
      />
      <span className="text-sm min-w-[90px] flex items-center gap-1" aria-live="polite">
        {save.isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
          : save.isError ? <span className="text-destructive font-semibold">Not saved — {(save.error as Error).message}</span>
          : dirty ? <span className="text-amber-700 dark:text-amber-300 font-semibold">Unsaved</span>
          : justSaved ? <span className="text-emerald-700 dark:text-emerald-300 font-semibold flex items-center gap-1"><Check className="w-4 h-4" /> Saved</span>
          : null}
      </span>
      <button
        type="button"
        onClick={() => commit({ active: !t.active })}
        disabled={save.isPending}
        className={cn("h-12 px-4 rounded-xl border-2 text-base font-bold flex items-center gap-2",
          t.active ? "border-border hover:bg-secondary/50" : "border-primary bg-primary/10")}
      >
        {t.active ? <><X className="w-4 h-4" /> Switch off</> : <><Check className="w-4 h-4" /> Switch on</>}
      </button>
    </li>
  );
}
