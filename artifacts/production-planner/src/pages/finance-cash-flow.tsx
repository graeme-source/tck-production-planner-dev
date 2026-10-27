/**
 * Finance → Cash flow (Graeme, 2026-10-26): "how much cash we've got in the
 * bank ... what's due in the next week or so ... miscellaneous outflows on
 * different days ... associate those with suppliers ... 'recurring every 4
 * days' ... bring the Shopify payout values directly from Shopify."
 *
 * A day-by-day running balance: the bank balance (set by hand), Shopify
 * payouts in (live), QuickBooks bills out on their due dates (live), and the
 * money in/out added here. A tab of the Finance page. API: /api/cash-flow.
 *
 * 2026-10-27: "drag and drop things around so I can push things back and
 * decide to pay things later" + "set rules for certain things ... a slightly
 * different picture from QuickBooks". Any line can be dragged to another day
 * (grip handle — works with touch on the iPad) or moved with a date picker
 * (tap the line). Supplier payment rules re-date that supplier's bills. A
 * hand move beats a rule, which beats QuickBooks' due date. QuickBooks itself
 * is never changed.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext, DragOverlay, PointerSensor, KeyboardSensor, useDraggable, useDroppable, useSensor, useSensors, pointerWithin,
  type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import {
  AlertTriangle, ArrowDownLeft, ArrowUpRight, CalendarClock, Check, GripVertical, Loader2, Plus, Repeat, RotateCcw, Scale, Trash2, Undo2, Wallet,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { explainBill, findLine, moveLine, shortDate, type CfForecast, type CfLine } from "@/lib/cash-flow-move";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Line = CfLine;
type Day = CfForecast["days"][number];
interface Item {
  id: number; label: string; direction: "in" | "out"; amount: number; onDate: string | null; everyDays: number | null;
  startsOn: string | null; endsOn: string | null; finVendorId: number | null; vendorName: string | null; notes: string | null; active: boolean;
}
type RuleKind = "days_after" | "next_month_day" | "next_month_day_cutoff" | "qbo";
interface Rule { id: number; vendorName: string; kind: RuleKind; days: number | null; dayOfMonth: number | null; cutoffDay: number | null; text: string; updatedBy: string | null }
interface Diagnosis {
  total: number; suspect: number; suspectAmount: number; dueIsBillDate: number; noDueDate: number; noTerms: number; ruled: number;
  suppliers: Array<{ vendorName: string; bills: number; amount: number }>;
}
interface CashFlow {
  today: string;
  /** Test server only: sample bills and payouts instead of QuickBooks/Shopify. */
  demo?: boolean;
  demoAllowed?: boolean;
  balance: { amount: number; asOf: string; set: boolean; updatedBy: string | null; updatedAt: string | null };
  forecast: CfForecast;
  items: Item[];
  rules: Rule[];
  diagnosis: Diagnosis;
  billVendors: string[];
  vendors: Array<{ id: number; name: string }>;
  sources: {
    quickbooks: { connected: boolean; bills: number; fetchedAt: string | null; error: string | null };
    shopify: { available: boolean; reason: string | null; balance: number | null; fetchedAt: string | null; error: string | null };
  };
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}/api/cash-flow${path}`, { credentials: "include", headers: { "Content-Type": "application/json" }, ...init });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${r.status}`);
  return body as T;
}
/** Rule and move writes go to the in-memory sample while sample data is on. */
const demoQs = (demo: boolean | undefined) => (demo ? "?demo=1" : "");

