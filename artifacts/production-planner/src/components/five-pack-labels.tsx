/**
 * Brownie 5-pack despatch labels (Graeme, 2026-10-27): one tap prints every
 * 5-pack label for the delivery day — each flavour's own name, "5 PACK", the
 * use-by and that flavour's barcode — as one PDF for the 102 × 25 mm label
 * printer. "See the labels" shows each flavour's label and how many print.
 * Sits on every dessert report card (packing station, opening checklist,
 * fulfilment). API: /api/dessert-labels.
 *
 * 13 Nov 2026 (Graeme): the main button prints only the labels STILL needed
 * — each flavour's orders minus what's already printed for the dispatch day
 * (recorded server-side) — and greys out once everything's printed. "Print
 * some" is ad hoc: any number per flavour, not capped at the orders.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DONE_BTN, PRIMARY_BTN, SOME_BTN } from "./despatch-labels";
import { Check, ChevronDown, Loader2, Printer, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/auth-context";
import { LabelCountStepper } from "./label-count-stepper";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface FivePackLabels {
  tag: string;
  useByDays: number;
  useBy: string;
  total: number;
  /** Already printed for the dispatch day, and still needed. */
  printed?: number;
  left?: number;
  lines: Array<{ variantId: string | null; productTitle: string; quantity: number; printed?: number; left?: number; barcode: string | null; png: string; barcodeProblem: string | null }>;
}

