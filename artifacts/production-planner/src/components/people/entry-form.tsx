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
 * Everything autosaves with a visible state (charter rule 5). Writes go
 * through employee-reviews' api(), so a timed-out People PIN asks for the
 * PIN instead of losing what was typed.
 */
import { useState } from "react";
import { AlertTriangle, CalendarDays, FileText, History, Info, Plus, Undo2 } from "lucide-react";
import {
  usesField, entryWarning, periodEnd, PERIOD_MONTHS, warningStatusLabel, evidenceLine, meetingChecklist, isFormalHearing, fmtDayIso,
  sortClassifications, sortStages, RATING_LABEL, RATINGS, PROBATION_OUTCOME_LABEL, PROBATION_OUTCOMES,
  FIT_FOR_WORK_LABEL, FIT_FOR_WORK, MEETING_TYPE_LABEL, MEETING_TYPES,
  type Classification, type MeetingType,
} from "@workspace/people-reviews";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { AutoText, AutoDate, AutoTime, AutoChoice, AutoChecklist, FieldLabel, PillButton } from "./review-fields";
import { recordSend, type PersonRecordEntries, type RecordEntry } from "./reviews-api";
import { LettersBlock } from "./letter-editor";

type Patch = Partial<Omit<RecordEntry, "id" | "history" | "letters">>;

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
  const cls = classifications.find(c => c.id === entry.classificationId);
  const stages = sortStages(data.stages).filter(s => s.active || s.id === entry.stageId);
  const stage = entry.stageId != null ? data.stages.find(s => s.id === entry.stageId) ?? null : null;
  const warning = entryWarning(entry, data.classifications, data.stages);
  const evidence = evidenceLine(cls?.evidence ?? null, data.attendance);
  const checklist = meetingChecklist(entry.meetingType);
  const hidden = (["stage", "rating", "pay", "probation", "fitness"] as const).filter(f => {
    if (usesField(cls, f)) return false;
    if (f === "stage") return entry.stageId != null;
    if (f === "rating") return entry.rating != null;
    if (f === "pay") return !!(entry.payFrom || entry.payTo);
    if (f === "probation") return entry.probationOutcome != null;
    return entry.fitForWork != null;
  });
  const classOptions = classifications
    .filter(c => c.active || c.id === entry.classificationId)
    .map((c: Classification) => ({ value: c.id, label: c.label }));

  return (
    <div className="space-y-4">
      <Block title="What it is">
        <AutoChoice label="Classification" value={entry.classificationId} options={classOptions} pills
          onSave={v => saveAndRefresh({ classificationId: v as number })} />
        {hidden.length > 0 && (
          <p className="text-sm text-muted-foreground flex items-start gap-2">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            Some details filled in under an earlier classification are kept but hidden here. Change it back to see them.
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
          <AutoDate label="Date" initial={entry.entryDate} onSave={v => save({ entryDate: v ?? undefined })} />
          <AutoText label="Summary" initial={entry.title} placeholder="e.g. Late six times since August" maxLength={400}
            onSave={v => save({ title: v })} />
        </div>
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
      </Block>

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

      <Block title="Notes" icon={FileText}>
        <AutoText label="Notes" initial={entry.notes} rows={7} placeholder="Currently …" onSave={v => save({ notes: v })} />
        {entry.notesUpdatedByName && entry.notesUpdatedAt && (
          <p className="text-sm text-muted-foreground">Last written by {entry.notesUpdatedByName}, {fmtDayIso(entry.notesUpdatedAt)}</p>
        )}
      </Block>

      <Block title="Meeting" icon={CalendarDays}>
        <AutoChoice label="Kind of meeting" value={entry.meetingType} allowClear="No meeting" columns={3}
          options={MEETING_TYPES.map(t => ({ value: t, label: MEETING_TYPE_LABEL[t], tone: isFormalHearing(t) ? "warn" as const : undefined }))}
          onSave={v => saveAndRefresh({ meetingType: v as MeetingType | null })} />
        {entry.meetingType && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <AutoDate label="Date" initial={entry.meetingDate} onSave={v => saveAndRefresh({ meetingDate: v })} />
              <AutoTime label="Time" initial={entry.meetingTime} onSave={v => save({ meetingTime: v })} />
            </div>
            <AutoText label="Who's attending" initial={entry.meetingAttendees} placeholder="e.g. Graeme, Lorna taking notes"
              maxLength={2000} onSave={v => save({ meetingAttendees: v || null })} />
            <p className="text-sm text-muted-foreground">Booking puts a to-do on your own list for that day, linking back here. Nothing is sent to {person.name.split(" ")[0]}.</p>
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
          </>
        )}
      </Block>

      <Block title="Outcome & next review">
        <AutoText label="Outcome" initial={entry.outcome} rows={3} placeholder="What was decided — e.g. what must improve"
          onSave={v => save({ outcome: v || null })} />
        <AutoDate label="Next review date" initial={entry.nextReviewDate} onSave={v => saveAndRefresh({ nextReviewDate: v })} />
        <p className="text-sm text-muted-foreground">A next review date puts a to-do on your list for that day.</p>
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

/** Step one of "Add to record": what it is, a summary, the date. Then the
 *  full form opens on the new entry, autosaving from there. */
export function NewEntryForm({ data, onCreated, onCancel }: {
  data: PersonRecordEntries;
  onCreated: (id: number) => void;
  onCancel: () => void;
}) {
  const classifications = sortClassifications(data.classifications).filter(c => c.active);
  const [classificationId, setClassificationId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [entryDate, setEntryDate] = useState(data.today);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const cls = classifications.find(c => c.id === classificationId);
  const evidence = evidenceLine(cls?.evidence ?? null, data.attendance);

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <FieldLabel>What is it?</FieldLabel>
        <div className="flex flex-wrap gap-2">
          {classifications.map(c => (
            <PillButton key={c.id} selected={classificationId === c.id} onClick={() => setClassificationId(c.id)}>{c.label}</PillButton>
          ))}
        </div>
      </div>
      {evidence && (
        <p className={cn("rounded-2xl p-4 text-base", evidence.triggered ? "bg-rose-50 dark:bg-rose-950/30" : "bg-secondary/50")}>
          <span className="font-bold">{evidence.triggered ? "Policy trigger reached. " : "From their attendance: "}</span>{evidence.text}
        </p>
      )}
      <label className="block space-y-1.5">
        <FieldLabel>Summary</FieldLabel>
        <input value={title} onChange={e => setTitle(e.target.value)} maxLength={400} placeholder="e.g. Late six times since August"
          className="w-full h-14 rounded-2xl border-2 border-border bg-card px-4 text-lg" />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1.5">
          <FieldLabel>Date</FieldLabel>
          <input type="date" value={entryDate} onChange={e => setEntryDate(e.target.value)}
            className="w-full h-14 rounded-2xl border-2 border-border bg-card px-4 text-lg font-bold" />
        </label>
        <div className="space-y-1.5">
          <FieldLabel>Put them in review?</FieldLabel>
          <button type="button" onClick={() => setOpen(o => !o)} aria-pressed={open}
            className={cn("w-full h-14 rounded-2xl border-2 text-lg font-bold", open ? "border-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" : "border-border")}>
            {open ? "Yes — open, in review" : "No — just record it"}
          </button>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <button type="button" disabled={!classificationId || busy}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await recordSend<{ id: number }>("POST", `/person/${data.person.id}/entries`, {
                classificationId, title, entryDate, status: open ? "open" : "closed",
              });
              onCreated(r.id);
            } catch (e) {
              toast({ title: "Couldn't add it", description: e instanceof Error ? e.message : "Try again", variant: "destructive" });
            } finally { setBusy(false); }
          }}
          className="h-16 rounded-2xl bg-primary text-primary-foreground text-xl font-bold flex items-center justify-center gap-2 disabled:opacity-50">
          <Plus className="w-6 h-6" /> Add to record
        </button>
        <button type="button" onClick={onCancel} className="h-16 rounded-2xl border-2 border-border text-xl font-bold">Cancel</button>
      </div>
      <p className="text-sm text-muted-foreground">Then fill in the rest — notes, a meeting, the outcome, a letter. Everything saves as you go.</p>
    </div>
  );
}
