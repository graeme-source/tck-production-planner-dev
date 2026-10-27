/**
 * Pot labels at the end of making a sub-recipe we sell as it is (Graeme,
 * 2026-10-27: "we make the labels, and then we can print them directly from
 * the iPad for the amount that we've made"). Shown on the make flow's done
 * screen only for sub-recipes with a label set up (TCK Garlic Mayo first).
 * The count starts at what the batch should fill — made weight ÷ pot size —
 * and can be changed before printing. API: /api/sub-recipe-labels.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Check, ChevronRight, Loader2, Minus, Plus, Printer } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/** The pots print the linked product recipe's PUBLISHED label (one design,
 *  set on its label page) — or, when there isn't one to print, why not. */
type PotLabel = {
  subRecipeId: number;
  recipeId: number | null;
  recipeName: string | null;
  potSizeG: number | null;
  maxCount: number;
} & (
  | { ready: true; name: string; useBy: string; useByPeriod: string | null; batch: string; barcode: string | null; versionNo: number; png: string }
  | { ready: false; message: string }
);

/** Which sub-recipes have a pot label — the done screen asks before showing anything. */
export function useSubRecipesWithLabels() {
  return useQuery<Set<number>>({
    queryKey: ["sub-recipe-labels"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/sub-recipe-labels`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return new Set(((await res.json()) as { subRecipeIds: number[] }).subRecipeIds);
    },
  });
}

/** Pure: how many pots a made weight fills (whole pots only). */
export function potsFromWeight(madeGrams: number, potSizeG: number | null): number | null {
  if (!potSizeG || potSizeG <= 0 || !(madeGrams > 0)) return null;
  return Math.floor(madeGrams / potSizeG);
}

export function SubRecipePotLabels({ subRecipeId, madeGrams }: { subRecipeId: number; madeGrams: number }) {
  const q = useQuery<PotLabel>({
    queryKey: ["sub-recipe-label", subRecipeId],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/sub-recipe-labels/${subRecipeId}`, { credentials: "include" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      return body as PotLabel;
    },
  });
  const suggested = q.data ? potsFromWeight(madeGrams, q.data.potSizeG) : null;
  const [countText, setCountText] = useState<string | null>(null);
  const text = countText ?? (suggested != null ? String(suggested) : "");
  const count = Number(text);
  const valid = Number.isInteger(count) && count >= 1 && count <= (q.data?.maxCount ?? 500);
  const [busy, setBusy] = useState(false);
  const [printed, setPrinted] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const print = async () => {
    setError(null);
    // Open the tab on the tap: iPad Safari blocks a tab opened after an await.
    const tab = window.open("", "_blank");
    setBusy(true);
    try {
      const res = await fetch(`${BASE}/api/sub-recipe-labels/${subRecipeId}/print`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ count }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      if (tab) tab.location.href = url;
      else { const a = document.createElement("a"); a.href = url; a.download = `pot-labels-x${count}.pdf`; a.click(); }
      setPrinted(count);
    } catch (e) {
      tab?.close();
      setError(e instanceof Error ? e.message : "Couldn't make the labels");
    } finally {
      setBusy(false);
    }
  };

  if (q.isLoading) return <p className="text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Drawing the pot label…</p>;
  if (q.isError || !q.data) return <p className="text-destructive font-semibold">Couldn't load the pot label — {(q.error as Error | null)?.message}</p>;
  const d = q.data;
  if (!d.ready) {
    // Nothing printed on a guess: say what to do, and link to where it's done.
    return (
      <div className="w-full max-w-xl rounded-2xl border-2 border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-4 space-y-2 text-left">
        <p className="text-lg font-bold">Pot labels</p>
        <p className="font-semibold">{d.message}</p>
        {d.recipeId != null && (
          <Link href={`/labels/${d.recipeId}`} className="inline-flex items-center gap-1 h-11 px-4 rounded-xl border-2 border-border bg-card font-semibold hover:bg-secondary">
            Open the {d.recipeName ?? "product"} label <ChevronRight className="w-4 h-4" />
          </Link>
        )}
      </div>
    );
  }
  const step = (by: number) => setCountText(String(Math.min(d.maxCount, Math.max(1, (valid ? count : 0) + by))));
  return (
    <div className="w-full max-w-xl rounded-2xl border-2 border-border bg-card p-4 space-y-3 text-left">
      <p className="text-lg font-bold">Pot labels</p>
      <img src={d.png} alt={`Pot label: ${d.name}`} className="w-full rounded-lg ring-1 ring-border bg-white" />
      <p className="text-sm text-muted-foreground">
        Use by {d.useBy}{d.useByPeriod ? ` (${d.useByPeriod})` : ""} · batch {d.batch} ·{" "}
        <Link href={`/labels/${d.recipeId}`} className="font-semibold text-primary underline">{d.recipeName} label, version {d.versionNo}</Link>
        {!d.barcode && <span className="text-amber-700 dark:text-amber-300 font-semibold"> · no barcode</span>}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => step(-1)} aria-label="One fewer" className="h-12 w-12 rounded-xl border-2 border-border inline-flex items-center justify-center hover:bg-secondary"><Minus className="w-5 h-5" /></button>
        <input inputMode="numeric" value={text} onChange={e => setCountText(e.target.value.replace(/\D/g, ""))} aria-label="How many labels"
          className={`w-24 h-12 px-3 rounded-xl border-2 bg-background text-center text-xl font-bold tabular-nums ${valid ? "border-border" : "border-destructive"}`} />
        <button type="button" onClick={() => step(1)} aria-label="One more" className="h-12 w-12 rounded-xl border-2 border-border inline-flex items-center justify-center hover:bg-secondary"><Plus className="w-5 h-5" /></button>
        <button type="button" onClick={print} disabled={!valid || busy}
          className="h-12 px-5 rounded-xl bg-primary text-primary-foreground font-bold inline-flex items-center gap-2 hover:bg-primary/90 disabled:opacity-50">
          {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Printer className="w-5 h-5" />} Print {valid ? count : ""} labels
        </button>
      </div>
      {suggested != null && <p className="text-xs text-muted-foreground">{suggested} is what this batch should fill ({d.potSizeG} g pots) — change it to what you actually potted.</p>}
      {printed != null && <p className="text-sm text-emerald-700 dark:text-emerald-400 font-semibold inline-flex items-center gap-1"><Check className="w-4 h-4" /> {printed} labels sent — print at Actual size on the 102 × 25 mm label printer.</p>}
      {error && <p className="text-sm text-destructive font-semibold">{error}</p>}
    </div>
  );
}
