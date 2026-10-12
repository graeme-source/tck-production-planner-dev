/**
 * "Reviews & records" — everything on someone's employment record as ONE
 * list of entries (Graeme, 2026-10-12), opened from the record's right-hand
 * section buttons. Add to record → one form; the classification decides the
 * few extra fields. Newest first, chips to filter by classification.
 *
 * Self-contained: give it the person and `ready` (from usePeopleReady) and it
 * fetches its own data. Server: routes/people-reviews.ts — private People
 * PIN, founder or People access, never your own record, all audited.
 * `?entry=12` in the URL (a to-do's link) opens that entry.
 */
import { useEffect, useMemo, useState } from "react";
import { useSearch } from "wouter";
import { CalendarDays, ChevronRight, FileText, Loader2, Lock, Plus, Settings2 } from "lucide-react";
import {
  reviewBadge, longestLiveWarning, entryWarning, entryHeadline, entryLevel, warningStatusLabel, classificationCounts,
  filterEntries, fmtDayIso, recordTimelineEvents, MEETING_TYPE_LABEL, type RecordEvent,
} from "@workspace/people-reviews";
import { cn } from "@/lib/utils";
import { PeopleModal } from "@/components/people-modal";
import { PeopleLockedError } from "@/hooks/use-people-gate";
import { PeopleLockedCard } from "@/components/people-locked-card";
import { ReviewStatusBadge } from "./review-status-badge";
import { EntryEditor, NewEntryForm } from "./entry-form";
import { RecordSettings } from "./record-settings";
import { ProbationCard } from "./probation-card";
import { usePersonEntries, useRefreshEntries, type PersonRecordEntries, type RecordEntry } from "./reviews-api";

/** The badge, the section-button summary facts and the timeline events for
 *  one person — what the record page needs from here. */
export function recordFacts(data: PersonRecordEntries | undefined) {
  if (!data) return null;
  const badge = reviewBadge(data.entries, data.classifications, data.stages);
  const warnings = data.entries.map(e => entryWarning(e, data.classifications, data.stages)).filter((w): w is NonNullable<typeof w> => !!w);
  const live = longestLiveWarning(warnings, data.today);
  const reclassifications = (e: RecordEntry) => e.history
    .filter(h => h.action === "reclassify" && h.detail)
    .map(h => ({ at: h.at, message: h.detail! }));
  const events = recordTimelineEvents(
    data.entries.map(e => ({ ...e, reclassifications: reclassifications(e) })),
    data.classifications, data.stages, data.today,
  );
  return {
    badge,
    liveWarningUntil: live?.expiresOn ?? null,
    count: data.entries.length,
    summary: { count: data.entries.length, badgeLabel: badge?.label ?? null, formal: badge?.level === "formal", liveWarningUntil: live?.expiresOn ?? null },
    events,
  };
}

export function useRecordFacts(userId: number, ready: boolean) {
  const q = usePersonEntries(userId, ready);
  const facts = useMemo(() => recordFacts(q.data), [q.data]);
  return { ...q, facts };
}

/** A timeline card for one record event; tapping opens the entry. */
export function RecordTimelineCard({ event, onOpen }: { event: RecordEvent; onOpen: (entryId: number) => void }) {
  return (
    <button type="button" onClick={() => onOpen(event.entryId)}
      className="w-full text-left rounded-2xl border-2 border-violet-300 dark:border-violet-800 bg-card px-4 py-3 flex items-center gap-3 hover:border-primary/50">
      {event.kind === "meeting" ? <CalendarDays className="w-5 h-5 text-violet-600 shrink-0" /> : <FileText className="w-5 h-5 text-violet-600 shrink-0" />}
      <span className="flex-1 min-w-0">
        <span className="block text-lg font-semibold leading-snug">{event.title}</span>
        <span className="block text-sm text-muted-foreground">{fmtDayIso(event.date)}{event.detail ? ` · ${event.detail}` : ""}</span>
      </span>
      <Lock className="w-4 h-4 text-muted-foreground shrink-0" aria-label="Private" />
      <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
    </button>
  );
}

