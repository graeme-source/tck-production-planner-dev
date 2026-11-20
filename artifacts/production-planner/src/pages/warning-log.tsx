/**
 * Dismissed warnings (Graeme, 20 Nov 2026): who dismissed, put off or carried
 * on past an operational warning, when, and what it said — so "was it
 * ignored, or did someone dismiss it?" always has an answer (#140013 was
 * named by the 2:16 check on 18 Nov and never sent). Managers.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BellOff, Loader2 } from "lucide-react";
import { ACTION_LABELS, WARNING_LABELS } from "@/lib/warning-log";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Row = { id: number; warning: string; action: string; detail: string | null; page: string | null; userName: string | null; createdAt: string };

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });

export default function WarningLogPage() {
  const [days, setDays] = useState(14);
  const [kind, setKind] = useState<string>("all");
  const q = useQuery<{ items: Row[] }>({
    queryKey: ["warning-log", days],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/warning-log?days=${days}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      return res.json();
    },
    refetchInterval: 60_000,
  });
  const items = (q.data?.items ?? []).filter(r => kind === "all" || r.warning === kind);
  const kinds = [...new Set((q.data?.items ?? []).map(r => r.warning))];

  return (
    <div className="w-full space-y-4">
      <div>
        <h1 className="text-2xl sm:text-3xl font-display font-bold flex items-center gap-2"><BellOff className="w-7 h-7 text-primary" /> Dismissed warnings</h1>
        <p className="text-muted-foreground mt-1">Who dismissed, put off or carried on past a warning, and when.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {[7, 14, 30].map(d => (
          <button key={d} onClick={() => setDays(d)}
            className={cn("h-10 px-4 rounded-xl border-2 font-semibold", days === d ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card")}>
            Last {d} days
          </button>
        ))}
        <select value={kind} onChange={e => setKind(e.target.value)} className="h-10 px-3 rounded-xl border-2 border-border bg-card font-semibold">
          <option value="all">Every warning</option>
          {kinds.map(k => <option key={k} value={k}>{WARNING_LABELS[k] ?? k}</option>)}
        </select>
      </div>

      {q.isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-border p-10 text-center text-muted-foreground">Nothing dismissed in this time.</div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {items.map(r => (
            <div key={r.id} className="rounded-2xl border-2 border-border bg-card p-4 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200 px-2.5 py-0.5 text-xs font-bold">{WARNING_LABELS[r.warning] ?? r.warning}</span>
                <span className="text-sm font-semibold">{ACTION_LABELS[r.action] ?? r.action}</span>
              </div>
              <p className="text-lg font-bold">{r.userName ?? "Someone"} <span className="font-normal text-muted-foreground">· {when(r.createdAt)}</span></p>
              {r.detail && <p className="text-base break-words">{r.detail}</p>}
              {r.page && <p className="text-xs text-muted-foreground break-words">On {r.page.replace(/^https?:\/\/[^/]+/, "")}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
