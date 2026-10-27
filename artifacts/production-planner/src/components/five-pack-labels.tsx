/**
 * Brownie 5-pack despatch labels (Graeme, 2026-10-27): one tap prints every
 * 5-pack label for the delivery day — each flavour's own name, "5 PACK", the
 * use-by and that flavour's barcode — as one PDF for the 102 × 25 mm label
 * printer. "See the labels" shows each flavour's label and how many print.
 * Sits on every dessert report card (packing station, opening checklist,
 * fulfilment). API: /api/dessert-labels.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Loader2, Printer, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/auth-context";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface FivePackLabels {
  tag: string;
  useByDays: number;
  useBy: string;
  total: number;
  lines: Array<{ variantId: string | null; productTitle: string; quantity: number; barcode: string | null; png: string; barcodeProblem: string | null }>;
}

export function FivePackLabelsButton({ tag }: { tag: string }) {
  const { state } = useAuth();
  const role = state.status === "authenticated" ? state.user.role : "viewer";
  const canEditUseBy = role === "admin" || role === "manager";
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [printed, setPrinted] = useState(false);
  const q = useQuery<FivePackLabels>({
    queryKey: ["five-pack-labels", tag],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/dessert-labels?tag=${encodeURIComponent(tag)}`, { credentials: "include" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      return body as FivePackLabels;
    },
    staleTime: 60_000,
  });
  const d = q.data;
  const missing = (d?.lines ?? []).filter(l => !l.barcode).length;

  const print = async () => {
    setError(null);
    // Open the tab on the tap itself: iPad Safari blocks one opened after an await.
    const tab = window.open("", "_blank");
    setBusy(true);
    try {
      const res = await fetch(`${BASE}/api/dessert-labels/print`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tag }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      if (tab) tab.location.href = url;
      else { const a = document.createElement("a"); a.href = url; a.download = `5-pack-labels-${tag}.pdf`; a.click(); }
      setPrinted(true);
    } catch (e) {
      tab?.close();
      setError(e instanceof Error ? e.message : "Couldn't make the labels");
    } finally {
      setBusy(false);
    }
  };

  if (q.isError) return <p className="text-sm text-destructive font-semibold mt-2">Couldn't load the 5-pack labels — {(q.error as Error).message}</p>;
  if (!d || d.total === 0) return null;
  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={print} disabled={busy}
          className="h-12 px-5 rounded-xl bg-primary text-primary-foreground font-bold inline-flex items-center gap-2 hover:bg-primary/90 active:scale-[0.98] disabled:opacity-60">
          {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : printed ? <Check className="w-5 h-5" /> : <Printer className="w-5 h-5" />}
          {printed ? "Print again" : `Print all ${d.total} 5-pack labels`}
        </button>
        <button type="button" onClick={() => setOpen(o => !o)}
          className="h-12 px-3 rounded-xl text-sm font-semibold text-muted-foreground hover:bg-secondary inline-flex items-center gap-1">
          See the labels <ChevronDown className={cn("w-4 h-4 transition-transform", open && "rotate-180")} />
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        Use by {d.useBy} ({d.useByDays} days from today). Print at Actual size on the 102 × 25 mm label printer.
        {missing > 0 && <span className="text-amber-700 dark:text-amber-300 font-semibold"> {missing} flavour{missing === 1 ? " has" : "s have"} no barcode — {missing === 1 ? "it prints" : "they print"} without one.</span>}
      </p>
      {error && <p className="text-sm text-destructive font-semibold">{error}</p>}
      {open && (
        <div className="space-y-3 pt-1">
          {d.lines.map(l => (
            <div key={l.variantId ?? l.productTitle} className="space-y-1">
              <p className="text-sm font-semibold">{l.productTitle} × {l.quantity}{l.barcode ? "" : " — no barcode"}</p>
              <img src={l.png} alt={`5-pack label: ${l.productTitle}`} className="w-full max-w-xl rounded-lg ring-1 ring-border bg-white" />
            </div>
          ))}
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
