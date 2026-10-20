/**
 * "Re-use a past phase" (2026-10-20): search previous phases by name or
 * offer, pick one, choose the new start date — the copy keeps the name,
 * offers, customer group, notes and the same length (reusePhase() in
 * @workspace/marketing-calendar). It then opens for editing like any phase.
 *
 * Modal rule: explicit X, card capped at 92dvh with internal scrolling.
 */
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, CalendarPlus, Copy, Loader2, Search, Tag, Users, X } from "lucide-react";
import { customerGroupChip, daysBetween, formatRange, reusePhase, searchPhases } from "@workspace/marketing-calendar";
import { cn } from "@/lib/utils";
import { useAllPhases, useCreatePhase, type Phase } from "./api";

export function ReusePhase({ defaultStart, onClose, onCreated }: {
  defaultStart: string;
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const all = useAllPhases(true);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Phase | null>(null);
  const [start, setStart] = useState(defaultStart);
  const create = useCreatePhase();
  const results = useMemo(() => searchPhases(all.data?.phases ?? [], query), [all.data, query]);
  const copy = picked && /^\d{4}-\d{2}-\d{2}$/.test(start) ? reusePhase(picked, start) : null;

  const go = () => {
    if (!picked || !copy) return;
    create.mutate(
      { ...copy, source: "reuse", copiedFromId: picked.id },
      { onSuccess: r => onCreated(r.event.id) },
    );
  };

  return createPortal(
    <div className="fixed inset-0 z-[130] bg-black/60 flex items-center justify-center p-2 sm:p-6" onClick={onClose}>
      <div
        className="bg-card border-2 border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92dvh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Re-use a past phase"
      >
        <div className="flex items-center gap-3 px-4 sm:px-5 py-3 border-b border-border">
          {picked
            ? <button onClick={() => setPicked(null)} className="p-2 rounded-lg hover:bg-secondary" aria-label="Back to the list"><ArrowLeft className="w-5 h-5" /></button>
            : <Copy className="w-5 h-5 text-violet-600 flex-shrink-0" />}
          <h2 className="flex-1 font-display font-bold text-lg leading-tight">{picked ? "When should it start?" : "Re-use a past phase"}</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-secondary" aria-label="Close"><X className="w-6 h-6" /></button>
        </div>

        {!picked ? (
          <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3">
            <label className="relative block">
              <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                autoFocus
                placeholder="Search by name or offer, e.g. Halloween or free pack"
                className="w-full pl-10 pr-4 py-3 rounded-xl border-2 border-border bg-background text-base focus:outline-none focus:border-primary"
                aria-label="Search past phases"
              />
            </label>
            {all.isLoading && <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</p>}
            {all.isError && <p className="text-sm text-destructive">{(all.error as Error).message}</p>}
            {all.data && results.length === 0 && <p className="text-sm text-muted-foreground">No phases match “{query}”.</p>}
            <ul className="space-y-2">
              {results.map(p => <PhaseChoice key={p.id} phase={p} onPick={() => setPicked(p)} />)}
            </ul>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
            <PhaseChoice phase={picked} />
            <label className="block space-y-1.5">
              <span className="block text-sm font-semibold">New start date</span>
              <input type="date" value={start} onChange={e => setStart(e.target.value)}
                className="w-full sm:w-64 px-3 py-2.5 rounded-xl border-2 border-border bg-background text-base" />
            </label>
            {copy && (
              <p className="text-base">
                The copy runs <b>{formatRange(copy.startDate, copy.endDate)}</b> ({daysBetween(copy.startDate, copy.endDate) + 1} day{copy.startDate === copy.endDate ? "" : "s"}, same as before) with the same offers, customers and notes. You can change anything after.
              </p>
            )}
            {create.isError && <p className="text-sm text-destructive">{(create.error as Error).message}</p>}
            <button type="button" onClick={go} disabled={!copy || create.isPending}
              className="w-full sm:w-auto px-5 h-12 rounded-xl bg-primary text-primary-foreground font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
              {create.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarPlus className="w-5 h-5" />} Add it to the calendar
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function PhaseChoice({ phase: p, onPick }: { phase: Phase; onPick?: () => void }) {
  const group = customerGroupChip(p.customerGroup);
  const Inner = (
    <>
      <span className="w-2 self-stretch rounded-full bg-violet-600 flex-shrink-0" />
      <span className="flex-1 min-w-0 space-y-1">
        <span className="block text-base font-bold break-words">{p.title}</span>
        <span className="block text-sm text-muted-foreground">{formatRange(p.startDate, p.endDate)}</span>
        {(p.offers.length > 0 || group) && (
          <span className="flex flex-wrap gap-1.5">
            {p.offers.map(o => (
              <span key={o} className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 text-violet-800 dark:text-violet-200 px-2 py-0.5 text-sm font-semibold break-words">
                <Tag className="w-3.5 h-3.5 flex-shrink-0" />{o}
              </span>
            ))}
            {group && <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-sm font-semibold"><Users className="w-3.5 h-3.5" />{group}</span>}
          </span>
        )}
      </span>
    </>
  );
  if (!onPick) return <div className="rounded-2xl border-2 border-violet-500/30 p-3 flex gap-3">{Inner}</div>;
  return (
    <li>
      <button type="button" onClick={onPick} className={cn("w-full text-left rounded-2xl border-2 border-border p-3 flex gap-3 hover:bg-secondary/40")}>
        {Inner}
      </button>
    </li>
  );
}
