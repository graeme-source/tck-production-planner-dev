/**
 * The change log, minimised to the very bottom of Sales & Marketing (Graeme,
 * 2026-10-21): "minimise it and completely collapse it right at the bottom
 * of the page, so we can open it if we need it … Simplify it and remove a
 * lot of the explanations and text. Keep all the change log entries."
 * Objective I.
 *
 * Closed every visit: one "Change log" button. Open: every recorded change
 * (website, offers, emails, ads … the last year the server keeps), grouped
 * by day, one line each — tap a line for its detail. "Add a change" sits
 * behind its own button. The dashed markers on the What's driving sales
 * chart still show the changes in their period.
 */
import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, History, Loader2, Plus, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { changeLine, changeTime, groupChangesByDay, impactTag } from "@/lib/change-log";
import { CHANGE_CATEGORIES, useAddChange, useDeleteChange, useSalesDrivers, type Change, type ChangeCategory } from "./api";

/** The server's longest window — "keep all the entries". */
const ALL_DAYS = 365;
/** Days of entries shown at first; "Show more" adds the same again. */
const PAGE_DAYS = 14;

const catLabel = (c: string) => CHANGE_CATEGORIES.find(x => x.value === c)?.label ?? c;
const CAT_COLOUR: Record<string, string> = {
  offer: "#d97706", price: "#dc2626", delivery: "#2563eb", theme: "#7c3aed", email: "#db2777",
  ads: "#059669", ab_test: "#0891b2", external: "#64748b", other: "#64748b",
};

function londonToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
}

export function ChangeLog({ canEdit }: { canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="space-y-3">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="w-full sm:w-auto min-h-12 px-4 rounded-xl border-2 border-border bg-card text-base font-semibold flex items-center gap-2 hover:bg-secondary/50">
        <History className="w-5 h-5 text-muted-foreground" />
        Change log
        {open ? <ChevronUp className="w-5 h-5 ml-auto sm:ml-2" /> : <ChevronDown className="w-5 h-5 ml-auto sm:ml-2" />}
      </button>
      {open && <ChangeLogBody canEdit={canEdit} onClose={() => setOpen(false)} />}
    </section>
  );
}

