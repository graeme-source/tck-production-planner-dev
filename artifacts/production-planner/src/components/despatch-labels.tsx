/**
 * Despatch labels for the other desserts — cinnamon buns (Graeme,
 * 2026-10-27): the big 140 × 94 label, dated today, as one PDF. API:
 * /api/dessert-labels/despatch.
 *
 * 13 Nov 2026 (Graeme): the button only ever asks for what's STILL needed —
 * the day's orders minus the labels already printed for that dispatch day
 * (recorded server-side) — so a second despatch prints just the new orders'
 * labels, and when there are none it greys out: "All labels printed".
 * "Print some" stays for ad-hoc labels, any number (not capped at the orders).
 */
import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ChevronDown, Loader2, Printer } from "lucide-react";
import { cn } from "@/lib/utils";
import { LabelCountStepper } from "./label-count-stepper";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
/** Ad-hoc ceiling — the server's too (dessert-label-counts MAX_AD_HOC_LABELS). */
const AD_HOC_MAX = 200;

interface DespatchLine {
  title: string;
  quantity: number;
  recipeId: number | null;
  recipeName: string | null;
  count: number;
  /** Labels already printed for this dispatch day. */
  printed?: number;
  /** Still needed: count − printed. */
  left?: number;
  ready: boolean;
  message: string | null;
}

export function useDespatchLabels(tag: string) {
  return useQuery<{ tag: string; lines: DespatchLine[] }>({
    queryKey: ["despatch-labels", tag],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/dessert-labels/despatch?tag=${encodeURIComponent(tag)}`, { credentials: "include" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      return body;
    },
    // New orders come in through the day — keep the "still needed" fresh.
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export const PRIMARY_BTN = "h-12 px-5 rounded-xl bg-primary text-primary-foreground font-bold inline-flex items-center gap-2 hover:bg-primary/90 active:scale-[0.98] disabled:opacity-60";
export const DONE_BTN = "h-12 px-5 rounded-xl bg-secondary text-muted-foreground font-bold inline-flex items-center gap-2 cursor-default";
export const SOME_BTN = "h-12 px-4 rounded-xl border-2 border-border text-sm font-semibold hover:bg-secondary inline-flex items-center gap-1";

/** The print button (or what's stopping it) for one dessert report line. */
export function DespatchLabelsButton({ tag, title }: { tag: string; title: string }) {
  const qc = useQueryClient();
  const q = useDespatchLabels(tag);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [someOpen, setSomeOpen] = useState(false);
  const [some, setSome] = useState<number | null>(null);
  const [printedSome, setPrintedSome] = useState<number | null>(null);
  const line = q.data?.lines.find(l => l.title === title);
  if (!line || line.recipeId == null || line.count < 1) return null;

  if (!line.ready) {
    return (
      <p className="basis-full text-sm font-semibold text-amber-800 dark:text-amber-300 flex flex-wrap items-center gap-x-2 gap-y-1">
        <AlertTriangle className="w-4 h-4 shrink-0" />
        <span>{line.message}</span>
        <Link href={`/labels/${line.recipeId}`} className="underline underline-offset-2 text-primary">Open the {line.recipeName ?? title} label</Link>
      </p>
    );
  }

  const printed = line.printed ?? 0;
  const left = line.left ?? line.count;
  const someCount = Math.min(AD_HOC_MAX, Math.max(1, some ?? (left || 1)));

  /** No count = what's still needed. */
  const print = async (count?: number) => {
    setError(null);
    // Open the tab on the tap itself: iPad Safari blocks one opened after an await.
    const tab = window.open("", "_blank");
    setBusy(true);
    try {
      const res = await fetch(`${BASE}/api/dessert-labels/despatch/print`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag, recipeId: line.recipeId, ...(count !== undefined ? { count } : {}) }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      if (tab) tab.location.href = url;
      else { const a = document.createElement("a"); a.href = url; a.download = `despatch-labels-${tag}.pdf`; a.click(); }
      if (count !== undefined) setPrintedSome(count);
      await qc.invalidateQueries({ queryKey: ["despatch-labels", tag] });
    } catch (e) {
      tab?.close();
      setError(e instanceof Error ? e.message : "Couldn't make the labels");
    } finally {
      setBusy(false);
    }
  };

  return (
    // display:contents — the buttons sit on the report row's own line.
    <div className="contents">
        {left > 0 ? (
          <button type="button" onClick={() => print()} disabled={busy} className={PRIMARY_BTN}>
            {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Printer className="w-5 h-5" />}
            Print {left}{printed > 0 ? " more" : ""} label{left === 1 ? "" : "s"}
          </button>
        ) : (
          <span className={DONE_BTN} aria-disabled="true">
            <Check className="w-5 h-5" /> All labels printed today
          </span>
        )}
        <button type="button" onClick={() => setSomeOpen(o => !o)} aria-expanded={someOpen} className={SOME_BTN}>
          Print some <ChevronDown className={cn("w-4 h-4 transition-transform", someOpen && "rotate-180")} />
        </button>
      {someOpen && (
        <div className="basis-full flex flex-wrap items-center gap-3 pt-1">
          <LabelCountStepper value={someCount} min={1} max={AD_HOC_MAX} onChange={setSome} label={`${line.recipeName ?? title} labels`} />
          <button type="button" onClick={() => print(someCount)} disabled={busy} className={PRIMARY_BTN}>
            {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Printer className="w-5 h-5" />}
            Print {someCount} label{someCount === 1 ? "" : "s"}
          </button>
          {printedSome !== null && <span className="text-sm text-emerald-700 dark:text-emerald-400 font-semibold inline-flex items-center gap-1"><Check className="w-4 h-4" /> Sent {printedSome}</span>}
        </div>
      )}
      {error && <p className="basis-full text-sm text-destructive font-semibold">{error}</p>}
    </div>
  );
}
