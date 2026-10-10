/**
 * "Update live version" — the double check before a label goes live.
 *   1. Automatic: the server's fit check and content checks must pass
 *      (re-done on the server when you confirm).
 *   2. Human: full-size proofs of the live and new label side by side, the
 *      differences outlined and listed, then "I've checked it — update live".
 * Closable (X / Cancel / tap outside), capped at 92dvh with internal scroll.
 */
import { useState } from "react";
import { CheckCircle2, Loader2, ShieldCheck, X, XCircle } from "lucide-react";
import { areasForChange, FIELD_LABEL, wordDiff, type SnapshotChange } from "@workspace/product-labels";
import { cn } from "@/lib/utils";
import { api, fmtDateTime, useInvalidateLabels, type RecipeLabel } from "./api";
import { ProofImage, type Area } from "./proof-image";

export function PublishDialog({ data, onClose }: { data: RecipeLabel; onClose: () => void }) {
  const invalidate = useInvalidateLabels();
  const [ticked, setTicked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<string[]>([]);

  const cur = data.current.proof;
  const highlight: Area[] = [...new Set(data.changes.flatMap(c => areasForChange(c.key)))];
  const allBlockers = blockers.length ? blockers : data.blockers;
  const fits = cur.fits;
  const smallest = cur.fields.reduce((m, f) => (f.sizePt < m.sizePt ? f : m), cur.fields[0]);
  const canPublish = fits && allBlockers.length === 0 && ticked && !busy;

  const publish = async () => {
    setBusy(true); setError(null);
    try {
      await api(`/recipes/${data.recipe.id}/publish`, { method: "POST", body: JSON.stringify({ expectedHash: data.current.hash, confirmed: true }) });
      await invalidate();
      onClose();
    } catch (e) {
      const err = e as Error & { status?: number; body?: { blockers?: string[] } };
      setError(err.message);
      if (err.body?.blockers) setBlockers(err.body.blockers);
      if (err.status === 409) { setTicked(false); await invalidate(); }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] bg-black/70 flex items-center justify-center p-2 md:p-6" onClick={onClose}>
      <div
        className="bg-card border-2 border-border rounded-2xl shadow-2xl w-full max-w-[1400px] max-h-[92dvh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Update the live label"
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <ShieldCheck className="w-7 h-7 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-xl leading-tight truncate">Update the live label — {data.recipe.name}</h2>
            <p className="text-sm text-muted-foreground">Check the new label against the live one. Dates and batch use today as a sample.</p>
          </div>
          <button onClick={onClose} className="p-3 rounded-xl hover:bg-secondary" aria-label="Close"><X className="w-6 h-6" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 md:p-5 space-y-5">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <h3 className="font-bold text-lg">{data.live ? `Live now — v${data.live.versionNo}` : "Live now — nothing yet"}</h3>
              {data.live?.proof ? (
                <ProofImage proof={data.live.proof} highlight={highlight} showOverflow={false}
                  caption={`Published ${fmtDateTime(data.live.publishedAt)}${data.live.publishedByName ? ` by ${data.live.publishedByName}` : ""}`} />
              ) : <div className="rounded-lg border-2 border-dashed border-border p-10 text-center text-muted-foreground">Never published</div>}
            </div>
            <div className="space-y-2">
              <h3 className="font-bold text-lg text-primary">New version{data.live ? ` — v${data.live.versionNo + 1}` : " — v1"}</h3>
              <ProofImage proof={cur} highlight={highlight} caption="What the wrapping station will print once you update" />
            </div>
          </div>

          {/* Check 1: automatic */}
          <section className={cn("rounded-2xl border-2 p-4 space-y-2", fits && allBlockers.length === 0 ? "border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20" : "border-rose-300 bg-rose-50 dark:bg-rose-950/20")}>
            <h3 className="font-bold text-lg flex items-center gap-2">
              {fits && allBlockers.length === 0 ? <CheckCircle2 className="w-6 h-6 text-emerald-600" /> : <XCircle className="w-6 h-6 text-rose-600" />}
              Automatic check
            </h3>
            {fits ? (
              <p>Everything fits. Smallest text: {FIELD_LABEL[smallest.key]} at {smallest.sizePt} pt, x-height {smallest.xHeightMm} mm (the law's minimum works out at {smallest.legalMinPt} pt in this font). No field is below its minimum.</p>
            ) : <p className="font-semibold text-rose-700 dark:text-rose-400">DOESN'T FIT — it can't go live like this.</p>}
            {allBlockers.length > 0 && (
              <ul className="list-disc pl-6 space-y-1 text-rose-800 dark:text-rose-300">
                {allBlockers.map(b => <li key={b}>{b}</li>)}
              </ul>
            )}
          </section>

          {/* What changed */}
          <section className="space-y-2">
            <h3 className="font-bold text-lg">{data.live ? `What's different (${data.changes.length})` : "First version — everything is new"}</h3>
            {data.changes.length > 0 && (
              <div className="space-y-2">
                {data.changes.map(c => <ChangeRow key={c.key} change={c} />)}
              </div>
            )}
          </section>
        </div>

        <div className="border-t border-border p-4 space-y-3 bg-card">
          {error && <p className="text-destructive font-semibold">{error}</p>}
          <label className={cn("flex items-start gap-3 text-base", !(fits && allBlockers.length === 0) && "opacity-50")}>
            <input type="checkbox" className="w-6 h-6 mt-0.5" checked={ticked} disabled={!(fits && allBlockers.length === 0)} onChange={e => setTicked(e.target.checked)} />
            <span>I've read the new label — name, cooking steps, ingredients and allergens, dates and barcode — and it's right.</span>
          </label>
          <div className="flex flex-wrap gap-3 justify-end">
            <button onClick={onClose} className="h-12 px-5 rounded-xl border-2 border-border font-semibold hover:bg-secondary">Cancel</button>
            <button
              onClick={publish}
              disabled={!canPublish}
              className="h-12 px-6 rounded-xl bg-primary text-primary-foreground font-bold disabled:opacity-40 inline-flex items-center gap-2"
            >
              {busy && <Loader2 className="w-5 h-5 animate-spin" />} I've checked it — update live
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ChangeRow({ change }: { change: SnapshotChange }) {
  const isText = change.key === "deckText" || change.key.startsWith("template.text.") || change.key === "mayContain";
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50/60 dark:bg-amber-950/20 px-4 py-3 space-y-1">
      <p className="font-semibold">{change.label}</p>
      {isText ? (
        <p className="text-sm leading-relaxed">
          {wordDiff(change.before.replace(/\*\*/g, ""), change.after.replace(/\*\*/g, "")).map((p, i) => (
            <span
              key={i}
              className={cn(
                p.kind === "added" && "bg-emerald-200 dark:bg-emerald-800/60 font-semibold",
                p.kind === "removed" && "bg-rose-200 dark:bg-rose-800/60 line-through",
              )}
            >{p.text}</span>
          ))}
        </p>
      ) : (
        <p className="text-sm"><span className="line-through text-muted-foreground">{change.before}</span> → <span className="font-semibold">{change.after}</span></p>
      )}
    </div>
  );
}