const gbp = (n: number) => `${n < 0 ? "−" : ""}£${Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const gbp0 = (n: number) => `${n < 0 ? "−" : ""}£${Math.round(Math.abs(n)).toLocaleString("en-GB")}`;
const dayLabel = (d: string, today: string) => d === today ? "Today" : new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const vendorKey = (name: string | null | undefined) => (name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

type SaveState = "idle" | "saving" | "saved" | "error";
function SaveTag({ state }: { state: SaveState }) {
  if (state === "saving") return <span className="text-xs text-muted-foreground inline-flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Saving</span>;
  if (state === "saved") return <span className="text-xs text-primary inline-flex items-center gap-1"><Check className="w-3 h-3" /> Saved</span>;
  if (state === "error") return <span className="text-xs text-red-600">Didn't save</span>;
  return null;
}

/** Move a line (drag, date picker or "Put back"): the balance updates at once, then it saves. */
function useMoveLine(queryKey: readonly unknown[], demo: boolean | undefined) {
  const qc = useQueryClient();
  const [save, setSave] = useState<SaveState>("idle");
  const m = useMutation({
    mutationFn: ({ line, toDate }: { line: Line; toDate: string | null }) => toDate
      ? api(`/overrides${demoQs(demo)}`, { method: "PUT", body: JSON.stringify({
          source: line.source, ref: line.ref, occurrence: line.occurrence, plannedDate: toDate, movedFrom: line.naturalDate, label: line.label,
        }) })
      : api(`/overrides/remove${demoQs(demo)}`, { method: "POST", body: JSON.stringify({ source: line.source, ref: line.ref, occurrence: line.occurrence }) }),
    onMutate: async ({ line, toDate }) => {
      setSave("saving");
      await qc.cancelQueries({ queryKey });
      const before = qc.getQueryData<CashFlow>(queryKey);
      if (before) qc.setQueryData<CashFlow>(queryKey, { ...before, forecast: moveLine(before.forecast, line.key, toDate) });
      return { before };
    },
    onError: (e: Error, _v, ctx) => {
      if (ctx?.before) qc.setQueryData(queryKey, ctx.before);
      setSave("error");
      toast({ title: "Didn't move it", description: e.message, variant: "destructive" });
    },
    onSuccess: () => setSave("saved"),
    onSettled: () => { void qc.invalidateQueries({ queryKey: ["cash-flow"] }); },
  });
  return { move: (line: Line, toDate: string | null) => m.mutate({ line, toDate }), save };
}

/** The Cash flow tab inside Finance (pages/finance.tsx decides who sees it). */
export function CashFlowPanel() {
  const [days, setDays] = useState(14);
  const [demo, setDemo] = useState(false);
  const [overdueApart, setOverdueApart] = useState(true);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [ruleFor, setRuleFor] = useState<{ vendorName: string | null } | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const queryKey = useMemo(() => ["cash-flow", days, demo] as const, [days, demo]);
  const q = useQuery({ queryKey, queryFn: () => api<CashFlow>(`?days=${days}${demo ? "&demo=1" : ""}`), refetchInterval: 5 * 60_000 });
  const d = q.data;
  const { move, save } = useMoveLine(queryKey, d?.demo);
  const qc = useQueryClient();

  // Grip handle only: the rest of the line still scrolls the page on the iPad.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  const onDragStart = (e: DragStartEvent) => setDragKey(String(e.active.id));
  const onDragEnd = (e: DragEndEvent) => {
    setDragKey(null);
    const over = e.over?.id ? String(e.over.id) : null;
    if (!d || !over?.startsWith("day:")) return;
    const found = findLine(d.forecast, String(e.active.id));
    if (!found) return;
    const to = over.slice(4);
    // Dropped back on the day it's already shown on: nothing to do.
    if (to === found.day && !found.line.late) return;
    move(found.line, to === found.line.naturalDate ? null : to);
  };

  const today = d?.forecast.days[0];
  const overdue = today ? [...today.outs.filter(l => l.late).map(l => ({ l, dir: "out" as const })), ...today.ins.filter(l => l.late).map(l => ({ l, dir: "in" as const }))] : [];
  const dragging = d && dragKey ? findLine(d.forecast, dragKey) : null;
  const opened = d && openKey ? findLine(d.forecast, openKey) : null;

  return (
    <div className="space-y-5">
      {q.isLoading && <div className="flex items-center gap-2 text-muted-foreground py-10 justify-center"><Loader2 className="w-5 h-5 animate-spin" /> Reading QuickBooks and Shopify…</div>}
      {q.error && <p className="text-red-600">Couldn't load the cash flow — {(q.error as Error).message}</p>}

      {d && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <BalanceCard data={d} />
            <BigCard label={`Lowest in the next ${days} days`} tone={d.forecast.lowest && d.forecast.lowest.balance < 0 ? "bad" : "plain"}
              value={d.forecast.lowest ? gbp0(d.forecast.lowest.balance) : "—"} sub={d.forecast.lowest ? dayLabel(d.forecast.lowest.date, d.today) : ""} />
            <BigCard label={`Money in · ${days} days`} tone="good" value={gbp0(d.forecast.totalIn)} sub="Shopify payouts + added" />
            <BigCard label={`Money out · ${days} days`} tone="plain" value={gbp0(d.forecast.totalOut)} sub="Bills due + added" />
          </div>

          {d.demoAllowed && (
            <div className={cn("rounded-2xl border-2 px-4 py-2.5 flex flex-wrap items-center gap-3", d.demo ? "border-violet-400 bg-violet-50 dark:bg-violet-950/30" : "border-dashed border-border")}>
              <p className="text-sm flex-1 min-w-[14rem]">
                {d.demo
                  ? <><span className="font-bold">Sample data</span> — made-up bills and payouts so the page can be tried. Rules and moves you make here are kept in memory only, not saved. Test server only.</>
                  : "Test server: QuickBooks and Shopify can't be reached from here."}
              </p>
              {d.demo && (
                <button type="button" onClick={() => { void api("/demo/reset", { method: "POST", body: "{}" }).then(() => qc.invalidateQueries({ queryKey: ["cash-flow"] })); }}
                  className="h-10 px-4 rounded-xl border-2 border-violet-300 font-semibold hover:bg-violet-100 dark:hover:bg-violet-900/40 inline-flex items-center gap-1.5">
                  <RotateCcw className="w-4 h-4" /> Reset sample
                </button>
              )}
              <button type="button" onClick={() => setDemo(v => !v)} className="h-10 px-4 rounded-xl border-2 border-violet-400 font-semibold hover:bg-violet-100 dark:hover:bg-violet-900/40">
                {d.demo ? "Back to real data" : "Show sample data"}
              </button>
            </div>
          )}

          <Sources s={d.sources} />

          <DiagnosisBanner diag={d.diagnosis} onSetRule={v => setRuleFor({ vendorName: v })} />

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-muted-foreground">Show</span>
            {[7, 14, 30, 60].map(n => (
              <button key={n} type="button" onClick={() => setDays(n)}
                className={cn("h-10 px-3 rounded-xl border-2 text-sm font-semibold", days === n ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-secondary")}>
                {n} days
              </button>
            ))}
            <button type="button" onClick={() => setOverdueApart(v => !v)}
              className={cn("h-10 px-3 rounded-xl border-2 text-sm font-semibold", overdueApart ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-secondary")}>
              {overdueApart ? "Overdue shown separately" : "Overdue shown on today"}
            </button>
            <span className="text-sm text-muted-foreground flex-1 min-w-[12rem]">Drag a line by its handle to another day, or tap it to pick a date.</span>
            <SaveTag state={save} />
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px] items-start">
            <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragKey(null)}>
              <div className="space-y-2">
                {overdueApart && overdue.length > 0 && <OverdueCard lines={overdue} onOpen={setOpenKey} onPutBack={l => move(l, null)} />}
                {d.forecast.days.map((day, i) => (
                  <DayCard key={day.date} day={day} today={d.today} hideLate={overdueApart && i === 0}
                    onOpen={setOpenKey} onPutBack={l => move(l, null)} />
                ))}
              </div>
              <DragOverlay>
                {dragging && <LineChip l={dragging.line} dir={dragging.dir} />}
              </DragOverlay>
            </DndContext>
            <div className="space-y-4 xl:sticky xl:top-4">
              <RulesPanel data={d} onEdit={v => setRuleFor({ vendorName: v })} />
              <ItemsPanel data={d} />
            </div>
          </div>

          <LineDialog data={d} found={opened} save={save} onClose={() => setOpenKey(null)} onMove={move}
            onSetRule={v => { setOpenKey(null); setRuleFor({ vendorName: v }); }} />
          {ruleFor && <RuleDialog data={d} vendorName={ruleFor.vendorName} onClose={() => setRuleFor(null)} />}
        </>
      )}
    </div>
  );
}

function BigCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone: "good" | "bad" | "plain" }) {
  return (
    <div className={cn("rounded-3xl border-2 p-5", tone === "bad" ? "border-red-400 bg-red-50 dark:bg-red-950/30" : "border-border bg-card")}>
      <p className="text-sm font-semibold text-muted-foreground">{label}</p>
      <p className={cn("text-3xl font-display font-bold tabular-nums", tone === "good" && "text-primary", tone === "bad" && "text-red-600")}>{value}</p>
      {sub && <p className="text-sm text-muted-foreground">{sub}</p>}
    </div>
  );
}

/** The bank balance, typed in by hand — autosaves when you leave the field. */
function BalanceCard({ data }: { data: CashFlow }) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState(String(data.balance.amount));
  const [asOf, setAsOf] = useState(data.balance.asOf);
  const [save, setSave] = useState<SaveState>("idle");
  useEffect(() => { setAmount(String(data.balance.amount)); setAsOf(data.balance.asOf); }, [data.balance.amount, data.balance.asOf]);
  const commit = async (a = amount, when = asOf) => {
    const n = Number(a.replace(/[£,\s]/g, ""));
    if (!Number.isFinite(n)) { setSave("error"); return; }
    if (n === data.balance.amount && when === data.balance.asOf) return;
    setSave("saving");
    try {
      await api("/balance", { method: "PUT", body: JSON.stringify({ balance: n, asOf: when }) });
      setSave("saved");
      void qc.invalidateQueries({ queryKey: ["cash-flow"] });
    } catch { setSave("error"); }
  };
  return (
    <div className={cn("rounded-3xl border-2 p-5 space-y-2", data.balance.set ? "border-primary bg-primary/5" : "border-amber-400 bg-amber-50 dark:bg-amber-950/30")}>
      <div className="flex items-center gap-2">
        <Wallet className="w-5 h-5 text-primary" />
        <p className="text-sm font-semibold text-muted-foreground flex-1">In the bank</p>
        <SaveTag state={save} />
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-3xl font-display font-bold">£</span>
        <input value={amount} inputMode="decimal" onChange={e => { setAmount(e.target.value); setSave("idle"); }} onBlur={() => commit()}
          onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          className="w-full min-w-0 bg-transparent text-3xl font-display font-bold tabular-nums focus:outline-none border-b-2 border-dashed border-primary/40 focus:border-primary" aria-label="Bank balance" />
      </div>
      <label className="text-sm text-muted-foreground flex items-center gap-2">
        at the start of
        <input type="date" value={asOf} onChange={e => { setAsOf(e.target.value); void commit(amount, e.target.value); }} className="h-9 px-2 rounded-lg border border-border bg-card text-foreground" />
      </label>
      {!data.balance.set && <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">Type today's bank balance to start the forecast.</p>}
      {data.balance.updatedBy && <p className="text-xs text-muted-foreground">Set by {data.balance.updatedBy}</p>}
    </div>
  );
}

function Sources({ s }: { s: CashFlow["sources"] }) {
  return (
    <div className="flex flex-wrap gap-2 text-sm">
      <span className={cn("rounded-full border-2 px-3 py-1 font-semibold", s.quickbooks.connected && !s.quickbooks.error ? "border-emerald-500/50 text-emerald-700 dark:text-emerald-400" : "border-amber-400 text-amber-800 dark:text-amber-300")}>
        QuickBooks: {s.quickbooks.connected ? `${s.quickbooks.bills} open bill${s.quickbooks.bills === 1 ? "" : "s"}` : "not connected — bills aren't in the forecast"}
        {s.quickbooks.error ? ` · ${s.quickbooks.error}` : ""}
      </span>
      <span className={cn("rounded-full border-2 px-3 py-1 font-semibold", s.shopify.available && !s.shopify.error ? "border-emerald-500/50 text-emerald-700 dark:text-emerald-400" : "border-amber-400 text-amber-800 dark:text-amber-300")}>
        Shopify payouts: {s.shopify.available ? (s.shopify.balance != null ? `connected · ${gbp0(s.shopify.balance)} not yet paid out` : "connected") : (s.shopify.reason ?? "not available")}
        {s.shopify.error ? ` · ${s.shopify.error}` : ""}
      </span>
    </div>
  );
}

/** Why so much shows overdue: bills QuickBooks dates as due the day they arrive. */
function DiagnosisBanner({ diag, onSetRule }: { diag: Diagnosis; onSetRule: (vendorName: string) => void }) {
  if (diag.total === 0 || (diag.suspect === 0 && diag.ruled === 0)) return null;
  const reasons = [
    diag.dueIsBillDate ? `${diag.dueIsBillDate} due on the bill date` : null,
    diag.noDueDate ? `${diag.noDueDate} with no due date` : null,
    diag.noTerms ? `${diag.noTerms} with no payment terms` : null,
  ].filter(Boolean).join(", ");
  return (
    <div className="rounded-3xl border-2 border-amber-400 bg-amber-50 dark:bg-amber-950/30 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-6 h-6 text-amber-600 flex-shrink-0 mt-0.5" />
        <div className="space-y-1">
          {diag.suspect > 0 && (
            <p className="font-bold text-lg">
              {diag.suspect} of {diag.total} open bills ({gbp0(diag.suspectAmount)}) are probably dated wrong in QuickBooks
            </p>
          )}
          {diag.suspect > 0 && (
            <p className="text-sm">
              {reasons}. QuickBooks then treats a bill as due the day it arrives, so it shows as overdue here.
              Set a payment rule for the supplier to date their bills the way you really pay them — QuickBooks isn't changed.
            </p>
          )}
          {diag.ruled > 0 && <p className="text-sm font-semibold text-primary">{diag.ruled} bill{diag.ruled === 1 ? " is" : "s are"} dated by your supplier rules.</p>}
        </div>
      </div>
      {diag.suppliers.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {diag.suppliers.slice(0, 10).map(s => (
            <button key={s.vendorName} type="button" onClick={() => onSetRule(s.vendorName)}
              className="rounded-2xl border-2 border-amber-300 bg-card px-3 py-2 text-left hover:border-primary min-h-11">
              <span className="font-semibold block">{s.vendorName}</span>
              <span className="text-xs text-muted-foreground">{s.bills} bill{s.bills === 1 ? "" : "s"} · {gbp0(s.amount)} · <span className="text-primary font-semibold">Set a rule</span></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** "Pay late" view: overdue lines on their own, ready to be dragged to the day they'll really be paid. */
function OverdueCard({ lines, onOpen, onPutBack }: { lines: Array<{ l: Line; dir: "in" | "out" }>; onOpen: (key: string) => void; onPutBack: (l: Line) => void }) {
  const total = lines.reduce((s, x) => s + (x.dir === "out" ? x.l.amount : -x.l.amount), 0);
  return (
    <div className="rounded-2xl border-2 border-red-300 bg-red-50/60 dark:bg-red-950/20 p-3 space-y-2">
      <div className="flex flex-wrap items-baseline gap-3">
        <p className="text-lg font-bold">Overdue</p>
        <p className="text-sm text-muted-foreground flex-1">{gbp0(total)} counted on today. Drag each one to the day you'll actually pay it.</p>
      </div>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {lines.map(({ l, dir }) => <LineRow key={l.key} l={l} dir={dir} onOpen={onOpen} onPutBack={onPutBack} />)}
      </div>
    </div>
  );
}

function DayCard({ day, today, hideLate, onOpen, onPutBack }: {
  day: Day; today: string; hideLate: boolean; onOpen: (key: string) => void; onPutBack: (l: Line) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${day.date}` });
  const ins = hideLate ? day.ins.filter(l => !l.late) : day.ins;
  const outs = hideLate ? day.outs.filter(l => !l.late) : day.outs;
  const hiddenLate = [...day.ins, ...day.outs].filter(l => hideLate && l.late);
  const quiet = ins.length === 0 && outs.length === 0;
  const lateNote = hiddenLate.length > 0 && (
    <span className="text-xs font-semibold text-red-600">includes {gbp0(hiddenLate.reduce((s, l) => s + (day.outs.includes(l) ? -l.amount : l.amount), 0))} overdue (above)</span>
  );
  if (quiet) {
    return (
      <div ref={setNodeRef} className={cn("rounded-xl border px-4 py-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground transition-colors",
        isOver ? "border-primary border-2 bg-primary/10" : "border-border")}>
        <span className="w-28 font-semibold">{dayLabel(day.date, today)}</span>
        <span className="flex-1">{isOver ? "Drop here" : "Nothing in or out"} {lateNote}</span>
        <span className={cn("tabular-nums font-semibold", day.closing < 0 && "text-red-600")}>{gbp0(day.closing)}</span>
      </div>
    );
  }
  return (
    <div ref={setNodeRef} className={cn("rounded-2xl border-2 bg-card p-3 space-y-2 transition-colors",
      isOver ? "border-primary bg-primary/5" : day.closing < 0 ? "border-red-400" : "border-border")}>
      <div className="flex flex-wrap items-baseline gap-3">
        <p className="text-lg font-bold w-28">{dayLabel(day.date, today)}</p>
        <p className="text-sm text-muted-foreground flex-1">from {gbp0(day.opening)} {lateNote}</p>
        <p className={cn("text-2xl font-display font-bold tabular-nums", day.closing < 0 && "text-red-600")}>{gbp0(day.closing)}</p>
      </div>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {ins.map(l => <LineRow key={l.key} l={l} dir="in" onOpen={onOpen} onPutBack={onPutBack} />)}
        {outs.map(l => <LineRow key={l.key} l={l} dir="out" onOpen={onOpen} onPutBack={onPutBack} />)}
      </div>
    </div>
  );
}

