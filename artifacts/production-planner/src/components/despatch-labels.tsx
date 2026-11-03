/**
 * Despatch labels for the other desserts — cinnamon buns (Graeme,
 * 2026-10-27). The buns are wrapped with a small 180-day freezer label; on
 * the despatch morning they come out of the freezer and the big 140 × 94
 * label (best before despatch + 3, use by despatch + 5) goes over the top.
 * One tap beside the line on the dessert report prints that line's
 * quantity of the recipe's LIVE label, dated today, as one PDF. Not
 * published (or changed since) = no button, just what to do and a link to
 * its label page. Sits on every dessert report (packing station, opening
 * checklist, fulfilment). API: /api/dessert-labels/despatch.
 *
 * "Print some" (fix-queue #374): a − / + number starting at the day's total
 * for a second packing run; the server caps it at the day's total.
 */
import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, ChevronDown, Loader2, Printer } from "lucide-react";
import { formatLabelDate } from "@workspace/product-labels";
import { cn } from "@/lib/utils";
import { LabelCountStepper } from "./label-count-stepper";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface DespatchLine {
  title: string;
  quantity: number;
  recipeId: number | null;
  recipeName: string | null;
  count: number;
  ready: boolean;
  message: string | null;
  dates?: { useBy: string | null; printDate: string } | null;
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
    staleTime: 60_000,
  });
}

/** The print button (or what's stopping it) for one dessert report line. */
export function DespatchLabelsButton({ tag, title }: { tag: string; title: string }) {
  const q = useDespatchLabels(tag);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [printed, setPrinted] = useState(false);
  const [someOpen, setSomeOpen] = useState(false);
  const [some, setSome] = useState<number | null>(null);
  const [printedSome, setPrintedSome] = useState<number | null>(null);
  const line = q.data?.lines.find(l => l.title === title);
  // Lines with no recipe link (or a dessert with no label at all) show nothing.
  if (!line || line.recipeId == null || line.count < 1) return null;

  if (!line.ready) {
    return (
      <p className="mt-2 text-sm font-semibold text-amber-800 dark:text-amber-300 flex flex-wrap items-center gap-x-2 gap-y-1">
        <AlertTriangle className="w-4 h-4 shrink-0" />
        <span>{line.message}</span>
        <Link href={`/labels/${line.recipeId}`} className="underline underline-offset-2 text-primary">Open the {line.recipeName ?? title} label</Link>
      </p>
    );
  }

  const someCount = Math.min(line.count, Math.max(1, some ?? line.count));

  /** No count = the whole day (the one-tap default). */
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
      if (count === undefined) setPrinted(true); else setPrintedSome(count);
    } catch (e) {
      tab?.close();
      setError(e instanceof Error ? e.message : "Couldn't make the labels");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => print()} disabled={busy}
          className="h-12 px-5 rounded-xl bg-primary text-primary-foreground font-bold inline-flex items-center gap-2 hover:bg-primary/90 active:scale-[0.98] disabled:opacity-60">
          {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : printed ? <Check className="w-5 h-5" /> : <Printer className="w-5 h-5" />}
          {printed ? "Print again" : `Print ${line.count} label${line.count === 1 ? "" : "s"}`}
        </button>
        <button type="button" onClick={() => setSomeOpen(o => !o)} aria-expanded={someOpen}
          className="h-12 px-4 rounded-xl border-2 border-border text-sm font-semibold hover:bg-secondary inline-flex items-center gap-1">
          Print some <ChevronDown className={cn("w-4 h-4 transition-transform", someOpen && "rotate-180")} />
        </button>
      </div>
      {someOpen && (
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <LabelCountStepper value={someCount} min={1} max={line.count} onChange={setSome} label={`${line.recipeName ?? title} labels`} />
          <button type="button" onClick={() => print(someCount)} disabled={busy}
            className="h-12 px-5 rounded-xl bg-primary text-primary-foreground font-bold inline-flex items-center gap-2 hover:bg-primary/90 active:scale-[0.98] disabled:opacity-60">
            {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Printer className="w-5 h-5" />}
            Print {someCount} label{someCount === 1 ? "" : "s"}
          </button>
          {printedSome !== null && <span className="text-sm text-emerald-700 dark:text-emerald-400 font-semibold inline-flex items-center gap-1"><Check className="w-4 h-4" /> Sent {printedSome}</span>}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        The {line.recipeName} despatch label{line.dates?.useBy ? `, use by ${formatLabelDate(line.dates.useBy)}` : ""}, dated today. Print at Actual size (no “fit to page”).
      </p>
      {error && <p className="text-sm text-destructive font-semibold">{error}</p>}
    </div>
  );
}