/** The day's 5-pack labels: per flavour ordered / printed / still needed. */
export function useFivePackLabels(tag: string) {
  return useQuery<FivePackLabels>({
    queryKey: ["five-pack-labels", tag],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/dessert-labels?tag=${encodeURIComponent(tag)}`, { credentials: "include" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      return body as FivePackLabels;
    },
    // New orders come in through the day — keep the "still needed" fresh.
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

/** Inline controls for the 5-pack row of the desserts report: they sit on
 *  the same line as the row's name and number (the root is display:contents);
 *  "Print some" and the flavour breakdown open full width underneath. */
export function FivePackLabelsButton({ tag }: { tag: string }) {
  const { state } = useAuth();
  const role = state.status === "authenticated" ? state.user.role : "viewer";
  const canEditUseBy = role === "admin" || role === "manager";
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [someOpen, setSomeOpen] = useState(false);
  const qc = useQueryClient();
  const [some, setSome] = useState<Record<string, number>>({});
  const [printedSome, setPrintedSome] = useState<number | null>(null);
  const q = useFivePackLabels(tag);
  const d = q.data;
  const missing = (d?.lines ?? []).filter(l => !l.barcode).length;

  // Same key the server uses: the variant, else the flavour's name.
  const keyOf = (l: { variantId: string | null; productTitle: string }) => l.variantId ?? l.productTitle;
  // Ad hoc: starts at what's still needed (or the day's quantity), any number up to 200.
  const someCounts: Record<string, number> = Object.fromEntries((d?.lines ?? []).map(l => [keyOf(l), Math.min(200, Math.max(0, some[keyOf(l)] ?? (l.left ?? l.quantity)))]));
  const someTotal = Object.values(someCounts).reduce((t, n) => t + n, 0);

  /** No counts = every label for the day (the one-tap default). */
  const print = async (counts?: Record<string, number>) => {
    setError(null);
    // Open the tab on the tap itself: iPad Safari blocks one opened after an await.
    const tab = window.open("", "_blank");
    setBusy(true);
    try {
      const res = await fetch(`${BASE}/api/dessert-labels/print`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(counts ? { tag, counts } : { tag }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      if (tab) tab.location.href = url;
      else { const a = document.createElement("a"); a.href = url; a.download = `5-pack-labels-${tag}.pdf`; a.click(); }
      if (counts) setPrintedSome(Object.values(counts).reduce((t, n) => t + n, 0));
      await qc.invalidateQueries({ queryKey: ["five-pack-labels", tag] });
    } catch (e) {
      tab?.close();
      setError(e instanceof Error ? e.message : "Couldn't make the labels");
    } finally {
      setBusy(false);
    }
  };

  if (q.isError) return <p className="basis-full text-sm text-destructive font-semibold">Couldn't load the 5-pack labels — {(q.error as Error).message}</p>;
  if (!d || d.total === 0) return null;
  const left = d.left ?? d.total;
  const printedSoFar = d.printed ?? 0;
  return (
    <div className="contents">
        {left > 0 ? (
          <button type="button" onClick={() => print()} disabled={busy} data-tour="five-pack-labels" className={PRIMARY_BTN}>
            {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Printer className="w-5 h-5" />}
            Print {left}{printedSoFar > 0 ? " more" : ""} label{left === 1 ? "" : "s"}
          </button>
        ) : (
          <span className={DONE_BTN} aria-disabled="true" data-tour="five-pack-labels">
            <Check className="w-5 h-5" /> All labels printed today
          </span>
        )}
        <button type="button" onClick={() => setSomeOpen(o => !o)} aria-expanded={someOpen} className={SOME_BTN}>
          Print some <ChevronDown className={cn("w-4 h-4 transition-transform", someOpen && "rotate-180")} />
        </button>
        <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} data-tour="five-pack-labels-see"
          className="h-12 px-3 rounded-xl text-sm font-semibold text-muted-foreground hover:bg-secondary inline-flex items-center gap-1">
          Flavours <ChevronDown className={cn("w-4 h-4 transition-transform", open && "rotate-180")} />
        </button>
      {someOpen && (
        <div className="basis-full space-y-2 pt-1">
          {d.lines.map(l => (
            <div key={keyOf(l)} className="flex flex-wrap items-center justify-between gap-2 rounded-xl ring-1 ring-border px-3 py-2">
              <span className="font-semibold">{l.productTitle}</span>
              <LabelCountStepper value={someCounts[keyOf(l)] ?? 0} min={0} max={200} label={`${l.productTitle} 5-pack labels`}
                onChange={n => setSome(s => ({ ...s, [keyOf(l)]: n }))} />
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => print(someCounts)} disabled={busy || someTotal < 1} className={PRIMARY_BTN}>
              {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Printer className="w-5 h-5" />}
              Print {someTotal} 5-pack label{someTotal === 1 ? "" : "s"}
            </button>
            {printedSome !== null && <span className="text-sm text-emerald-700 dark:text-emerald-400 font-semibold inline-flex items-center gap-1"><Check className="w-4 h-4" /> Sent {printedSome}</span>}
          </div>
        </div>
      )}
      {missing > 0 && (
        <p className="basis-full text-xs text-amber-700 dark:text-amber-300 font-semibold">
          {missing} flavour{missing === 1 ? " has" : "s have"} no barcode — {missing === 1 ? "it prints" : "they print"} without one.
        </p>
      )}
      {error && <p className="basis-full text-sm text-destructive font-semibold">{error}</p>}
      {open && (
        <div className="basis-full space-y-3 pt-1">
          {d.lines.map(l => (
            <div key={l.variantId ?? l.productTitle} className="space-y-1">
              <p className="text-sm font-semibold">{l.productTitle} × {l.quantity}{l.printed ? ` · ${l.printed} printed` : ""}{l.barcode ? "" : " — no barcode"}</p>
              <img src={l.png} alt={`5-pack label: ${l.productTitle}`} className="w-full max-w-xl rounded-lg ring-1 ring-border bg-white" />
            </div>
          ))}
          <p className="text-xs text-muted-foreground">Use by {d.useBy} ({d.useByDays} days from today).</p>
          {canEditUseBy && <UseByDays tag={tag} days={d.useByDays} />}
        </div>
      )}
    </div>
  );
}

/** How many days the 5-pack use-by is from printing — saves on change. */
function UseByDays({ tag, days }: { tag: string; days: number }) {
  const qc = useQueryClient();
  const [text, setText] = useState(String(days));
  const save = useMutation({
    mutationFn: async (n: number) => {
      const res = await fetch(`${BASE}/api/dessert-labels/settings`, {
        method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ useByDays: n }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["five-pack-labels", tag] }),
  });
  const n = Number(text);
  const valid = Number.isInteger(n) && n >= 1 && n <= 90;
  return (
    <label className="flex flex-wrap items-center gap-2 text-sm">
      <span className="font-semibold">Use-by</span>
      <input inputMode="numeric" value={text} onChange={e => setText(e.target.value)}
        onBlur={() => { if (valid && n !== days) save.mutate(n); }}
        className={cn("w-20 h-11 px-3 rounded-xl border-2 bg-background tabular-nums", valid ? "border-border" : "border-destructive")} />
      <span>days after printing</span>
      {save.isPending ? <span className="text-muted-foreground inline-flex items-center gap-1"><Loader2 className="w-4 h-4 animate-spin" /> Saving…</span>
        : save.isError ? <span className="text-destructive inline-flex items-center gap-1"><X className="w-4 h-4" /> Didn't save</span>
        : save.isSuccess ? <span className="text-emerald-700 dark:text-emerald-400 inline-flex items-center gap-1"><Check className="w-4 h-4" /> Saved</span> : null}
    </label>
  );
}
