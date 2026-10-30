/**
 * A review's write-up — feedback, objectives and notes — and the review's
 * card on the person record's timeline (Graeme, 2026-10-12: one review,
 * classified). Moved here from the old components/employee-reviews.tsx
 * meetings, onto the employment record (migration 0178).
 *
 *   • Each part is PRIVATE to whoever wrote it until shared. Three levels
 *     (Graeme, 2026-10-14): Private to you; Shared with HR (People-access
 *     colleagues picked by name); Shared with the colleague, which publishes
 *     it to their own record and tells them — only after a two-step
 *     confirmation in the quiet "Share…" dialog (share-dialog.tsx). The
 *     server decides who may read what — nothing here hides rows it was sent.
 *   • Only the author can change, share or remove their own part; for them
 *     every field autosaves with a visible save state (charter rule 5).
 *   • A write-up is written in one go and shared as one, so a probation
 *     review never reaches the colleague as scattered fragments (Graeme,
 *     2026-09-17).
 *
 * Server: routes/people-review-notes.ts (People PIN, founder or People
 * access, never your own record, every write audited).
 */
import { useState } from "react";
import {
  CalendarDays, CheckCircle2, ChevronRight, Handshake, Loader2, Lock, MessageSquare, Pencil, Plus, Sparkles, Target, Trash2, X, Check,
} from "lucide-react";
import {
  NOTE_KIND_LABEL, MEETING_STATUS_LABEL, MEETING_TYPE_LABEL, fmtDayIso, entryHeadline, entryLevel, whatHappened, entryClassLabels, agreementBullets,
  noteLevel, levelLabel, patchForLevel,
  type Classification, type Stage, type ShareLevel,
} from "@workspace/people-reviews";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { AutoText, AutoDate } from "./review-fields";
import { PinnedFooter, pinnedPrimaryClass } from "@/components/ui/pinned-save-bar";
import { recordSend, recordDelete, type RecordEntry, type ReviewNote } from "./reviews-api";
import { ShareDialog, ShareButton, LEVEL_ICON } from "./share-dialog";

/** The level a note is at, and its label as this viewer reads it
 *  ("Private to you", "Shared with Lorna", "Shared with you", "Shared with Major"). */
export function noteShareView(note: ReviewNote, viewerId: number | null, personName: string) {
  const hrIds = (note.sharedWith ?? []).map(x => x.id);
  const level = noteLevel({ visibility: note.visibility, sharedWithUserIds: hrIds });
  const hrNames = (note.sharedWith ?? []).map(x => (x.id === viewerId ? "you" : x.name.split(" ")[0]));
  const label = levelLabel(level, { colleagueFirst: personName.split(" ")[0], hrNames, viewerIsAuthor: note.authorId === viewerId });
  return { level, hrIds, label, Icon: LEVEL_ICON[level] };
}

const NOTE_ICON = { note: MessageSquare, feedback: MessageSquare, objective: Target, agreement: Handshake } as const;

/** What was agreed, as the plain bullet list it is (0186). */
export function AgreementBullets({ body, className }: { body: string; className?: string }) {
  const points = agreementBullets(body);
  if (points.length === 0) return null;
  return (
    <ul className={cn("list-disc pl-6 space-y-1.5 marker:text-primary", className)}>
      {points.map((p, i) => <li key={i} className="leading-relaxed break-words">{p}</li>)}
    </ul>
  );
}

// ── One part of a write-up ─────────────────────────────────────────────────