const sourceWords = (l: Line) => l.source === "bill" ? "QuickBooks bill" : l.source === "payout" ? "Shopify" : "Added here";

/** One line. Drag by the grip (mouse or touch); tap the rest to see why it's on this day and pick another. */
function LineRow({ l, dir, onOpen, onPutBack }: { l: Line; dir: "in" | "out"; onOpen: (key: string) => void; onPutBack: (l: Line) => void }) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: l.key });
  const why = explainBill(l);
  return (
    <div ref={setNodeRef} className={cn("rounded-xl flex items-stretch gap-1 text-sm", dir === "in" ? "bg-emerald-50 dark:bg-emerald-950/30" : "bg-secondary/60",
      isDragging && "opacity-40", l.movedFrom && "ring-2 ring-primary/40")}>
      <button type="button" {...listeners} {...attributes} aria-label={`Drag ${l.label} to another day`}
        className="touch-none cursor-grab active:cursor-grabbing w-9 flex-shrink-0 flex items-center justify-center rounded-l-xl text-muted-foreground hover:bg-black/5 dark:hover:bg-white/5">
        <GripVertical className="w-5 h-5" />
      </button>
      <button type="button" onClick={() => onOpen(l.key)} className="flex-1 min-w-0 flex items-center gap-2 py-1.5 pr-2.5 text-left">
        {dir === "in" ? <ArrowDownLeft className="w-4 h-4 text-emerald-600 flex-shrink-0" /> : <ArrowUpRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
        <span className="flex-1 min-w-0 break-words">
          {l.label}
          {l.late && <span className="ml-1.5 text-xs font-bold text-red-600">{l.source === "bill" ? "OVERDUE" : "LATE"}</span>}
          {l.undated && l.source === "bill" && <span className="ml-1.5 text-xs font-bold text-amber-700">NO DUE DATE</span>}
          {l.bill?.basis === "rule" && <span className="ml-1.5 text-xs font-bold text-primary">YOUR RULE</span>}
          <span className="block text-xs text-muted-foreground">{why.length ? why.slice(0, 2).join(" · ") : sourceWords(l)}</span>
        </span>
        <span className={cn("tabular-nums font-bold", dir === "in" ? "text-emerald-700 dark:text-emerald-400" : "")}>{dir === "in" ? "+" : "−"}{gbp(l.amount).replace("−", "")}</span>
      </button>
      {l.movedFrom && (
        <div className="flex flex-col justify-center pr-1.5 text-right">
          <span className="text-[11px] font-semibold text-primary whitespace-nowrap">moved from {shortDate(l.movedFrom)}</span>
          <button type="button" onClick={() => onPutBack(l)} className="h-8 px-2 rounded-lg text-xs font-bold border border-primary/50 text-primary hover:bg-primary/10 inline-flex items-center gap-1 justify-center">
            <Undo2 className="w-3.5 h-3.5" /> Put back
          </button>
        </div>
      )}
    </div>
  );
}

