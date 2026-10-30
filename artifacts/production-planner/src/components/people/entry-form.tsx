/**
 * THE one form for anything on someone's employment record (Graeme,
 * 2026-10-12: "reduce the number of options for recording something, but
 * allow classifications for that record to be the defining part").
 *
 * Every entry has the same fields — date, summary, notes, open/closed, an
 * optional meeting, outcome, next review. The classification switches on a
 * few extras (its field sets: stage & warnings, rating, pay change,
 * probation outcome, fit for work). Changing the classification keeps every
 * value already filled in: fields the new one doesn't use are hidden, not
 * deleted, and the change is logged ("Reclassified from X to Y").
 *
 * A REVIEW is an entry with a meeting status (Graeme, 2026-10-12: "one
 * review that we then classify"): booked, held or cancelled, its day and
 * time, and its write-up — all changeable here after the fact. The ACAS
 * meeting type is an optional detail under it, not a kind picked up front.
 * New ones start from book-review.tsx ("Book a review").
 *
 * Everything autosaves with a visible state (charter rule 5). Writes go
 * through employee-reviews' api(), so a timed-out People PIN asks for the
 * PIN instead of losing what was typed.
 */
import { useState } from "react";
import { AlertTriangle, CalendarDays, ChevronDown, History, Info, ListTodo, Undo2 } from "lucide-react";
import {
  usesField, entryWarning, periodEnd, PERIOD_MONTHS, warningStatusLabel, evidenceLine, meetingChecklist, isFormalHearing, fmtDayIso,
  sortClassifications, sortStages, showTriggerChoice, entryClassification, entryClassIds, RATING_LABEL, RATINGS, PROBATION_OUTCOME_LABEL, PROBATION_OUTCOMES,
  FIT_FOR_WORK_LABEL, FIT_FOR_WORK, MEETING_TYPE_LABEL, MEETING_TYPES, MEETING_STATUSES, MEETING_STATUS_LABEL, isReview as entryIsReview,
  type Classification, type MeetingType, type MeetingStatus,
} from "@workspace/people-reviews";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { AutoText, AutoDate, AutoTime, AutoChoice, AutoChecklist, FieldLabel } from "./review-fields";
import { recordSend, type PersonRecordEntries, type RecordEntry } from "./reviews-api";
import { LettersBlock } from "./letter-editor";
import { WhatHappened } from "./what-happened";
import { TriggerLinkField } from "./trigger-link";
import { AutoClassTicks } from "./class-ticks";

type Patch = Partial<Omit<RecordEntry, "id" | "history" | "letters" | "writeUp" | "heldAt">> & {
  /** "Put it on my to-do list" — the only way a to-do is made (30 Oct 2026). */
  meetingTodo?: boolean;
  reviewTodo?: boolean;
};

