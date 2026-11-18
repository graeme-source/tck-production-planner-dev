// QuickBooks "Profit and Loss by Month" on the founder P&L page (Graeme,
// 18 Nov 2026; Objective I, finance & reporting). Read only: the figures come
// straight from QuickBooks (accrual basis), laid out like his report there —
// months across, groups that open to their accounts.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, RefreshCw, AlertTriangle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface PnlLine {
  key: string;
  name: string;
  accountId: string | null;
  depth: number;
  kind: "section" | "account" | "total";
  group: string | null;
  amounts: number[];
  total: number;
  children: PnlLine[];
}

interface PnlByMonth {
  fromMonth: string;
  toMonth: string;
  months: Array<{ key: string; label: string }>;
  lines: PnlLine[];
  basis: string | null;
  fetchedAt: string;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthOptions(): Array<{ key: string; label: string }> {
  const now = new Date();
  const out: Array<{ key: string; label: string }> = [];
  for (let y = now.getFullYear(); y >= 2020; y--) {
    for (let m = 12; m >= 1; m--) {
      if (y === now.getFullYear() && m > now.getMonth() + 1) continue;
      out.push({ key: `${y}-${String(m).padStart(2, "0")}`, label: `${MONTH_NAMES[m - 1]} ${y}` });
    }
  }
  return out;
}

async function fetchPnlByMonth(fromMonth: string | null, toMonth: string | null, fresh: boolean): Promise<PnlByMonth> {
  const q = new URLSearchParams();
  if (fromMonth) q.set("fromMonth", fromMonth);
  if (toMonth) q.set("toMonth", toMonth);
  if (fresh) q.set("fresh", "1");
  const res = await fetch(`${BASE}/api/pnl-qbo/by-month?${q}`, { credentials: "include" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? "Couldn't load the QuickBooks P&L");
  return body as PnlByMonth;
}

const gbp0 = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });
const num2 = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function cell(n: number): string {
  return n === 0 ? "" : num2.format(n);
}

function findGroup(lines: PnlLine[], group: string): PnlLine | undefined {
  return lines.find(l => l.group === group && l.depth === 0);
}