/** What follows the pointer while dragging. */
function LineChip({ l, dir }: { l: Line; dir: "in" | "out" }) {
  return (
    <div className={cn("rounded-xl px-3 py-2 flex items-center gap-2 text-sm shadow-2xl border-2 border-primary", dir === "in" ? "bg-emerald-50 dark:bg-emerald-950" : "bg-card")}>
      <GripVertical className="w-4 h-4 text-muted-foreground" />
      <span className="font-semibold">{l.label}</span>
      <span className="tabular-nums font-bold">{dir === "in" ? "+" : "−"}{gbp(l.amount).replace("−", "")}</span>
    </div>
  );
}

function addDaysYmd(d: string, n: number) { return new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10); }
function firstOfNextMonth(d: string) { const [y, m] = d.split("-").map(Number); return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10); }

/** Tap a line: why it's on this day, and a date picker to move it (the non-drag way). */
function LineDialog({ data, found, save, onClose, onMove, onSetRule }: {
  data: CashFlow; found: ReturnType<typeof findLine>; save: SaveState; onClose: () => void;
  onMove: (l: Line, toDate: string | null) => void; onSetRule: (vendorName: string) => void;
}) {
  const l = found?.line ?? null;
  const [date, setDate] = useState("");
  const [touched, setTouched] = useState(false);
  useEffect(() => { setDate(l?.date && l.date >= data.today ? l.date : data.today); setTouched(false); }, [l?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useRef(l);
  if (l) shown.current = l;
  const line = l ?? shown.current;
  const go = (to: string | null) => {
    if (!line) return;
    if (to) setDate(to);
    setTouched(true);
    onMove(line, to && to === line.naturalDate ? null : to);
  };
  const why = line ? explainBill(line) : [];
  return (
    <Dialog open={!!l} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="w-[calc(100vw-1rem)] sm:max-w-lg max-h-[92dvh] overflow-y-auto rounded-3xl">
        {line && (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl pr-6">{line.label}</DialogTitle>
              <DialogDescription>{sourceWords(line)} · {gbp(line.amount)}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              {why.length > 0 && (
                <div className="rounded-2xl bg-secondary/60 p-3 space-y-1 text-sm">
                  {why.map((w, i) => <p key={i} className={i === 0 ? "font-semibold" : ""}>{w}</p>)}
                </div>
              )}
              {line.source === "payout" && line.naturalDate && <p className="text-sm">Shopify pays this out on {shortDate(line.naturalDate)}.</p>}
              {line.source === "item" && line.naturalDate && <p className="text-sm">This one falls on {shortDate(line.naturalDate)}. Moving it moves only this date — the rest of a repeat stays put.</p>}
              {line.late && <p className="text-sm font-semibold text-red-600">Due before today and still unpaid — counted on today until you move it.</p>}

              <div className="rounded-2xl border-2 border-border p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <CalendarClock className="w-5 h-5 text-primary" />
                  <p className="font-bold flex-1">{line.source === "payout" ? "Expect it on" : line.source === "bill" ? "Plan to pay on" : "On"}</p>
                  {touched && <SaveTag state={save} />}
                </div>
                <input type="date" value={date} min={data.today}
                  onChange={e => { const v = e.target.value; setDate(v); if (/^\d{4}-\d{2}-\d{2}$/.test(v) && v >= data.today) go(v); }}
                  className="w-full h-12 px-3 rounded-xl border-2 border-border bg-card text-lg" aria-label="Move to date" />
                <div className="flex flex-wrap gap-2">
                  {[["Tomorrow", addDaysYmd(data.today, 1)], ["+1 week", addDaysYmd(line.date && line.date > data.today ? line.date : data.today, 7)], ["1st of next month", firstOfNextMonth(data.today)]].map(([lab, v]) => (
                    <button key={lab} type="button" onClick={() => go(v)} className="h-10 px-3 rounded-xl border-2 border-border font-semibold text-sm hover:bg-secondary">{lab}</button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">A date after the last day shown takes it off this view until then.</p>
              </div>

              <div className="flex flex-wrap gap-2">
                {line.movedFrom && (
                  <button type="button" onClick={() => { go(null); onClose(); }} className="h-11 px-4 rounded-xl border-2 border-primary text-primary font-bold inline-flex items-center gap-2 hover:bg-primary/10">
                    <Undo2 className="w-4 h-4" /> Put back to {shortDate(line.movedFrom)}
                  </button>
                )}
                {line.bill && (
                  <button type="button" onClick={() => onSetRule(line.bill!.vendorName)} className="h-11 px-4 rounded-xl border-2 border-border font-semibold inline-flex items-center gap-2 hover:bg-secondary">
                    <Scale className="w-4 h-4" /> Payment rule for {line.bill.vendorName}
                  </button>
                )}
                <button type="button" onClick={onClose} className="h-11 px-4 rounded-xl font-semibold hover:bg-secondary ml-auto">Done</button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Supplier payment rules — kept here, QuickBooks untouched. */
function RulesPanel({ data, onEdit }: { data: CashFlow; onEdit: (vendorName: string | null) => void }) {
  return (
    <div className="rounded-3xl border-2 border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Scale className="w-5 h-5 text-primary" />
        <p className="text-lg font-bold flex-1">Supplier payment rules</p>
        <button type="button" onClick={() => onEdit(null)} className="h-10 px-3 rounded-xl border-2 border-border font-semibold inline-flex items-center gap-1.5 hover:bg-secondary"><Plus className="w-4 h-4" /> Add</button>
      </div>
      <p className="text-sm text-muted-foreground">When you really pay a supplier. A rule replaces QuickBooks' due date for their bills on this page only.</p>
      {data.rules.length === 0 && <p className="text-sm text-muted-foreground">No rules yet — e.g. "A.B. Fruits: bills up to the 15th paid on the 1st of next month".</p>}
      {data.rules.map(r => (
        <button key={r.id} type="button" onClick={() => onEdit(r.vendorName)} className="w-full text-left rounded-2xl border-2 border-border p-3 hover:border-primary">
          <span className="font-semibold block">{r.vendorName}</span>
          <span className="text-sm text-muted-foreground">{r.text}</span>
        </button>
      ))}
    </div>
  );
}

const KINDS: Array<{ kind: RuleKind; title: string }> = [
  { kind: "next_month_day_cutoff", title: "A day next month, with a cut-off" },
  { kind: "next_month_day", title: "A day of the month after the bill" },
  { kind: "days_after", title: "A number of days after the bill" },
  { kind: "qbo", title: "Use QuickBooks' due date" },
];

/** Add or change one supplier's rule. Saves itself as you change it. */
function RuleDialog({ data, vendorName, onClose }: { data: CashFlow; vendorName: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const existing = vendorName ? data.rules.find(r => vendorKey(r.vendorName) === vendorKey(vendorName)) ?? null : null;
  const [vendor, setVendor] = useState<string | null>(existing?.vendorName ?? vendorName);
  const [typed, setTyped] = useState("");
  const [kind, setKind] = useState<RuleKind>(existing?.kind ?? "next_month_day_cutoff");
  const [days, setDays] = useState(String(existing?.days ?? 30));
  const [day, setDay] = useState(String(existing?.dayOfMonth ?? 1));
  const [cutoff, setCutoff] = useState(String(existing?.cutoffDay ?? 15));
  const [save, setSave] = useState<SaveState>("idle");
  const [ruleId, setRuleId] = useState<number | null>(existing?.id ?? null);
  const first = useRef(true);
  const [dirty, setDirty] = useState(false);

  const n = (s: string, lo: number, hi: number) => { const v = Number(s); return Number.isInteger(v) && v >= lo && v <= hi ? v : null; };
  const body = vendor ? {
    vendorName: vendor, kind,
    days: kind === "days_after" ? n(days, 0, 365) : null,
    dayOfMonth: kind === "next_month_day" || kind === "next_month_day_cutoff" ? n(day, 1, 31) : null,
    cutoffDay: kind === "next_month_day_cutoff" ? n(cutoff, 1, 31) : null,
  } : null;
  const valid = !!body && (kind === "qbo" || (kind === "days_after" && body.days != null) || (kind === "next_month_day" && body.dayOfMonth != null) ||
    (kind === "next_month_day_cutoff" && body.dayOfMonth != null && body.cutoffDay != null));
  const sig = JSON.stringify(body);

  // Autosave: every change once the rule exists. A new rule waits for the
  // first change (or "Save rule"), so just opening the dialog adds nothing.
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (!valid || !body || !(ruleId != null || dirty)) return;
    setSave("saving");
    const t = setTimeout(() => {
      api<Rule>(`/rules${demoQs(data.demo)}`, { method: "PUT", body: JSON.stringify(body) })
        .then(r => { setRuleId(r.id); setSave("saved"); void qc.invalidateQueries({ queryKey: ["cash-flow"] }); })
        .catch(() => setSave("error"));
    }, 500);
    return () => clearTimeout(t);
  }, [sig, dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  const remove = useMutation({
    mutationFn: () => api(`/rules/${ruleId}${demoQs(data.demo)}`, { method: "DELETE" }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["cash-flow"] }); onClose(); },
    onError: (e: Error) => toast({ title: "Didn't remove it", description: e.message, variant: "destructive" }),
  });

  const names = useMemo(() => {
    const seen = new Map<string, string>();
    for (const v of [...data.billVendors, ...data.vendors.map(x => x.name)]) if (!seen.has(vendorKey(v))) seen.set(vendorKey(v), v);
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [data.billVendors, data.vendors]);
  const theirLines = vendor ? data.forecast.days.flatMap(d => d.outs.filter(l => l.bill && vendorKey(l.bill.vendorName) === vendorKey(vendor)).map(l => ({ l, shownOn: d.date }))) : [];
  const numBox = (value: string, set: (v: string) => void, label: string) => (
    <input value={value} inputMode="numeric" onChange={e => { set(e.target.value); setDirty(true); }} aria-label={label}
      className="w-16 h-11 px-2 mx-1 rounded-xl border-2 border-border bg-card text-center text-lg font-bold tabular-nums" />
  );

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="w-[calc(100vw-1rem)] sm:max-w-xl max-h-[92dvh] overflow-y-auto rounded-3xl">
        <DialogHeader>
          <DialogTitle className="text-xl pr-6">{vendor ? `When you pay ${vendor}` : "New supplier payment rule"}</DialogTitle>
          <DialogDescription>Replaces QuickBooks' due date for this supplier's bills, on this page only. QuickBooks isn't changed.</DialogDescription>
        </DialogHeader>

        {!vendor ? (
          <div className="space-y-3">
            <label className="block space-y-1">
              <span className="text-sm font-semibold">Supplier</span>
              <select value="" onChange={e => e.target.value && setVendor(e.target.value)} className="w-full h-12 px-3 rounded-xl border-2 border-border bg-card">
                <option value="">Pick a supplier…</option>
                {names.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
            <div className="flex gap-2">
              <input value={typed} onChange={e => setTyped(e.target.value)} placeholder="…or type the name as it is in QuickBooks" className="flex-1 min-w-0 h-12 px-3 rounded-xl border-2 border-border bg-card" />
              <button type="button" disabled={!vendorKey(typed)} onClick={() => setVendor(typed.trim())} className="h-12 px-4 rounded-xl bg-primary text-primary-foreground font-bold disabled:opacity-40">Use</button>
            </div>
            <p className="text-xs text-muted-foreground">Matched ignoring capitals, spaces and dots — "A.B. Fruits" and "AB fruits" are the same supplier.</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold flex-1">How their bills are paid</p>
              <SaveTag state={save} />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {KINDS.map(k => (
                <button key={k.kind} type="button" onClick={() => { setKind(k.kind); setDirty(true); }}
                  className={cn("rounded-2xl border-2 p-3 text-left font-semibold min-h-14", kind === k.kind ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-secondary")}>
                  {k.title}
                </button>
              ))}
            </div>
            <div className="rounded-2xl bg-secondary/60 p-3 text-base leading-loose">
              {kind === "days_after" && <>Pay {numBox(days, setDays, "Days after the bill date")} days after the bill date.</>}
              {kind === "next_month_day" && <>Pay on day {numBox(day, setDay, "Day of the month")} of the month after the bill. <span className="text-sm text-muted-foreground">(31 = the last day of the month.)</span></>}
              {kind === "next_month_day_cutoff" && <>Bills dated up to day {numBox(cutoff, setCutoff, "Cut-off day")} are paid on day {numBox(day, setDay, "Day of the month")} of the next month; later bills the month after.</>}
              {kind === "qbo" && <>Use the due date QuickBooks gives each bill.</>}
              {!valid && <p className="text-sm font-semibold text-red-600">Days must be whole numbers (0–365); days of the month 1–31.</p>}
            </div>

            {theirLines.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-sm font-semibold">Their bills in the next {data.forecast.days.length} days</p>
                {theirLines.map(({ l, shownOn }) => (
                  <div key={l.key} className="rounded-xl bg-secondary/40 px-3 py-2 text-sm">
                    <span className="font-semibold">{l.label}</span> · {gbp(l.amount)} · on {dayLabel(shownOn, data.today)}
                    {explainBill(l).map((w, i) => <span key={i} className="block text-xs text-muted-foreground">{w}</span>)}
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              {ruleId == null && !dirty && (
                <button type="button" disabled={!valid} onClick={() => setDirty(true)}
                  className="h-11 px-5 rounded-xl border-2 border-primary text-primary font-bold disabled:opacity-40 hover:bg-primary/10">
                  Save rule
                </button>
              )}
              {ruleId != null && (
                <button type="button" disabled={remove.isPending} onClick={() => { if (window.confirm(`Remove the rule for ${vendor}? Their bills go back to QuickBooks' due dates.`)) remove.mutate(); }}
                  className="h-11 px-4 rounded-xl border-2 border-border font-semibold inline-flex items-center gap-2 hover:bg-secondary">
                  <Trash2 className="w-4 h-4" /> Remove rule
                </button>
              )}
              <button type="button" onClick={onClose} className="h-11 px-5 rounded-xl bg-primary text-primary-foreground font-bold ml-auto">Done</button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ItemsPanel({ data }: { data: CashFlow }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ label: "", direction: "out" as "in" | "out", amount: "", repeat: false, onDate: data.today, everyDays: "4", startsOn: data.today, endsOn: "", vendor: "" });
  const add = useMutation({
    mutationFn: () => {
      const vendor = data.vendors.find(v => String(v.id) === f.vendor);
      return api("/items", { method: "POST", body: JSON.stringify({
        label: f.label.trim(), direction: f.direction, amount: Number(f.amount.replace(/[£,\s]/g, "")),
        ...(f.repeat ? { everyDays: Number(f.everyDays), startsOn: f.startsOn, endsOn: f.endsOn || null } : { onDate: f.onDate }),
        finVendorId: vendor?.id ?? null, vendorName: vendor?.name ?? null,
      }) });
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["cash-flow"] }); setAdding(false); setF(x => ({ ...x, label: "", amount: "" })); },
    onError: (e: Error) => toast({ title: "Didn't add it", description: e.message, variant: "destructive" }),
  });
  const live = data.items.filter(i => i.active);
  const valid = f.label.trim() && Number(f.amount.replace(/[£,\s]/g, "")) > 0 && (f.repeat ? Number(f.everyDays) >= 1 && f.startsOn : f.onDate);

  return (
    <div className="rounded-3xl border-2 border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <p className="text-lg font-bold flex-1">Added money in & out</p>
        {!adding && <button type="button" onClick={() => setAdding(true)} className="h-10 px-3 rounded-xl border-2 border-border font-semibold inline-flex items-center gap-1.5 hover:bg-secondary"><Plus className="w-4 h-4" /> Add</button>}
      </div>
      {adding && (
        <div className="rounded-2xl border-2 border-primary/40 bg-primary/5 p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            {(["out", "in"] as const).map(dir => (
              <button key={dir} type="button" onClick={() => setF(x => ({ ...x, direction: dir }))}
                className={cn("h-10 rounded-xl border-2 font-semibold", f.direction === dir ? "border-primary bg-primary/10 text-primary" : "border-border")}>
                {dir === "out" ? "Money out" : "Money in"}
              </button>
            ))}
          </div>
          <input value={f.label} onChange={e => setF(x => ({ ...x, label: e.target.value }))} placeholder="What, e.g. Capital on Tap repayment" className="w-full h-11 px-3 rounded-xl border-2 border-border bg-card" />
          <input value={f.amount} onChange={e => setF(x => ({ ...x, amount: e.target.value }))} placeholder="Amount £" inputMode="decimal" className="w-full h-11 px-3 rounded-xl border-2 border-border bg-card" />
          <select value={f.vendor} onChange={e => setF(x => ({ ...x, vendor: e.target.value }))} className="w-full h-11 px-3 rounded-xl border-2 border-border bg-card">
            <option value="">Supplier (optional)</option>
            {data.vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setF(x => ({ ...x, repeat: false }))} className={cn("h-10 rounded-xl border-2 font-semibold", !f.repeat ? "border-primary bg-primary/10 text-primary" : "border-border")}>Once</button>
            <button type="button" onClick={() => setF(x => ({ ...x, repeat: true }))} className={cn("h-10 rounded-xl border-2 font-semibold", f.repeat ? "border-primary bg-primary/10 text-primary" : "border-border")}>Repeats</button>
          </div>
          {f.repeat ? (
            <div className="grid grid-cols-3 gap-2 text-sm">
              <label className="space-y-1"><span className="font-semibold">Every</span>
                <span className="flex items-center gap-1"><input value={f.everyDays} onChange={e => setF(x => ({ ...x, everyDays: e.target.value }))} inputMode="numeric" className="w-full h-10 px-2 rounded-lg border-2 border-border bg-card" /> days</span></label>
              <label className="space-y-1"><span className="font-semibold">From</span><input type="date" value={f.startsOn} onChange={e => setF(x => ({ ...x, startsOn: e.target.value }))} className="w-full h-10 px-2 rounded-lg border-2 border-border bg-card" /></label>
              <label className="space-y-1"><span className="font-semibold">Until</span><input type="date" value={f.endsOn} onChange={e => setF(x => ({ ...x, endsOn: e.target.value }))} className="w-full h-10 px-2 rounded-lg border-2 border-border bg-card" /></label>
            </div>
          ) : (
            <label className="text-sm space-y-1 block"><span className="font-semibold">On</span><input type="date" value={f.onDate} onChange={e => setF(x => ({ ...x, onDate: e.target.value }))} className="w-full h-10 px-2 rounded-lg border-2 border-border bg-card" /></label>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setAdding(false)} className="h-11 px-4 rounded-xl font-semibold hover:bg-secondary">Cancel</button>
            <button type="button" disabled={!valid || add.isPending} onClick={() => add.mutate()} className="h-11 px-5 rounded-xl bg-primary text-primary-foreground font-bold disabled:opacity-40 inline-flex items-center gap-2">
              {add.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Add
            </button>
          </div>
        </div>
      )}
      {live.length === 0 && !adding && <p className="text-sm text-muted-foreground">Nothing added yet — e.g. a card repayment every 4 days, a VAT bill, a loan payment.</p>}
      {live.map(i => <ItemRow key={i.id} item={i} />)}
    </div>
  );
}

/** One added item; amount and label autosave when you leave the field. */
function ItemRow({ item }: { item: Item }) {
  const qc = useQueryClient();
  const [label, setLabel] = useState(item.label);
  const [amount, setAmount] = useState(String(item.amount));
  const [every, setEvery] = useState(String(item.everyDays ?? ""));
  const [save, setSave] = useState<SaveState>("idle");
  const patch = async (body: Record<string, unknown>) => {
    setSave("saving");
    try {
      await api(`/items/${item.id}`, { method: "PATCH", body: JSON.stringify(body) });
      setSave("saved");
      void qc.invalidateQueries({ queryKey: ["cash-flow"] });
    } catch { setSave("error"); }
  };
  const stop = useMutation({
    mutationFn: () => api(`/items/${item.id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cash-flow"] }),
  });
  return (
    <div className="rounded-2xl border-2 border-border p-3 space-y-1.5">
      <div className="flex items-center gap-2">
        {item.direction === "in" ? <ArrowDownLeft className="w-4 h-4 text-emerald-600" /> : <ArrowUpRight className="w-4 h-4 text-muted-foreground" />}
        <input value={label} onChange={e => { setLabel(e.target.value); setSave("idle"); }} onBlur={() => label.trim() && label !== item.label && patch({ label: label.trim() })}
          className="flex-1 min-w-0 font-semibold bg-transparent focus:outline-none border-b border-transparent focus:border-primary" aria-label="What" />
        <SaveTag state={save} />
        <button type="button" onClick={() => stop.mutate()} aria-label="Remove" className="w-9 h-9 rounded-lg hover:bg-secondary inline-flex items-center justify-center"><Trash2 className="w-4 h-4" /></button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="inline-flex items-center gap-0.5">£<input value={amount} inputMode="decimal" onChange={e => { setAmount(e.target.value); setSave("idle"); }}
          onBlur={() => { const n = Number(amount.replace(/[£,\s]/g, "")); if (Number.isFinite(n) && n >= 0 && n !== item.amount) void patch({ amount: n }); }}
          className="w-24 h-8 px-1.5 rounded-lg border border-border bg-card tabular-nums" aria-label="Amount" /></span>
        {item.everyDays ? (
          <span className="inline-flex items-center gap-1 text-muted-foreground"><Repeat className="w-3.5 h-3.5" /> every
            <input value={every} inputMode="numeric" onChange={e => { setEvery(e.target.value); setSave("idle"); }}
              onBlur={() => { const n = Number(every); if (n >= 1 && n !== item.everyDays) void patch({ everyDays: n }); }}
              className="w-12 h-8 px-1.5 rounded-lg border border-border bg-card" aria-label="Every how many days" /> days from {item.startsOn}{item.endsOn ? ` to ${item.endsOn}` : ""}</span>
        ) : (
          <span className="text-muted-foreground">on {item.onDate}</span>
        )}
        {item.vendorName && <span className="text-muted-foreground">· {item.vendorName}</span>}
      </div>
    </div>
  );
}