export function ReviewNoteCard({ note, viewerId, canWrite, personName, onChanged, inReport = false }: {
  note: ReviewNote;
  viewerId: number | null;
  canWrite: boolean;
  personName: string;
  onChanged: () => void;
  /** Part of a review's write-up: shared as one report, so no per-part
   *  share buttons (a loose old diary note keeps its own). */
  inReport?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<null | "remove">(null);
  const [sharing, setSharing] = useState(false);
  const [busy, setBusy] = useState(false);
  const Icon = NOTE_ICON[note.kind] ?? MessageSquare;
  const isAgreement = note.kind === "agreement";
  const share = noteShareView(note, viewerId, personName);
  const isPrivate = share.level !== "colleague";
  const first = personName.split(" ")[0];
  // The server only lets an author touch their own note; the buttons follow.
  const mine = canWrite && viewerId != null && note.authorId === viewerId;
  const save = (patch: Record<string, unknown>) => recordSend("PATCH", `/review-notes/${note.id}`, patch);

  const act = async (fn: () => Promise<unknown>, done: string | null, failTitle: string) => {
    setBusy(true);
    try {
      await fn();
      if (done) toast({ title: done });
      setConfirm(null);
      onChanged();
    } catch (e) {
      toast({ title: failTitle, description: e instanceof Error ? e.message : "Try again", variant: "destructive" });
    } finally { setBusy(false); }
  };

  return (
    <div className={cn("rounded-2xl border-2 bg-card p-4 space-y-3",
      isPrivate ? "border-dashed border-muted-foreground/40" : "border-border", note.doneAt && !editing && "opacity-70")}>
      <div className="flex items-start gap-3">
        <Icon className="w-6 h-6 text-muted-foreground shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-sm font-bold uppercase tracking-wide text-muted-foreground">{NOTE_KIND_LABEL[note.kind] ?? "Note"}</span>
            <span className={cn("inline-flex items-center gap-1 text-sm font-bold px-2.5 py-1 rounded-lg",
              share.level === "colleague" ? "bg-primary/10 text-primary"
                : share.level === "hr" ? "bg-sky-100 text-sky-900 dark:bg-sky-950/50 dark:text-sky-200"
                : "bg-secondary text-muted-foreground")}>
              <share.Icon className="w-3.5 h-3.5" /> {share.label}
            </span>
            {note.doneAt && (
              <span className="inline-flex items-center gap-1 text-sm font-bold px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" /> Done
              </span>
            )}
          </div>
          {editing ? (
            // Autosaves as you type, with its own save state per field.
            <div className="space-y-3 mt-2">
              {!isAgreement && (
                <AutoText label="Headline (optional)" initial={note.title} maxLength={200}
                  placeholder={note.kind === "objective" ? "e.g. Increase in output speed" : undefined}
                  onSave={v => save({ title: v.trim() || null })} />
              )}
              <AutoText label={isAgreement ? "Agreed points — one per line" : note.kind === "objective" ? "What it means in practice" : "What was said"}
                initial={note.body} rows={isAgreement ? 6 : 5} maxLength={10_000}
                onSave={v => (v.trim() ? save({ body: v }) : Promise.reject(new Error("It can't be empty — type something, or remove it.")))} />
              {note.kind === "objective" && (
                <AutoDate label="Due by (optional)" initial={note.dueDate} onSave={v => save({ dueDate: v })} />
              )}
              <button type="button" onClick={() => { setEditing(false); onChanged(); }}
                className="w-full h-14 rounded-2xl border-2 border-border text-lg font-bold flex items-center justify-center gap-2 hover:bg-secondary/50">
                <Check className="w-5 h-5" /> Done editing
              </button>
            </div>
          ) : (
            // The agreed points sit full width under this row (narrow phones).
            isAgreement ? null : (
              <div className="space-y-1">
                {note.title && <p className="text-xl font-bold leading-snug break-words">{note.title}</p>}
                <p className="text-xl leading-relaxed whitespace-pre-wrap break-words">{note.body}</p>
              </div>
            )
          )}
          <p className="text-base text-muted-foreground mt-2">
            {note.authorName ?? "Someone"} · {fmtDayIso(note.createdAt.slice(0, 10))}
            {note.dueDate && ` · due ${fmtDayIso(note.dueDate)}`}
          </p>
        </div>
        {mine && !editing && !confirm && (
          <div className="flex gap-1 shrink-0">
            <button type="button" onClick={() => setEditing(true)} title="Edit — you wrote this"
              className="p-2.5 rounded-xl text-muted-foreground hover:text-foreground hover:bg-secondary">
              <Pencil className="w-5 h-5" />
            </button>
            <button type="button" onClick={() => setConfirm("remove")} title="Remove — you wrote this"
              className="p-2.5 rounded-xl text-muted-foreground hover:text-destructive hover:bg-destructive/10">
              <Trash2 className="w-5 h-5" />
            </button>
          </div>
        )}
      </div>

      {isAgreement && !editing && <AgreementBullets body={note.body} className="text-lg sm:text-xl" />}

      {confirm === "remove" && (
        <div className="rounded-2xl border-2 border-destructive bg-destructive/5 p-4 space-y-3">
          <p className="text-lg font-bold">Remove this {(NOTE_KIND_LABEL[note.kind] ?? "note").toLowerCase()}?</p>
          <p className="text-base">{share.level === "private" ? "Nobody else has seen it." : share.level === "hr" ? `It goes for ${share.label.replace(/^Shared with /, "")} too.` : "It's shared — it goes from their record too."} It's kept in the audit, not shown.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <button type="button" disabled={busy} onClick={() => void act(() => recordDelete(`/review-notes/${note.id}`), "Removed", "Couldn't remove it")}
              className="h-14 rounded-2xl bg-destructive text-destructive-foreground text-lg font-bold flex items-center justify-center gap-2 disabled:opacity-50">
              {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Trash2 className="w-5 h-5" />} Yes, remove it
            </button>
            <button type="button" onClick={() => setConfirm(null)} className="h-14 rounded-2xl border-2 border-border text-lg font-bold flex items-center justify-center gap-2">
              <X className="w-5 h-5" /> Keep it
            </button>
          </div>
        </div>
      )}

      {mine && !editing && confirm !== "remove" && (
        <div className="space-y-3">
          {note.kind === "objective" && (
            <button type="button" disabled={busy} onClick={() => void act(() => save({ done: !note.doneAt }), null, "Couldn't save")}
              className="w-full h-14 rounded-2xl border-2 border-border text-lg font-bold flex items-center justify-center gap-2 hover:bg-secondary/50 disabled:opacity-50">
              {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />} {note.doneAt ? "Not done after all" : "Mark as done"}
            </button>
          )}
          {/* Quiet on purpose (Graeme, 2026-10-14): sharing is a choice made
              in the dialog — two steps before it reaches the colleague. */}
          <div className="flex justify-end">
            <ShareButton onClick={() => setSharing(true)} label={share.level === "private" ? "Share…" : "Who sees this…"} />
          </div>
        </div>
      )}
      {sharing && (
        <ShareDialog
          heading={share.level === "private" ? "Share this note" : "Who sees this note"}
          parts={[note]} colleagueName={personName} current={share.level} currentHrIds={share.hrIds}
          // A write-up part reaches the colleague only with the whole
          // write-up ("Share write-up…"), never as a stray fragment.
          allow={inReport && share.level !== "colleague" ? ["private", "hr"] : ["private", "hr", "colleague"]}
          onConfirm={async (level: ShareLevel, ids: number[]) => {
            await save(patchForLevel(level, ids));
            toast({ title: level === "colleague" ? `Shared with ${first}` : level === "hr" ? "Shared with HR" : "Private to you again" });
            onChanged();
          }}
          onClose={() => setSharing(false)} />
      )}
    </div>
  );
}

/** The agreed points in "What we agreed" — one list from the latest review
 *  that has one (0186). Not done, not due: just what's going to happen. */
export function AgreedListCard({ note, personName, viewerId = null }: { note: ReviewNote; personName: string; viewerId?: number | null }) {
  const share = noteShareView(note, viewerId, personName);
  return (
    <div className="rounded-2xl border-2 border-border bg-card px-4 py-3 space-y-2">
      <p className="text-sm text-muted-foreground flex items-center gap-2 flex-wrap">
        <Handshake className="w-4 h-4 text-primary shrink-0" />
        {note.authorName ?? "Someone"} · {fmtDayIso(note.createdAt.slice(0, 10))}
        <span className={cn("inline-flex items-center gap-1 font-bold", share.level === "colleague" && "text-primary")}>
          <share.Icon className="w-3.5 h-3.5" /> {share.label}
        </span>
      </p>
      <AgreementBullets body={note.body} className="text-lg" />
    </div>
  );
}

/** An objective in "What we agreed" — a reminder, deliberately compact. The
 *  full card (edit, remove) sits under the review that set it. */
export function AgreedObjectiveCard({ note, viewerId, canWrite, onChanged }: {
  note: ReviewNote; viewerId: number | null; canWrite: boolean; onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const mine = canWrite && viewerId != null && note.authorId === viewerId;
  return (
    <div className="rounded-2xl border-2 border-border bg-card px-4 py-3 flex items-start gap-3">
      <Target className="w-5 h-5 text-primary shrink-0 mt-1" />
      <div className="flex-1 min-w-0">
        <p className="text-lg font-bold leading-snug break-words">{note.title ?? note.body}</p>
        {note.title && <p className="text-base text-muted-foreground leading-relaxed whitespace-pre-wrap break-words mt-0.5">{note.body}</p>}
        {note.dueDate && <p className="text-sm text-muted-foreground mt-1">Due {fmtDayIso(note.dueDate)}</p>}
      </div>
      {mine && (
        <button type="button" disabled={busy} title="Mark this objective done"
          onClick={async () => {
            setBusy(true);
            try { await recordSend("PATCH", `/review-notes/${note.id}`, { done: true }); onChanged(); }
            catch (e) { toast({ title: "Couldn't tick it off", description: e instanceof Error ? e.message : "Try again", variant: "destructive" }); }
            finally { setBusy(false); }
          }}
          className="shrink-0 h-11 px-3 rounded-xl text-sm font-bold text-muted-foreground hover:text-emerald-600 flex items-center gap-1.5 disabled:opacity-50">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Done
        </button>
      )}
    </div>
  );
}

// ── Writing a review up ────────────────────────────────────────────────────

/** Feedback, objectives and notes in one go — saved as one write-up and
 *  shared as one. In the order the conversation runs. The draft stays put
 *  if the save fails (a PIN time-out included), so Save just needs pressing
 *  again. Writing up a booked review marks it held. */
export function WriteUpComposer({ entryId, personName, onDone, onCancel, hideNotes = false }: {
  entryId: number; personName: string; onDone: () => void; onCancel: () => void;
  /** In "What happened" the meeting's notes box is already there — never ask twice. */
  hideNotes?: boolean;
}) {
  const [feedback, setFeedback] = useState("");
  const [objectives, setObjectives] = useState<Array<{ title: string; body: string; dueDate: string }>>([{ title: "", body: "", dueDate: "" }]);
  const [notes, setNotes] = useState("");
  const [sharing, setSharing] = useState(false);
  const [busy, setBusy] = useState(false);
  const first = personName.split(" ")[0];
  const hasSomething = !!feedback.trim() || !!notes.trim() || objectives.some(o => o.title.trim() || o.body.trim());
  const box = "w-full px-4 py-3 rounded-2xl border-2 border-border bg-background text-lg leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y";

  const post = (level: ShareLevel, hrIds: number[]) => recordSend("POST", `/entries/${entryId}/write-up`, {
    feedback, notes, share: level === "colleague", sharedWithUserIds: level === "hr" ? hrIds : [],
    objectives: objectives.map(o => ({ title: o.title, body: o.body, dueDate: o.dueDate || null })),
  });
  const saved = (level: ShareLevel) => {
    toast({
      title: level === "colleague" ? "Written up and shared" : level === "hr" ? "Written up — shared with HR" : "Written up — private to you",
      description: level === "colleague" ? `${first} can read it now.` : "Share the whole write-up whenever you're ready.",
    });
    onDone();
  };
  const save = async () => {
    setBusy(true);
    try { await post("private", []); saved("private"); }
    catch (e) {
      toast({ title: "Couldn't save the write-up", description: e instanceof Error ? e.message : "Try again — nothing typed is lost", variant: "destructive" });
    } finally { setBusy(false); }
  };
  // Exactly what would be shared, for the dialog's step 1.
  const draftParts = [
    ...(feedback.trim() ? [{ kind: "feedback", body: feedback.trim() }] : []),
    ...objectives.filter(o => o.title.trim() || o.body.trim()).map(o => ({ kind: "objective", title: o.title.trim() || null, body: o.body.trim() || o.title.trim() })),
    ...(notes.trim() ? [{ kind: "note", body: notes.trim() }] : []),
  ];

  return (
    <div className="rounded-2xl border-2 border-primary/40 bg-card p-4 space-y-5">
      <div>
        <h4 className="text-xl font-bold">{hideNotes ? "Feedback or objectives, by hand" : "Write it up"}</h4>
        <p className="text-base text-muted-foreground mt-0.5">Fill in what applies — it saves as one write-up, and shares as one.</p>
      </div>
      <div className="space-y-2">
        <label className="text-lg font-bold flex items-center gap-2"><MessageSquare className="w-5 h-5 text-primary" /> Feedback</label>
        <p className="text-sm text-muted-foreground -mt-1">What is working well, and where we can improve.</p>
        <textarea value={feedback} onChange={e => setFeedback(e.target.value)} rows={4} className={box} />
      </div>
      <div className="space-y-2">
        <label className="text-lg font-bold flex items-center gap-2"><Target className="w-5 h-5 text-primary" /> Objectives</label>
        <p className="text-sm text-muted-foreground -mt-1">What they're working towards. These show under "What we agreed" until the next review replaces them.</p>
        {objectives.map((o, i) => (
          <div key={i} className="rounded-2xl border-2 border-border p-3 space-y-2">
            <div className="flex items-start gap-2">
              <input value={o.title} placeholder={i === 0 ? "Title — e.g. Increase in output speed" : "Title"}
                onChange={e => setObjectives(prev => prev.map((v, j) => (j === i ? { ...v, title: e.target.value } : v)))}
                className="flex-1 min-w-0 h-12 px-4 rounded-xl border-2 border-border bg-background text-lg font-bold focus:outline-none focus:ring-2 focus:ring-primary/30" />
              {objectives.length > 1 && (
                <button type="button" aria-label="Remove this objective" onClick={() => setObjectives(prev => prev.filter((_, j) => j !== i))}
                  className="p-3 text-muted-foreground hover:text-destructive"><Trash2 className="w-5 h-5" /></button>
              )}
            </div>
            <textarea value={o.body} rows={2} className={box} placeholder="What it means in practice, and how we'll know it's happening"
              onChange={e => setObjectives(prev => prev.map((v, j) => (j === i ? { ...v, body: e.target.value } : v)))} />
            <label className="block space-y-1">
              <span className="text-sm font-bold">Due by (optional)</span>
              <input type="date" value={o.dueDate}
                onChange={e => setObjectives(prev => prev.map((v, j) => (j === i ? { ...v, dueDate: e.target.value } : v)))}
                className="w-full h-12 px-4 rounded-xl border-2 border-border bg-background text-base font-bold" />
            </label>
          </div>
        ))}
        <button type="button" onClick={() => setObjectives(prev => [...prev, { title: "", body: "", dueDate: "" }])}
          className="h-11 text-base font-semibold text-primary hover:underline flex items-center gap-1.5">
          <Plus className="w-4 h-4" /> Add another objective
        </button>
      </div>
      {!hideNotes && (
        <div className="space-y-2">
          <label className="text-lg font-bold flex items-center gap-2"><MessageSquare className="w-5 h-5 text-muted-foreground" /> Notes</label>
          <p className="text-sm text-muted-foreground -mt-1">Anything else worth recording.</p>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} className={box} />
        </div>
      )}
      <p className="text-base text-muted-foreground flex items-start gap-2">
        <Lock className="w-4 h-4 shrink-0 mt-1" /> It saves private to you. Share it — with HR or with {first} — whenever you're ready.
      </p>
      {/* In a People modal this sits in the pinned footer, always in view. */}
      <PinnedFooter>
        <div className="space-y-2" data-testid="footer-by-hand">
          {hasSomething && (
            <p className="text-base font-bold text-amber-800 dark:text-amber-300 flex items-center gap-2" role="status">
              <span className="w-2 h-2 rounded-full bg-amber-500" aria-hidden /> Not saved yet
            </p>
          )}
          <div className="grid gap-2 grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <button type="button" onClick={() => void save()} disabled={!hasSomething || busy} className={pinnedPrimaryClass}>
              {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Lock className="w-5 h-5" />} Save — private to you
            </button>
            <button type="button" onClick={onCancel} disabled={busy}
              className="min-h-14 rounded-2xl border-2 border-border text-lg font-bold flex items-center justify-center gap-2 disabled:opacity-50">
              <X className="w-5 h-5" /> Cancel
            </button>
          </div>
          <ShareButton onClick={() => setSharing(true)} disabled={!hasSomething || busy} label="Save and share…" />
        </div>
      </PinnedFooter>
      {sharing && (
        <ShareDialog heading="Save and share this write-up" parts={draftParts} colleagueName={personName}
          current="private" allow={["hr", "colleague"]}
          onConfirm={async (level, ids) => { await post(level, ids); saved(level); }}
          onClose={() => setSharing(false)} />
      )}
    </div>
  );
}

/** Share everything YOU wrote on a review in one act (the server never
 *  publishes anyone else's private note). A quiet "Share write-up…" button;
 *  the dialog shows every part in full and asks twice before it reaches the
 *  colleague (Graeme, 2026-10-14). Also shares it with HR only. */
export function ShareWriteUp({ entryId, personName, parts, onChanged }: {
  entryId: number; personName: string;
  /** Your own parts that aren't shared with the colleague yet — what goes. */
  parts: readonly ReviewNote[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const first = personName.split(" ")[0];
  return (
    <>
      <ShareButton onClick={() => setOpen(true)} label={`Share with ${first} or HR…`} />
      {open && (
        <ShareDialog heading="Share this write-up" parts={parts} colleagueName={personName}
          current="private" allow={["hr", "colleague"]}
          onConfirm={async (level, ids) => {
            const r = await recordSend<{ shared: number }>("POST", `/entries/${entryId}/share-write-up`,
              level === "hr" ? { to: "hr", userIds: ids } : { to: "colleague" });
            toast({ title: r.shared > 0 ? (level === "hr" ? "Shared with HR" : `Shared with ${first}`) : "Nothing left to share" });
            onChanged();
          }}
          onClose={() => setOpen(false)} />
      )}
    </>
  );
}

/** A meeting's write-up on its timeline card: the meeting's own notes first,
 *  then its parts (whatHappened — one write-up, nothing dropped), "Add
 *  meeting notes" (opens the meeting, the ONE place notes are added) and
 *  "Share with <name>" for your own private parts. */
export function WriteUpSection({ entry, viewerId, canWrite, personName, onChanged, onAdd }: {
  entry: Pick<RecordEntry, "id" | "meetingStatus" | "writeUp" | "notes">;
  viewerId: number | null;
  canWrite: boolean;
  personName: string;
  onChanged: () => void;
  /** Opens the meeting to add notes there; without it, the by-hand composer opens here. */
  onAdd?: () => void;
}) {
  const [writing, setWriting] = useState(false);
  const { recordNotes, parts: notes } = whatHappened(entry);
  const myUnshared = notes.filter(n => n.visibility !== "shared" && n.authorId === viewerId);
  return (
    <div className="space-y-3">
      {recordNotes && (
        <div className="rounded-2xl border-2 border-dashed border-muted-foreground/40 bg-card p-4">
          <span className="inline-flex items-center gap-1 text-sm font-bold uppercase tracking-wide text-muted-foreground mb-1">
            <Lock className="w-3.5 h-3.5" /> Notes · People access only
          </span>
          <p className="text-lg leading-relaxed whitespace-pre-wrap break-words line-clamp-6">{recordNotes}</p>
        </div>
      )}
      {notes.length > 0 && (
        <div className="space-y-3 pl-3 border-l-4 border-secondary">
          {notes.map(n => (
            <ReviewNoteCard key={n.id} note={n} viewerId={viewerId} canWrite={canWrite} personName={personName} onChanged={onChanged} inReport />
          ))}
        </div>
      )}
      {canWrite && entry.meetingStatus !== "cancelled" && !writing && (
        <button type="button" onClick={() => (onAdd ? onAdd() : setWriting(true))}
          className="w-full h-14 rounded-2xl border-2 border-dashed border-border text-lg font-bold flex items-center justify-center gap-2 text-muted-foreground hover:text-foreground hover:bg-secondary/50">
          {onAdd ? <Sparkles className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
          {onAdd ? (recordNotes || notes.length ? "Open to add more" : "Add meeting notes") : notes.length ? "Add to the write-up" : "Write it up"}
        </button>
      )}
      {writing && (
        <WriteUpComposer entryId={entry.id} personName={personName}
          onDone={() => { setWriting(false); onChanged(); }} onCancel={() => setWriting(false)} />
      )}
      {canWrite && !writing && myUnshared.length > 0 && (
        <div className="flex justify-end"><ShareWriteUp entryId={entry.id} personName={personName} parts={myUnshared} onChanged={onChanged} /></div>
      )}
    </div>
  );
}

// ── The review on the person record's timeline ─────────────────────────────

/** One review (or any record entry) on the timeline: what it's classified
 *  as, when, its status, and its write-up nested underneath. "Open" edits
 *  everything about it — classification, date, time, status, the rest. */
export function ReviewTimelineCard({ entry, classifications, stages, viewerId, canWrite, personName, onOpen, onChanged }: {
  entry: RecordEntry;
  classifications: Classification[];
  stages: Stage[];
  viewerId: number | null;
  canWrite: boolean;
  personName: string;
  onOpen: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  // Every classification ticked (0184), each its own chip.
  const labels = entryClassLabels(entry, classifications);
  const label = labels.join(" + ") || "Record";
  const level = entryLevel(entry, classifications, stages);
  const status = entry.meetingStatus;
  const setStatus = async (next: "held" | "cancelled") => {
    setBusy(true);
    try { await recordSend("PATCH", `/entries/${entry.id}`, { meetingStatus: next }); onChanged(); }
    catch (e) { toast({ title: "Couldn't save", description: e instanceof Error ? e.message : "Try again", variant: "destructive" }); }
    finally { setBusy(false); }
  };

  return (
    <div className={cn("rounded-2xl border-2 bg-card p-4 space-y-3",
      status === "booked" ? "border-primary/40" : level === "formal" ? "border-rose-300 dark:border-rose-800" : "border-border",
      status === "cancelled" && "opacity-60")}>
      <button type="button" onClick={onOpen} className="w-full text-left flex items-start gap-3 group">
        <CalendarDays className="w-6 h-6 text-primary shrink-0 mt-0.5" />
        <span className="flex-1 min-w-0">
          <span className="flex flex-wrap gap-2 mb-1">
            {(labels.length ? labels : [label]).map(l => (
              <span key={l} className="text-sm font-bold px-2.5 py-1 rounded-lg bg-violet-100 text-violet-900 dark:bg-violet-950/50 dark:text-violet-200">{l}</span>
            ))}
            {status && (
              <span className={cn("text-sm font-bold px-2.5 py-1 rounded-lg",
                status === "booked" ? "bg-sky-100 text-sky-900 dark:bg-sky-950/50 dark:text-sky-200"
                  : status === "held" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
                  : "bg-secondary text-muted-foreground")}>
                {MEETING_STATUS_LABEL[status]}
              </span>
            )}
            {level !== "none" && (
              <span className={cn("text-sm font-bold px-2.5 py-1 rounded-lg", level === "formal"
                ? "bg-rose-100 text-rose-900 dark:bg-rose-950/50 dark:text-rose-200" : "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200")}>
                {entryHeadline(entry, classifications, stages)}
              </span>
            )}
          </span>
          <span className="block text-xl font-bold leading-snug">{entry.title || (status ? "Meeting" : label)}</span>
          <span className="block text-base text-muted-foreground mt-0.5">
            {fmtDayIso(entry.meetingDate ?? entry.entryDate)}{entry.meetingTime ? ` at ${entry.meetingTime}` : ""}
            {entry.meetingType ? ` · ${MEETING_TYPE_LABEL[entry.meetingType]}` : ""}
            {entry.createdByName ? ` · by ${entry.createdByName}` : ""}
          </span>
        </span>
        <span className="shrink-0 h-11 px-3 rounded-xl border-2 border-border text-sm font-bold flex items-center gap-1 group-hover:bg-secondary/50">
          {canWrite ? "Open & edit" : "Open"} <ChevronRight className="w-4 h-4" />
        </span>
      </button>

      {canWrite && status === "booked" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <button type="button" disabled={busy} onClick={() => void setStatus("held")}
            className="h-14 rounded-2xl bg-emerald-600 text-white text-lg font-bold flex items-center justify-center gap-2 disabled:opacity-50">
            {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />} Mark as held
          </button>
          <button type="button" disabled={busy} onClick={() => void setStatus("cancelled")}
            className="h-14 rounded-2xl border-2 border-border text-lg font-bold flex items-center justify-center gap-2 hover:bg-secondary/50 disabled:opacity-50">
            <X className="w-5 h-5" /> Cancel it
          </button>
        </div>
      )}

      <WriteUpSection entry={entry} viewerId={viewerId} canWrite={canWrite} personName={personName} onChanged={onChanged} onAdd={onOpen} />
    </div>
  );
}