export function RecordPanel({ userId, ready, person, openEntryId, onOpenEntry }: {
  userId: number;
  ready: boolean;
  person: { id: number; name: string; email: string | null; isActive: boolean };
  /** Controlled from the page (timeline taps); falls back to ?entry=. */
  openEntryId?: number | null;
  onOpenEntry?: (id: number | null) => void;
}) {
  const search = useSearch();
  const q = usePersonEntries(userId, ready);
  const refresh = useRefreshEntries(userId);
  const [filter, setFilter] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [settings, setSettings] = useState(false);
  const [localOpen, setLocalOpen] = useState<number | null>(null);
  const openId = openEntryId !== undefined ? openEntryId : localOpen;
  const setOpen = (id: number | null) => (onOpenEntry ? onOpenEntry(id) : setLocalOpen(id));

  // A to-do's link: /people/:id?entry=12
  useEffect(() => {
    const raw = Number(new URLSearchParams(search).get("entry"));
    if (Number.isInteger(raw) && raw > 0) setOpen(raw);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  if (q.error instanceof PeopleLockedError) return <PeopleLockedCard error={q.error} />;
  if (!ready || q.isLoading) return <div className="flex items-center gap-3 py-8 text-lg text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin" /> Loading…</div>;
  if (q.error || !q.data) {
    return <p className="p-4 rounded-2xl bg-destructive/10 text-destructive text-lg font-semibold">{q.error instanceof Error ? q.error.message : "Couldn't load the record."}</p>;
  }
  const data = q.data;
  const facts = recordFacts(data)!;
  const chips = classificationCounts(data.entries, data.classifications);
  const shown = filterEntries(data.entries, filter);
  const open = data.entries.find(e => e.id === openId) ?? null;
  const clsLabel = (id: number) => data.classifications.find(c => c.id === id)?.label ?? "Record";

  return (
    <div className="space-y-4">
      <ReviewStatusBadge badge={facts.badge} liveWarningUntil={facts.liveWarningUntil} />
      <ProbationCard data={data} onChanged={refresh} />
      <button type="button" onClick={() => setAdding(true)}
        className="w-full h-16 rounded-2xl bg-primary text-primary-foreground text-xl font-bold flex items-center justify-center gap-2 active:scale-[0.99]">
        <Plus className="w-6 h-6" /> Add to record
      </button>

      {chips.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {[{ id: null as number | null, label: "All", count: data.entries.length }, ...chips].map(c => (
            <button key={String(c.id)} type="button" onClick={() => setFilter(c.id)} aria-pressed={filter === c.id}
              className={cn("h-12 px-4 rounded-2xl border-2 text-base font-bold",
                filter === c.id ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground")}>
              {c.label} {c.count}
            </button>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <div className="text-center py-8 rounded-2xl bg-secondary/30">
          <p className="text-xl font-bold">Nothing on the record yet</p>
          <p className="text-base text-muted-foreground">Appraisals, probation reviews, warnings, praise, training — all go here.</p>
        </div>
      ) : shown.map(e => {
        const level = entryLevel(e, data.classifications, data.stages);
        const w = entryWarning(e, data.classifications, data.stages);
        return (
          <button key={e.id} type="button" onClick={() => setOpen(e.id)}
            className={cn("w-full text-left rounded-3xl border-2 bg-card p-4 space-y-2 hover:border-primary/50 active:scale-[0.995]",
              level === "formal" ? "border-rose-300 dark:border-rose-800" : level === "informal" ? "border-violet-300 dark:border-violet-800" : "border-border")}>
            <span className="flex items-center gap-2">
              <span className="flex-1 min-w-0 text-sm font-bold text-muted-foreground">{fmtDayIso(e.entryDate)} · {clsLabel(e.classificationId)}</span>
              <ChevronRight className="w-5 h-5 text-muted-foreground" />
            </span>
            <span className="block text-xl font-bold leading-snug">{e.title || <span className="italic text-muted-foreground">No summary yet</span>}</span>
            <span className="flex flex-wrap gap-2">
              {level !== "none" && (
                <span className={cn("text-sm font-bold px-2.5 py-1 rounded-lg", level === "formal"
                  ? "bg-rose-100 text-rose-900 dark:bg-rose-950/50 dark:text-rose-200" : "bg-violet-100 text-violet-900 dark:bg-violet-950/50 dark:text-violet-200")}>
                  {entryHeadline(e, data.classifications, data.stages)}
                </span>
              )}
              {w && <span className="text-sm font-bold px-2.5 py-1 rounded-lg bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">{w.stage.label} · {warningStatusLabel(w, data.today)}</span>}
              {e.meetingDate && e.meetingType && (
                <span className="text-sm font-bold px-2.5 py-1 rounded-lg bg-sky-100 text-sky-900 dark:bg-sky-950/50 dark:text-sky-200">
                  {MEETING_TYPE_LABEL[e.meetingType]} · {fmtDayIso(e.meetingDate)}{e.meetingTime ? ` ${e.meetingTime}` : ""}
                </span>
              )}
              {e.letters.length > 0 && <span className="text-sm font-bold px-2.5 py-1 rounded-lg bg-secondary">{e.letters.length} letter{e.letters.length === 1 ? "" : "s"}</span>}
            </span>
          </button>
        );
      })}

      <button type="button" onClick={() => setSettings(true)}
        className="w-full h-14 rounded-2xl border-2 border-dashed border-border text-lg font-bold flex items-center justify-center gap-2 text-muted-foreground hover:text-foreground">
        <Settings2 className="w-5 h-5" /> Classifications, stages & letter templates
      </button>
      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
        <Lock className="w-3.5 h-3.5" /> Private — Graeme and People access only, never on your own record. Every look is recorded.
      </p>

      {adding && (
        <PeopleModal title={`Add to record — ${person.name}`} onClose={() => setAdding(false)} wide>
          <NewEntryForm data={data} onCancel={() => setAdding(false)}
            onCreated={id => { setAdding(false); refresh(); setOpen(id); }} />
        </PeopleModal>
      )}
      {open && (
        <PeopleModal title={`${clsLabel(open.classificationId)} — ${person.name}`} onClose={() => { setOpen(null); refresh(); }} wide>
          <EntryEditor key={open.id} entry={open} data={data} onChanged={refresh} person={person} />
        </PeopleModal>
      )}
      {settings && (
        <PeopleModal title="Classifications, stages & letters" onClose={() => setSettings(false)} wide>
          <RecordSettings canEditLists={data.canEditLists} />
        </PeopleModal>
      )}
    </div>
  );
}