export function PnlByMonthCard() {
  const queryClient = useQueryClient();
  const [range, setRange] = useState<{ fromMonth: string; toMonth: string } | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const options = useMemo(monthOptions, []);

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ["pnl-qbo-by-month", range?.fromMonth ?? null, range?.toMonth ?? null],
    queryFn: () => fetchPnlByMonth(range?.fromMonth ?? null, range?.toMonth ?? null, false),
    staleTime: 10 * 60 * 1000,
  });

  const fromMonth = range?.fromMonth ?? data?.fromMonth ?? "";
  const toMonth = range?.toMonth ?? data?.toMonth ?? "";

  // Refresh skips the server's half-hour hold and asks QuickBooks again.
  const queryKey = ["pnl-qbo-by-month", range?.fromMonth ?? null, range?.toMonth ?? null];
  const refresh = useMutation({
    mutationFn: () => fetchPnlByMonth(fromMonth || null, toMonth || null, true),
    onSuccess: fresh => queryClient.setQueryData(queryKey, fresh),
  });

  function pick(which: "fromMonth" | "toMonth", value: string) {
    const next = { fromMonth, toMonth, [which]: value };
    if (next.fromMonth > next.toMonth) {
      if (which === "fromMonth") next.toMonth = value; else next.fromMonth = value;
    }
    setRange(next);
  }

  function toggle(key: string) {
    setOpen(prev => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key); else n.add(key);
      return n;
    });
  }

  const allSectionKeys = useMemo(() => {
    const keys: string[] = [];
    const walk = (ls: PnlLine[]) => { for (const l of ls) { if (l.children.length) { keys.push(l.key); walk(l.children); } } };
    walk(data?.lines ?? []);
    return keys;
  }, [data]);
  const allOpen = allSectionKeys.length > 0 && allSectionKeys.every(k => open.has(k));

  const income = data ? findGroup(data.lines, "Income") : undefined;
  const gross = data ? findGroup(data.lines, "GrossProfit") : undefined;
  const expenses = data ? findGroup(data.lines, "Expenses") : undefined;
  const net = data ? findGroup(data.lines, "NetIncome") : undefined;
  const pct = (n?: number) => (income && income.total ? `${((n ?? 0) / income.total * 100).toFixed(1)}% of income` : undefined);

  const rows: PnlLine[] = [];
  const walk = (ls: PnlLine[]) => {
    for (const l of ls) {
      rows.push(l);
      if (l.children.length && open.has(l.key)) walk(l.children);
    }
  };
  walk(data?.lines ?? []);

  const fetchedAt = data?.fetchedAt
    ? new Date(data.fetchedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })
    : null;

  return (
    <section className="glass-panel rounded-2xl overflow-hidden">
      <div className="p-5 flex flex-wrap items-end justify-between gap-4 border-b border-border">
        <div>
          <h2 className="text-lg font-display font-bold">Profit and Loss by Month</h2>
          <p className="text-sm text-muted-foreground">
            From QuickBooks · {data?.basis ?? "Accrual"} basis{fetchedAt ? ` · read at ${fetchedAt}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="block text-xs text-muted-foreground mb-1">From</span>
            <select
              value={fromMonth}
              onChange={e => pick("fromMonth", e.target.value)}
              className="h-11 rounded-lg border border-border bg-background px-3"
            >
              {options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-xs text-muted-foreground mb-1">To</span>
            <select
              value={toMonth}
              onChange={e => pick("toMonth", e.target.value)}
              className="h-11 rounded-lg border border-border bg-background px-3"
            >
              {options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </label>
          <button
            onClick={() => refresh.mutate()}
            disabled={isFetching || refresh.isPending}
            className="h-11 inline-flex items-center gap-2 px-4 rounded-lg border border-border bg-background text-sm font-medium hover:bg-secondary disabled:opacity-60"
          >
            <RefreshCw className={`w-4 h-4 ${isFetching || refresh.isPending ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {(error || refresh.error) && (
        <p className="m-5 p-4 rounded-xl bg-destructive/5 text-sm text-destructive flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {(error ?? refresh.error) instanceof Error ? (error ?? refresh.error)!.message : "Couldn't load the QuickBooks P&L"}
        </p>
      )}

      {/* Headline cards for the range */}
      <div className="p-5 grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { title: "Income", line: income, sub: undefined },
          { title: "Gross profit", line: gross, sub: pct(gross?.total) },
          { title: "Expenses", line: expenses, sub: pct(expenses?.total) },
          { title: "Net income", line: net, sub: pct(net?.total) },
        ].map(k => (
          <div key={k.title} className="rounded-2xl bg-secondary/40 p-5">
            <p className="text-sm font-medium text-muted-foreground">{k.title}</p>
            {isLoading ? <Skeleton className="h-8 w-28 mt-2" /> : (
              <p className={`text-2xl font-display font-bold mt-1 ${(k.line?.total ?? 0) < 0 ? "text-red-600" : ""}`}>
                {k.line ? gbp0.format(k.line.total) : "—"}
              </p>
            )}
            {k.sub && <p className="text-xs text-muted-foreground mt-1">{k.sub}</p>}
          </div>
        ))}
      </div>

      {/* The report itself */}
      {isLoading ? (
        <div className="px-5 pb-5 space-y-2">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-7 w-full" />)}</div>
      ) : data && data.lines.length > 0 ? (
        <div className="px-5 pb-5">
          <div className="flex justify-end mb-2">
            <button
              onClick={() => setOpen(allOpen ? new Set() : new Set(allSectionKeys))}
              className="text-sm font-medium text-primary hover:underline"
            >
              {allOpen ? "Collapse all" : "Expand all"}
            </button>
          </div>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm tabular-nums">
              <thead className="bg-secondary/50">
                <tr>
                  <th className="sticky left-0 z-10 bg-secondary text-left font-semibold px-3 py-2 min-w-[14rem]" />
                  {data.months.map(m => <th key={m.key} className="text-right font-semibold px-3 py-2 whitespace-nowrap">{m.label}</th>)}
                  <th className="text-right font-semibold px-3 py-2">Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(l => {
                  const bold = l.kind !== "account";
                  const isTotal = l.kind === "total";
                  return (
                    <tr key={l.key} className={`border-t border-border ${isTotal ? "bg-secondary/30" : ""}`}>
                      <td className={`sticky left-0 z-10 px-3 py-2 ${isTotal ? "bg-secondary" : "bg-background"} ${bold ? "font-semibold" : ""}`}>
                        <div className="flex items-center gap-1" style={{ paddingLeft: `${l.depth * 1.1}rem` }}>
                          {l.children.length > 0 ? (
                            <button onClick={() => toggle(l.key)} className="flex items-center gap-1 text-left hover:text-primary">
                              {open.has(l.key) ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
                              <span>{l.name}</span>
                            </button>
                          ) : (
                            <span className={l.depth > 0 ? "pl-5" : ""}>{l.name}</span>
                          )}
                        </div>
                      </td>
                      {l.amounts.map((a, i) => (
                        <td key={i} className={`text-right px-3 py-2 whitespace-nowrap ${bold ? "font-semibold" : ""} ${a < 0 && isTotal ? "text-red-600" : ""}`}>{cell(a)}</td>
                      ))}
                      <td className={`text-right px-3 py-2 whitespace-nowrap font-semibold ${l.total < 0 && isTotal ? "text-red-600" : ""}`}>
                        {l.total === 0 ? "" : gbp0.format(l.total)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : data ? (
        <p className="px-5 pb-5 text-sm text-muted-foreground">QuickBooks has nothing for these months.</p>
      ) : null}
    </section>
  );
}
