/**
 * Label history — the History tab on /labels/:id (?tab=history). Every
 * published version of the recipe's label, newest first: who published it
 * and when, what changed against the version before, how many labels were
 * printed from it, its picture (tap for full size) and an archive PDF
 * stamped NOT FOR PRINTING. Read-only, for everyone. Objective D.
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown, ChevronUp, Download, History, Info, Loader2, Printer, X } from "lucide-react";
import type { HistoryEntry } from "@workspace/product-labels";
import { cn } from "@/lib/utils";
import { API, api, fmtDateTime } from "./api";
import { ChangeRow } from "./publish-dialog";

type VersionRow = HistoryEntry & { publishedDay: string };
interface HistoryPayload { recipeId: number; recipeName: string; versions: VersionRow[] }

export function useLabelHistory(recipeId: number) {
  return useQuery({
    queryKey: ["product-labels", "history", recipeId],
    queryFn: () => api<HistoryPayload>(`/recipes/${recipeId}/versions`),
  });
}

const proofUrl = (recipeId: number, versionNo: number) => `${API}/recipes/${recipeId}/versions/${versionNo}/proof`;
const pdfUrl = (recipeId: number, versionNo: number) => `${API}/recipes/${recipeId}/versions/${versionNo}/pdf`;

export function LabelHistoryPanel({ recipeId }: { recipeId: number }) {
  const { data, isLoading, error } = useLabelHistory(recipeId);
  const [open, setOpen] = useState<VersionRow | null>(null);

  if (isLoading) return <div className="flex items-center gap-2 text-muted-foreground py-10"><Loader2 className="w-5 h-5 animate-spin" /> Loading the label history…</div>;
  if (error || !data) return <p className="text-destructive">Couldn't load the label history — {(error as Error | null)?.message ?? "not found"}</p>;

  if (data.versions.length === 0) {
    return (
      <section className="rounded-2xl border-2 border-dashed border-border bg-card p-8 text-center space-y-2 max-w-3xl">
        <History className="w-10 h-10 mx-auto text-muted-foreground" />
        <p className="text-xl font-bold">Never published</p>
        <p className="text-muted-foreground">This label has no history yet. The first time someone presses "Update live version", it will appear here — and every publish after it.</p>
      </section>
    );
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <Info className="w-4 h-4 mt-0.5 shrink-0" />
        Every time the label is published it is kept here exactly as it was. Each picture is dated the day that version was published, so it shows what the label looked like then.
        The PDFs are stamped "NOT FOR PRINTING" — they are a record, not labels to stick on packs.
      </p>
      {data.versions.map(v => (
        <VersionCard key={v.id} recipeId={recipeId} v={v} onOpen={() => setOpen(v)} />
      ))}
      {data.versions.length === 1 && (
        <p className="rounded-2xl border-2 border-dashed border-border p-5 text-center text-muted-foreground">
          Only one version so far — every future publish will appear here.
        </p>
      )}
      {open && <ProofModal recipeId={recipeId} recipeName={data.recipeName} v={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

const londonDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });

function printLine(v: VersionRow): string {
  const p = v.prints;
  if (p.runs === 0) return v.live ? "No labels printed from this version yet." : "No labels printed from this version.";
  let span = "";
  if (p.firstPrintedAt && p.lastPrintedAt) {
    const a = londonDay(p.firstPrintedAt), b = londonDay(p.lastPrintedAt);
    span = a === b ? ` on ${a}` : `, ${a} – ${b}`;
  }
  return `Printed ${p.labels} label${p.labels === 1 ? "" : "s"} in ${p.runs} run${p.runs === 1 ? "" : "s"}${span}.`;
}

function VersionCard({ recipeId, v, onOpen }: { recipeId: number; v: VersionRow; onOpen: () => void }) {
  const [details, setDetails] = useState(false);
  return (
    <section className={cn("rounded-2xl border-2 bg-card p-5", v.live ? "border-emerald-400 dark:border-emerald-700" : "border-border")}>
      <div className="flex flex-col md:flex-row gap-5">
        <button
          type="button"
          onClick={onOpen}
          className="md:w-72 shrink-0 rounded-xl border-2 border-border bg-white p-1 hover:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label={`Open version ${v.versionNo} full size`}
        >
          <img src={proofUrl(recipeId, v.versionNo)} alt={`Label version ${v.versionNo}`} loading="lazy" className="w-full h-auto" />
        </button>

        <div className="flex-1 min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-2xl font-bold">Version {v.versionNo}</h2>
            {v.live && (
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800 text-sm font-bold">
                <CheckCircle2 className="w-4 h-4" /> LIVE
              </span>
            )}
          </div>
          <p className="text-base">Published {fmtDateTime(v.publishedAt)}{v.publishedByName ? ` by ${v.publishedByName}` : ""}.</p>

          {v.first ? (
            <p className="text-muted-foreground">First published version.</p>
          ) : v.changes.length === 0 ? (
            <p className="text-muted-foreground">No label changes recorded against version {v.versionNo - 1}.</p>
          ) : (
            <div className="space-y-2">
              <p className="font-semibold">What changed from version {v.versionNo - 1}:</p>
              <ul className="list-disc pl-6 space-y-0.5">{v.changes.map(c => <li key={c.key}>{c.label}</li>)}</ul>
              <button type="button" onClick={() => setDetails(d => !d)} className="inline-flex items-center gap-1 h-10 px-3 rounded-lg border border-border text-sm font-semibold hover:bg-secondary">
                {details ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />} {details ? "Hide" : "Show"} before and after
              </button>
              {details && <div className="space-y-2">{v.changes.map(c => <ChangeRow key={c.key} change={c} />)}</div>}
            </div>
          )}

          <p className="flex items-center gap-2 text-sm"><Printer className="w-4 h-4 shrink-0 text-muted-foreground" /> {printLine(v)}{v.prints.testRuns > 0 ? ` (${v.prints.testRuns} test print${v.prints.testRuns === 1 ? "" : "s"} too.)` : ""}</p>

          <a
            href={pdfUrl(recipeId, v.versionNo)}
            download
            className="inline-flex items-center gap-2 h-12 px-5 rounded-xl border-2 border-border bg-card font-bold hover:bg-secondary"
          >
            <Download className="w-5 h-5" /> Download PDF
          </a>
        </div>
      </div>
    </section>
  );
}

function ProofModal({ recipeId, recipeName, v, onClose }: { recipeId: number; recipeName: string; v: VersionRow; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[120] bg-black/70 flex items-center justify-center p-3 md:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${recipeName} label version ${v.versionNo}`}
        className="bg-card border-2 border-border rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92dvh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-3 border-b border-border">
          <div className="flex-1 min-w-0">
            <p className="text-xl font-bold truncate">{recipeName} — version {v.versionNo}{v.live ? " (live)" : ""}</p>
            <p className="text-sm text-muted-foreground">Published {fmtDateTime(v.publishedAt)}{v.publishedByName ? ` by ${v.publishedByName}` : ""}. Dates on the picture are that day.</p>
          </div>
          <button onClick={onClose} className="p-3 rounded-xl hover:bg-secondary" aria-label="Close"><X className="w-6 h-6" /></button>
        </div>
        <div className="flex-1 overflow-auto p-4 bg-secondary/40">
          <img src={proofUrl(recipeId, v.versionNo)} alt={`Label version ${v.versionNo}`} className="w-full h-auto bg-white rounded-lg border border-border" />
        </div>
        <div className="flex flex-wrap justify-end gap-3 px-5 py-3 border-t border-border">
          <a href={pdfUrl(recipeId, v.versionNo)} download className="inline-flex items-center gap-2 h-12 px-5 rounded-xl border-2 border-border bg-card font-bold hover:bg-secondary">
            <Download className="w-5 h-5" /> Download PDF
          </a>
          <button onClick={onClose} className="h-12 px-5 rounded-xl bg-primary text-primary-foreground font-bold">Close</button>
        </div>
      </div>
    </div>
  );
}
