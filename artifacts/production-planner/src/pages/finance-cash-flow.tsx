/**
 * Finance → Cash flow (Graeme, 2026-10-26): "how much cash we've got in the
 * bank ... what's due in the next week or so ... miscellaneous outflows on
 * different days ... associate those with suppliers ... 'recurring every 4
 * days' ... bring the Shopify payout values directly from Shopify."
 *
 * A day-by-day running balance: the bank balance (set by hand), Shopify
 * payouts in (live), QuickBooks bills out on their due dates (live), and the
 * money in/out added here. A tab of the Finance page. API: /api/cash-flow.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowUpRight, Check, Loader2, Plus, Repeat, Trash2, Wallet } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Line { source: "bill" | "payout" | "item"; ref: string; label: string; amount: number; late: boolean; undated?: boolean }
interface Day { date: string; opening: number; ins: Line[]; outs: Line[]; closing: number }
interface Item {
  id: number; label: string; direction: "in" | "out"; amount: number; onDate: string | null; everyDays: number | null;
  startsOn: string | null; endsOn: string | null; finVendorId: number | null; vendorName: string | null; notes: string | null; active: boolean;
}
interface CashFlow {
  today: string;
  balance: { amount: number; asOf: string; set: boolean; updatedBy: string | null; updatedAt: string | null };
  forecast: { start: string; openingBalance: number; days: Day[]; lowest: { date: string; balance: number } | null; totalIn: number; totalOut: number };
  items: Item[];
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

const gbp = (n: number) => `${n < 0 ? "−" : ""}£${Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const gbp0 = (n: number) => `${n < 0 ? "−" : ""}£${Math.round(Math.abs(n)).toLocaleString("en-GB")}`;
const dayLabel = (d: string, today: string) => d === today ? "Today" : new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

type SaveState = "idle" | "saving" | "saved" | "error";
function SaveTag({ state }: { state: SaveState }) {
  if (state === "saving") return <span className="text-xs text-muted-foreground inline-flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Saving</span>;
  if (state === "saved") return <span className="text-xs text-primary inline-flex items-center gap-1"><Check className="w-3 h-3" /> Saved</span>;
  if (state === "error") return <span className="text-xs text-red-600">Didn't save</span>;
  return null;
}

/** The Cash flow tab inside Finance (pages/finance.tsx decides who sees it). */
export function CashFlowPanel() {
  const [days, setDays] = useState(14);
  const q = useQuery({ queryKey: ["cash-flow", days], queryFn: () => api<CashFlow>(`?days=${days}`), refetchInterval: 5 * 60_000 });
  const d = q.data;

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

          <Sources s={d.sources} />

          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-muted-foreground">Show</span>
            {[7, 14, 30, 60].map(n => (
              <button key={n} type="button" onClick={() => setDays(n)}
                className={cn("h-10 px-3 rounded-xl border-2 text-sm font-semibold", days === n ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-secondary")}>
                {n} days
              </button>
            ))}
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px] items-start">
            <div className="space-y-2">
              {d.forecast.days.map(day => <DayCard key={day.date} day={day} today={d.today} />)}
            </div>
            <ItemsPanel data={d} />
          </div>
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

function DayCard({ day, today }: { day: Day; today: string }) {
  const quiet = day.ins.length === 0 && day.outs.length === 0;
  if (quiet) {
    return (
      <div className="rounded-xl border border-border px-4 py-2 flex items-center gap-3 text-sm text-muted-foreground">
        <span className="w-28 font-semibold">{dayLabel(day.date, today)}</span>
        <span className="flex-1">Nothing in or out</span>
        <span className={cn("tabular-nums font-semibold", day.closing < 0 && "text-red-600")}>{gbp0(day.closing)}</span>
      </div>
    );
  }
  return (
    <div className={cn("rounded-2xl border-2 bg-card p-3 space-y-2", day.closing < 0 ? "border-red-400" : "border-border")}>
      <div className="flex items-baseline gap-3">
        <p className="text-lg font-bold w-28">{dayLabel(day.date, today)}</p>
        <p className="text-sm text-muted-foreground flex-1">from {gbp0(day.opening)}</p>
        <p className={cn("text-2xl font-display font-bold tabular-nums", day.closing < 0 && "text-red-600")}>{gbp0(day.closing)}</p>
      </div>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {day.ins.map((l, i) => <LineRow key={`i${i}`} l={l} dir="in" />)}
        {day.outs.map((l, i) => <LineRow key={`o${i}`} l={l} dir="out" />)}
      </div>
    </div>
  );
}

function LineRow({ l, dir }: { l: Line; dir: "in" | "out" }) {
  return (
    <div className={cn("rounded-xl px-2.5 py-1.5 flex items-center gap-2 text-sm", dir === "in" ? "bg-emerald-50 dark:bg-emerald-950/30" : "bg-secondary/60")}>
      {dir === "in" ? <ArrowDownLeft className="w-4 h-4 text-emerald-600 flex-shrink-0" /> : <ArrowUpRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
      <span className="flex-1 min-w-0 break-words">
        {l.label}
        {l.late && <span className="ml-1.5 text-xs font-bold text-red-600">{l.source === "bill" ? "OVERDUE" : "LATE"}</span>}
        {l.undated && <span className="ml-1.5 text-xs font-bold text-amber-700">NO DUE DATE</span>}
        <span className="block text-xs text-muted-foreground">{l.source === "bill" ? "QuickBooks bill" : l.source === "payout" ? "Shopify" : "Added here"}</span>
      </span>
      <span className={cn("tabular-nums font-bold", dir === "in" ? "text-emerald-700 dark:text-emerald-400" : "")}>{dir === "in" ? "+" : "−"}{gbp(l.amount).replace("−", "")}</span>
    </div>
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
    <div className="rounded-3xl border-2 border-border bg-card p-4 space-y-3 xl:sticky xl:top-4">
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