/** Asks before anything goes on a to-do list; says so once it's there. */
function TodoOptIn({ on, label, onAdd }: { on: boolean; label: string; onAdd: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  if (on) return <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5"><ListTodo className="w-4 h-4" /> On your to-do list.</p>;
  return (
    <button type="button" disabled={busy}
      onClick={async () => {
        setBusy(true);
        try { await onAdd(); } catch (e) { toast({ title: "Couldn't add it", description: e instanceof Error ? e.message : "Try again", variant: "destructive" }); }
        finally { setBusy(false); }
      }}
      className="min-h-11 px-3 rounded-xl border-2 border-border text-base font-bold flex items-center gap-2 text-muted-foreground hover:text-foreground disabled:opacity-50">
      <ListTodo className="w-4 h-4" /> {label}
    </button>
  );
}

function Block({ title, icon: Icon, children, tone }: { title: string; icon?: typeof Info; children: React.ReactNode; tone?: "warn" }) {
  return (
    <section className={cn("rounded-3xl border-2 p-4 space-y-4", tone === "warn" ? "border-amber-300 dark:border-amber-800" : "border-border bg-card")}>
      <h3 className="text-lg font-bold flex items-center gap-2">{Icon && <Icon className="w-5 h-5 text-primary" />} {title}</h3>
      {children}
    </section>
  );
}

export function EntryEditor({ entry, data, onChanged, person }: {
  entry: RecordEntry;
  data: PersonRecordEntries;
  onChanged: () => void;
  person: { id: number; name: string; email: string | null; isActive: boolean };
}) {
  const save = (p: Patch) => recordSend("PATCH", `/entries/${entry.id}`, p);
  /** For fields that change what the form shows — save, then refresh. */
  const saveAndRefresh = async (p: Patch) => { await save(p); onChanged(); };

  const classifications = sortClassifications(data.classifications);
  // Every ticked classification merged (0184): its field sets, evidence, label.
  const cls = entryClassification(entry, classifications);
  const ticked = entryClassIds(entry);
  const stages = sortStages(data.stages).filter(s => s.active || s.id === entry.stageId);
  const stage = entry.stageId != null ? data.stages.find(s => s.id === entry.stageId) ?? null : null;
  const warning = entryWarning(entry, data.classifications, data.stages);
  const evidence = evidenceLine(cls?.evidence ?? null, data.attendance);
  const checklist = meetingChecklist(entry.meetingType);
  const isReview = entryIsReview(entry);
  const first = person.name.split(" ")[0];
  const hidden = (["stage", "rating", "pay", "probation", "fitness"] as const).filter(f => {
    if (usesField(cls, f)) return false;
    if (f === "stage") return entry.stageId != null;
    if (f === "rating") return entry.rating != null;
    if (f === "pay") return !!(entry.payFrom || entry.payTo);
    if (f === "probation") return entry.probationOutcome != null;
    return entry.fitForWork != null;
  });
  const classOptions = classifications.filter((c: Classification) => c.active || ticked.includes(c.id));
  // A meeting's extras sit under More options — opened by itself when
  // something in there is already in use, so nothing filled in is hidden.
  const extrasInUse = entry.status === "open" || entry.answersTrigger != null || entry.stageId != null || !!entry.meetingType || !!entry.meetingAttendees
    || !!(entry.outcome ?? "").trim() || entry.nextReviewDate != null || entry.letters.length > 0
    || entry.rating != null || !!(entry.payFrom || entry.payTo) || entry.probationOutcome != null || entry.fitForWork != null;
  const [more, setMore] = useState(extrasInUse);

  const classificationField = (
    <>
      <AutoClassTicks label="What it's about — tick all that fit, change any time" classifications={classOptions} initial={ticked}
        onSave={ids => saveAndRefresh({ classificationIds: ids })} />
      {hidden.length > 0 && (
        <p className="text-sm text-muted-foreground flex items-start gap-2">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          Some details filled in under an earlier classification are kept but hidden here. Change it back to see them.
        </p>
      )}
    </>
  );
  const statusFields = (
    <>
      <AutoChoice label="Status" value={entry.status} columns={2}
        options={[
          { value: "open", label: "Open — in review", hint: "Shows on their badge until closed", tone: "warn" },
          { value: "closed", label: "Closed / on the record", hint: "Nothing outstanding" },
        ]}
        onSave={v => saveAndRefresh({ status: v as RecordEntry["status"] })} />
      {entry.status === "open" && <ReviewPeriod entry={entry} save={saveAndRefresh} onChanged={onChanged} />}
      {evidence && (
        <div className={cn("rounded-2xl p-4 flex items-start gap-3", evidence.triggered ? "bg-rose-50 dark:bg-rose-950/30" : "bg-secondary/50")}>
          {evidence.triggered && <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />}
          <p className="text-base">
            <span className="font-bold">{evidence.triggered ? "Policy trigger reached. " : "From their attendance: "}</span>
            {evidence.text} <span className="text-muted-foreground">See Attendance on this record.</span>
          </p>
        </div>
      )}
    </>
  );

  const extras = (
    <>
      {showTriggerChoice(data.triggerReview, entry.answersTrigger) && (
        <Block title="Attendance trigger" icon={AlertTriangle}>
          <TriggerLinkField entry={entry} data={data} onChanged={onChanged} />
        </Block>
      )}

      {isReview && (
        <Block title="What it's about">
          {classificationField}
          {statusFields}
        </Block>
      )}

      {usesField(cls, "stage") && (
        <Block title="Stage" tone={stage?.formal ? "warn" : undefined}>
          <AutoChoice label="Where it's at" value={entry.stageId} allowClear="No stage — just in review" columns={3}
            options={stages.map(s => ({
              value: s.id, label: s.label,
              hint: s.type === "warning" ? `Warning · live ${s.defaultExpiryMonths ?? 12} months${s.optional ? " · optional" : ""}`
                : s.type === "outcome" ? "Recorded only — nothing happens automatically"
                : s.optional ? "Optional" : undefined,
              tone: s.formal ? "warn" as const : undefined,
            }))}
            onSave={v => saveAndRefresh({ stageId: v as number | null })} />
          {stage?.type === "warning" && (
            <div className="space-y-2">
              <AutoDate key={`exp-${entry.stageId}-${entry.warningExpiresOn}`} label="Warning is live until (last day)"
                initial={entry.warningExpiresOn} min={entry.entryDate}
                onSave={v => saveAndRefresh({ warningExpiresOn: v })} />
              {warning && (
                <p className={cn("text-base font-bold", warning.withdrawnAt ? "text-muted-foreground" : "text-amber-800 dark:text-amber-200")}>
                  {warningStatusLabel(warning, data.today)}
                  {entry.warningWithdrawnReason ? ` — ${entry.warningWithdrawnReason}` : ""}
                </p>
              )}
              {warning && !warning.withdrawnAt && <WithdrawWarning entryId={entry.id} onDone={onChanged} />}
            </div>
          )}
        </Block>
      )}

      {(usesField(cls, "rating") || usesField(cls, "pay") || usesField(cls, "probation")) && (
        <Block title={usesField(cls, "probation") ? "Probation review" : usesField(cls, "rating") ? "Appraisal" : "Pay"}>
          {usesField(cls, "rating") && (
            <AutoChoice label="Rating" value={entry.rating} allowClear="Not rated" columns={2}
              options={RATINGS.map(r => ({ value: r, label: RATING_LABEL[r] }))}
              onSave={v => save({ rating: v as RecordEntry["rating"] })} />
          )}
          {usesField(cls, "probation") && (
            <>
              <AutoChoice label="Probation outcome" value={entry.probationOutcome} allowClear="Not decided yet" columns={2}
                options={PROBATION_OUTCOMES.map(o => ({ value: o, label: PROBATION_OUTCOME_LABEL[o] }))}
                onSave={v => saveAndRefresh({ probationOutcome: v as RecordEntry["probationOutcome"] })} />
              {entry.probationOutcome === "extended" && (
                <AutoDate label="New probation end date" initial={entry.probationNewEnd} onSave={v => save({ probationNewEnd: v })} />
              )}
            </>
          )}
          {usesField(cls, "pay") && (
            <div className="grid gap-4 sm:grid-cols-3">
              <AutoText label="Pay change — from" initial={entry.payFrom} placeholder="e.g. £12.21 an hour" maxLength={200}
                onSave={v => save({ payFrom: v || null })} />
              <AutoText label="To" initial={entry.payTo} placeholder="e.g. £12.75 an hour" maxLength={200}
                onSave={v => saveAndRefresh({ payTo: v || null })} />
              <AutoDate label="From when" initial={entry.payEffectiveOn} onSave={v => save({ payEffectiveOn: v })} />
            </div>
          )}
        </Block>
      )}

      {usesField(cls, "fitness") && (
        <Block title="Fit for work">
          <AutoChoice label="Fit for work?" value={entry.fitForWork} allowClear="Not said" columns={2}
            options={FIT_FOR_WORK.map(f => ({ value: f, label: FIT_FOR_WORK_LABEL[f], tone: f === "no" ? "warn" as const : undefined }))}
            onSave={v => save({ fitForWork: v as RecordEntry["fitForWork"] })} />
        </Block>
      )}

      {(isReview || entry.meetingType) && <Block title="Formal meeting details" icon={CalendarDays}>
        <AutoChoice label="Formal meeting type — only if it is one" value={entry.meetingType} allowClear="Not a formal meeting" columns={3}
          options={MEETING_TYPES.map(t => ({ value: t, label: MEETING_TYPE_LABEL[t], tone: isFormalHearing(t) ? "warn" as const : undefined }))}
          onSave={v => saveAndRefresh({ meetingType: v as MeetingType | null })} />
        <AutoText label="Who's attending" initial={entry.meetingAttendees} placeholder="e.g. Graeme, Lorna taking notes"
          maxLength={2000} onSave={v => save({ meetingAttendees: v || null })} />
        <p className="text-sm text-muted-foreground">Nothing here is sent to {first} — only what you share from What happened.</p>
        {checklist.length > 0 && (
          <div className="rounded-2xl bg-amber-50 dark:bg-amber-950/30 p-4 space-y-3">
            {isFormalHearing(entry.meetingType) && (
              <p className="text-base font-semibold text-amber-950 dark:text-amber-100">
                Before a formal hearing they must have written notice, and they have the right to be accompanied by a colleague or trade union rep (ACAS Code).
              </p>
            )}
            <AutoChecklist key={entry.meetingType} label="Checklist" items={checklist} initial={entry.meetingChecklist}
              onSave={keys => save({ meetingChecklist: keys })} />
          </div>
        )}
      </Block>}

      <Block title="Outcome & next review">
        <AutoText label="Outcome" initial={entry.outcome} rows={3} placeholder="What was decided — e.g. what must improve"
          onSave={v => save({ outcome: v || null })} />
        <AutoDate label="Next review date" initial={entry.nextReviewDate} onSave={v => saveAndRefresh({ nextReviewDate: v })} />
        {entry.nextReviewDate && (
          <TodoOptIn on={!!entry.reviewOnTodoList} label="Put it on my to-do list for that day" onAdd={() => saveAndRefresh({ reviewTodo: true })} />
        )}
      </Block>

      <LettersBlock entry={entry} data={data} person={person} onChanged={onChanged} />

      {entry.history.length > 0 && (
        <Block title="History" icon={History}>
          <ul className="space-y-2">
            {entry.history.map((h, i) => (
              <li key={i} className="text-base">
                <span className="font-semibold">{fmtDayIso(h.at)}</span> — {h.detail ?? h.action}{h.by ? ` (${h.by})` : ""}
              </li>
            ))}
          </ul>
        </Block>
      )}
    </>
  );

  return (
    <div className="space-y-4">
      {isReview ? (
        // The meeting: title, day, time, status — that's all up front.
        <Block title="The meeting" icon={CalendarDays}>
          <AutoText label="Title" initial={entry.title} placeholder="Optional — the AI names it from your notes" maxLength={400}
            onSave={v => save({ title: v })} />
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
            {/* The meeting's day is the entry's date too, so the record,
                letters and warnings all read the same day. */}
            <AutoDate label="Day" initial={entry.meetingDate ?? entry.entryDate}
              onSave={v => (v ? saveAndRefresh({ meetingDate: v, entryDate: v }) : Promise.reject(new Error("A meeting needs a day.")))} />
            <AutoTime label="Time" initial={entry.meetingTime} onSave={v => save({ meetingTime: v })} />
          </div>
          {/* No status to pick (Graeme, 30 Oct 2026): it's on the schedule
              until the notes go on — adding them is what says it happened. */}
          <p className="text-base font-semibold">
            {entry.meetingStatus === "held" ? "Held." : entry.meetingStatus === "cancelled" ? "Cancelled — kept on the record."
              : "On the schedule — add the meeting notes below once it's happened."}
          </p>
          {entry.meetingStatus === "booked" && (
            <div className="flex flex-wrap items-center gap-3">
              <TodoOptIn on={!!entry.meetingOnTodoList} label="Put it on my to-do list" onAdd={() => saveAndRefresh({ meetingTodo: true })} />
              <button type="button" onClick={() => void saveAndRefresh({ meetingStatus: "cancelled" })}
                className="min-h-11 px-2 text-sm font-semibold text-muted-foreground hover:text-destructive hover:underline">Not happening? Mark it cancelled</button>
            </div>
          )}
          {entry.meetingStatus === "cancelled" && (
            <button type="button" onClick={() => void saveAndRefresh({ meetingStatus: "booked" })}
              className="min-h-11 px-2 text-sm font-semibold text-primary hover:underline">Put it back on the schedule</button>
          )}
        </Block>
      ) : (
        <Block title="What it is">
          {classificationField}
          <AutoChoice label="Meeting" value={entry.meetingStatus} allowClear="No meeting — just on the record" columns={2}
            options={MEETING_STATUSES.map(s => ({ value: s, label: MEETING_STATUS_LABEL[s],
              hint: s === "booked" ? "Coming up" : s === "held" ? "It happened" : "Not happening — kept on the record" }))}
            onSave={v => saveAndRefresh({ meetingStatus: v as MeetingStatus | null, ...(v && !entry.meetingDate ? { meetingDate: entry.entryDate } : {}) })} />
          <div className="grid gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
            <AutoDate label="Date" initial={entry.entryDate} onSave={v => save({ entryDate: v ?? undefined })} />
            <AutoText label="Summary" initial={entry.title} placeholder="e.g. Late six times since August" maxLength={400}
              onSave={v => save({ title: v })} />
          </div>
          {statusFields}
        </Block>
      )}

      <WhatHappened entry={entry} data={data} person={person} onChanged={onChanged} />

      {isReview ? (
        <div className="space-y-4">
          <button type="button" onClick={() => setMore(m => !m)} aria-expanded={more}
            className="w-full min-h-14 rounded-2xl border-2 border-dashed border-border px-4 py-2 text-lg font-bold flex items-center justify-center gap-2 text-muted-foreground hover:text-foreground">
            More options <ChevronDown className={cn("w-5 h-5 shrink-0 transition-transform", more && "rotate-180")} />
          </button>
          {more && extras}
        </div>
      ) : extras}
    </div>
  );
}

/** The review period of an open entry: start + length → end; Extend keeps
 *  the history ("Extended by 1 month to 12 Jan 2027"). */
function ReviewPeriod({ entry, save, onChanged }: { entry: RecordEntry; save: (p: Patch) => Promise<void>; onChanged: () => void }) {
  const start = entry.reviewStart ?? entry.entryDate;
  const [busy, setBusy] = useState(false);
  const extend = async (months: number) => {
    setBusy(true);
    try {
      const r = await recordSend<{ message: string }>("POST", `/entries/${entry.id}/extend`, { months });
      toast({ title: r.message });
      onChanged();
    } catch (e) {
      toast({ title: "Couldn't extend it", description: e instanceof Error ? e.message : "Try again", variant: "destructive" });
    } finally { setBusy(false); }
  };
  return (
    <div className="rounded-2xl border-2 border-violet-300 dark:border-violet-800 p-4 space-y-3">
      <p className="text-base font-bold">
        Review period: {fmtDayIso(start)} → {entry.reviewEnd ? fmtDayIso(entry.reviewEnd) : "no end set"}
      </p>
      {!entry.reviewEnd ? (
        <div className="space-y-2">
          <FieldLabel>How long?</FieldLabel>
          <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
            {PERIOD_MONTHS.map(m => (
              <button key={m} type="button" onClick={() => void save({ reviewStart: start, reviewEnd: periodEnd(start, m) })}
                className="h-14 rounded-2xl border-2 border-border text-lg font-bold hover:bg-secondary/50">{m} month{m === 1 ? "" : "s"}</button>
            ))}
          </div>
          <AutoDate label="…or pick the last day" initial={null} min={start} onSave={v => save({ reviewStart: start, reviewEnd: v })} />
        </div>
      ) : (
        <div className="space-y-2">
          <FieldLabel>Extend by</FieldLabel>
          <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
            {PERIOD_MONTHS.map(m => (
              <button key={m} type="button" disabled={busy} onClick={() => void extend(m)}
                className="h-14 rounded-2xl border-2 border-border text-lg font-bold hover:bg-secondary/50 disabled:opacity-50">+{m} month{m === 1 ? "" : "s"}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function WithdrawWarning({ entryId, onDone }: { entryId: number; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="h-12 px-4 rounded-xl border-2 border-border font-bold flex items-center gap-2 hover:bg-secondary/50">
        <Undo2 className="w-5 h-5" /> Withdraw this warning
      </button>
    );
  }
  return (
    <div className="rounded-2xl border-2 border-border p-4 space-y-3">
      <FieldLabel>Why is it withdrawn? (e.g. overturned on appeal)</FieldLabel>
      <input value={reason} onChange={e => setReason(e.target.value)} className="w-full h-14 rounded-2xl border-2 border-border bg-card px-4 text-lg" />
      <div className="grid gap-2 sm:grid-cols-2">
        <button type="button" disabled={!reason.trim() || busy}
          onClick={async () => {
            setBusy(true);
            try { await recordSend("POST", `/entries/${entryId}/withdraw-warning`, { reason }); onDone(); setOpen(false); }
            catch (e) { toast({ title: "Couldn't withdraw it", description: e instanceof Error ? e.message : "Try again", variant: "destructive" }); }
            finally { setBusy(false); }
          }}
          className="h-14 rounded-2xl bg-primary text-primary-foreground text-lg font-bold disabled:opacity-50">Withdraw it</button>
        <button type="button" onClick={() => setOpen(false)} className="h-14 rounded-2xl border-2 border-border text-lg font-bold">Keep it</button>
      </div>
    </div>
  );
}