function ChangeLogBody({ canEdit, onClose }: { canEdit: boolean; onClose: () => void }) {
  const q = useSalesDrivers(ALL_DAYS);
  const del = useDeleteChange();
  const [adding, setAdding] = useState(false);
  const [shownDays, setShownDays] = useState(PAGE_DAYS);
  const days = useMemo(() => groupChangesByDay(q.data?.changes ?? [], londonToday()), [q.data]);
  const visible = days.slice(0, shownDays);
  const hiddenCount = days.slice(shownDays).reduce((n, d) => n + d.entries.length, 0);

  return (
    <div className="rounded-2xl border border-border bg-card p-4 sm:p-5 space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        {canEdit && !adding && (
          <button type="button" onClick={() => setAdding(true)}
            className="min-h-10 px-3 rounded-xl border-2 border-border text-sm font-semibold flex items-center gap-1.5 hover:bg-secondary/50">
            <Plus className="w-4 h-4" /> Add a change
          </button>
        )}
        <button type="button" onClick={onClose} className="ml-auto p-2 rounded-lg hover:bg-secondary" aria-label="Close change log">
          <X className="w-5 h-5" />
        </button>
      </div>

      {adding && <AddChange onDone={() => setAdding(false)} />}
      {del.error && <p className="text-sm text-destructive">Couldn't remove — {(del.error as Error).message}</p>}

      {q.isLoading ? (
        <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</p>
      ) : q.error ? (
        <p className="text-sm text-destructive">Couldn't load — {(q.error as Error).message}</p>
      ) : days.length === 0 ? (
        <p className="text-sm text-muted-foreground">No changes yet.</p>
      ) : (
        <div className="space-y-4">
          {visible.map(d => (
            <div key={d.day}>
              <h3 className="text-sm font-bold pb-1 border-b border-border">{d.heading}</h3>
              <ul className="divide-y divide-border/60">
                {d.entries.map(c => (
                  <ChangeRow key={c.id} change={c} canDelete={canEdit && c.source === "manual"}
                    onDelete={() => del.mutate(c.id)} deleting={del.isPending && del.variables === c.id} />
                ))}
              </ul>
            </div>
          ))}
          {hiddenCount > 0 && (
            <button type="button" onClick={() => setShownDays(n => n + PAGE_DAYS)}
              className="w-full h-11 rounded-xl border-2 border-dashed border-border text-sm font-semibold text-muted-foreground flex items-center justify-center gap-1.5 hover:bg-secondary/40">
              <ChevronDown className="w-4 h-4" /> Show more ({hiddenCount} older)
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ChangeRow({ change: c, canDelete, onDelete, deleting }: { change: Change; canDelete: boolean; onDelete: () => void; deleting: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const tag = impactTag(c.impact);
  return (
    <li className="py-2 flex gap-3 items-start">
      <button type="button" onClick={() => setExpanded(e => !e)} disabled={!c.detail} aria-expanded={c.detail ? expanded : undefined}
        className="flex-1 min-w-0 text-left flex gap-2.5 items-start disabled:cursor-default">
        <span className="mt-1.5 w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: CAT_COLOUR[c.category] ?? "#64748b" }} />
        <span className="min-w-0 space-y-0.5">
          <span className="block text-sm break-words">
            <span className="tabular-nums text-muted-foreground">{changeTime(c.effectiveAt)}</span>
            {" · "}{changeLine(c, catLabel)}
            {c.detail && !expanded && <span className="text-muted-foreground"> …</span>}
          </span>
          {tag && <span className={cn("block text-xs", tag.worse ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>{tag.text}</span>}
          {expanded && c.detail && <span className="block text-sm text-muted-foreground whitespace-pre-wrap break-words">{c.detail}</span>}
        </span>
      </button>
      {canDelete && (confirming ? (
        <span className="flex items-center gap-1 text-xs">
          <button type="button" onClick={onDelete} disabled={deleting} className="rounded-md bg-destructive text-destructive-foreground px-2.5 py-1.5">
            {deleting ? "Removing…" : "Remove"}
          </button>
          <button type="button" onClick={() => setConfirming(false)} className="rounded-md border border-border px-2.5 py-1.5">Keep</button>
        </span>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} aria-label="Remove change" className="p-1.5 text-muted-foreground hover:text-destructive">
          <Trash2 className="w-4 h-4" />
        </button>
      ))}
    </li>
  );
}

function nowLocalInput(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

/** Record something the system can't see (an ad change, a heatwave). Saved with Add. */
function AddChange({ onDone }: { onDone: () => void }) {
  const add = useAddChange();
  const [when, setWhen] = useState(nowLocalInput);
  const [category, setCategory] = useState<ChangeCategory>("offer");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    add.mutate(
      { effectiveAt: new Date(when).toISOString(), category, title: title.trim(), detail: detail.trim() || null },
      { onSuccess: onDone },
    );
  };

  return (
    <form onSubmit={submit} className="rounded-xl border border-border bg-muted/30 p-3 grid grid-cols-1 md:grid-cols-[11rem_9rem_minmax(0,1fr)] gap-2 items-start">
      <input type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} aria-label="When"
        className="rounded-lg border border-border bg-background px-2 py-2 text-sm" />
      <select value={category} onChange={e => setCategory(e.target.value as ChangeCategory)} aria-label="Kind"
        className="rounded-lg border border-border bg-background px-2 py-2 text-sm">
        {CHANGE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
      </select>
      <div className="space-y-2">
        <input value={title} onChange={e => setTitle(e.target.value)} maxLength={300} autoFocus
          placeholder="What changed" className="w-full rounded-lg border border-border bg-background px-2 py-2 text-sm" aria-label="What changed" />
        <input value={detail} onChange={e => setDetail(e.target.value)} maxLength={2000} placeholder="Detail (optional)"
          className="w-full rounded-lg border border-border bg-background px-2 py-2 text-sm" aria-label="Detail" />
        <div className="flex items-center gap-2 flex-wrap">
          <button type="submit" disabled={add.isPending || !title.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-3 py-2 text-sm font-semibold disabled:opacity-50">
            {add.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} {add.isPending ? "Saving…" : "Add"}
          </button>
          <button type="button" onClick={onDone} className="rounded-lg border border-border px-3 py-2 text-sm">Cancel</button>
          {add.error && <span className="text-sm text-destructive" aria-live="polite">Not saved — {(add.error as Error).message}</span>}
        </div>
      </div>
    </form>
  );
}
