/**
 * Reviews, probation meetings and the ongoing record of someone's time here.
 *
 * Built to the same scale as My To-dos, because it is used the same way: on
 * an iPad, standing up, glancing rather than reading. Big cards, one idea per
 * card, detail behind a tap — never a table (Graeme's standing rule for all
 * new UI, 2026-09-03).
 *
 * Two audiences in one component:
 *   • A manager picks a person, books meetings, and writes the record. Notes
 *     are PRIVATE as they are written; sharing one is a separate, deliberate
 *     tap that publishes it to the employee and tells them.
 *   • Everyone else sees their own record, shared notes only, read-only. It
 *     is a record of what was said, not a conversation.
 *
 * The server decides what a private note is and who may read it. Nothing here
 * hides rows it was sent — it is never sent them.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/auth-context";
import { groupRecordNotes, currentObjectives } from "@/lib/employee-record-grouping";
import {
  CalendarDays, ChevronLeft, ChevronRight, Eye, EyeOff, Loader2, Lock,
  MessageSquare, Pencil, Plus, Target, CheckCircle2, Trash2, Users, X, Check,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Something went wrong (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

type MeetingKind = "review" | "probation" | "one_to_one";
type NoteKind = "note" | "feedback" | "objective";

interface Meeting {
  id: number;
  kind: MeetingKind;
  title: string | null;
  scheduledFor: string | null;
  heldAt: string | null;
  status: "booked" | "held" | "cancelled";
  createdBy: number | null;
  createdByName: string | null;
}

interface Note {
  id: number;
  kind: NoteKind;
  meetingId: number | null;
  /** Bold headline above the body; objectives use it most (migration 0114). */
  title: string | null;
  body: string;
  visibility: "private" | "shared";
  sharedAt: string | null;
  dueDate: string | null;
  doneAt: string | null;
  authorId: number | null;
  authorName: string | null;
  createdAt: string;
}

interface Record_ {
  subject: { id: number; name: string; probationMonths: number | null };
  canManage: boolean;
  isOwnRecord: boolean;
  meetings: Meeting[];
  notes: Note[];
}

interface Person { id: number; name: string; role: string }

const MEETING_LABEL: Record<MeetingKind, string> = {
  review: "Review",
  probation: "Probation meeting",
  one_to_one: "1:1",
};

const NOTE_LABEL: Record<NoteKind, string> = {
  note: "Note",
  feedback: "Feedback",
  objective: "Objective",
};

const NOTE_ICON: Record<NoteKind, typeof MessageSquare> = {
  note: MessageSquare,
  feedback: MessageSquare,
  objective: Target,
};

function niceDate(iso: string | null): string {
  if (!iso) return "No date yet";
  try { return format(parseISO(iso), "EEE d MMM yyyy"); } catch { return iso; }
}

// ── The record for one person ──────────────────────────────────────────────

function RecordView({ userId, onBack }: { userId: number | "me"; onBack?: () => void }) {
  const queryClient = useQueryClient();
  const { state: authState } = useAuth();
  const currentUserId = authState.status === "authenticated" ? authState.user.id : null;
  const key = ["employee-review-record", String(userId)];
  const { data, isLoading, error } = useQuery<Record_>({
    queryKey: key,
    queryFn: () => api<Record_>(`/employee-reviews/${userId}`),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });

  const [booking, setBooking] = useState(false);
  const [writing, setWriting] = useState(false);

  if (isLoading) {
    return <div className="flex items-center justify-center py-16 text-muted-foreground gap-3 text-lg"><Loader2 className="w-6 h-6 animate-spin" /> Loading…</div>;
  }
  if (error || !data) {
    return <div className="p-5 rounded-2xl bg-destructive/10 text-destructive text-lg font-semibold">{error instanceof Error ? error.message : "Couldn't load this record."}</div>;
  }

  const { openObjectives, byMeeting, unattached } = groupRecordNotes(
    data.notes,
    new Set(data.meetings.map(m => m.id)),
  );
  // The summary carries the CURRENT objectives — the ones set at the most
  // recent meeting. Each review restates what the person is working towards,
  // so this must show the latest word rather than pile them up. The older
  // ones stay visible under their own meeting in the record below.
  const agreedNow = currentObjectives(openObjectives, data.meetings);
  const upcoming = data.meetings.filter(m => m.status === "booked");
  const past = data.meetings.filter(m => m.status !== "booked");
  const meetingCardProps = {
    canManage: data.canManage,
    currentUserId,
    subjectId: data.subject.id,
    subjectName: data.subject.name,
    onChanged: refresh,
  };

  return (
    <div className="space-y-5">
      {onBack && (
        <button onClick={onBack} className="flex items-center gap-2 px-4 h-14 rounded-2xl bg-secondary hover:bg-secondary/70 text-lg font-bold transition-colors">
          <ChevronLeft className="w-5 h-5" /> Everyone
        </button>
      )}

      <div>
        <h2 className="text-3xl font-bold leading-snug">{data.isOwnRecord ? "Your record" : data.subject.name}</h2>
        <p className="text-base text-muted-foreground mt-1">
          {data.isOwnRecord
            ? "Meetings booked with you, and anything your manager has shared."
            : "Meetings, feedback and objectives. Notes are private until you share them."}
        </p>
      </div>

      {data.canManage && (
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            onClick={() => setBooking(true)}
            className="h-16 rounded-2xl bg-primary text-primary-foreground text-xl font-bold flex items-center justify-center gap-3 hover:opacity-90 active:scale-[0.99] transition-all shadow-lg shadow-primary/20"
          >
            <CalendarDays className="w-6 h-6" /> Book a meeting
          </button>
          <button
            onClick={() => setWriting(true)}
            className="h-16 rounded-2xl border-2 border-border text-xl font-bold flex items-center justify-center gap-3 hover:bg-secondary/50 transition-colors"
          >
            <Plus className="w-6 h-6" /> Write a note
          </button>
        </div>
      )}

      {booking && (
        <BookMeeting subjectId={data.subject.id} onDone={() => { setBooking(false); refresh(); }} onCancel={() => setBooking(false)} />
      )}
      {writing && (
        <WriteNote subjectId={data.subject.id} subjectName={data.subject.name} onDone={() => { setWriting(false); refresh(); }} onCancel={() => setWriting(false)} />
      )}

      {upcoming.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-lg font-bold">Coming up</h3>
          {upcoming.map(m => (
            <MeetingCard key={m.id} meeting={m} notes={byMeeting.get(m.id) ?? []} {...meetingCardProps} />
          ))}
        </section>
      )}

      {agreedNow.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-lg font-bold flex items-center gap-2">
            <Target className="w-5 h-5 text-primary" /> What we agreed
          </h3>
          <p className="text-sm text-muted-foreground -mt-1">
            From the most recent review. They also stay on the meeting that set them.
          </p>
          {agreedNow.map(n => <AgreedObjective key={n.id} note={n} canManage={data.canManage} currentUserId={currentUserId} onChanged={refresh} />)}
        </section>
      )}

      <section className="space-y-3">
        <h3 className="text-lg font-bold">The record</h3>
        {unattached.length === 0 && past.length === 0 ? (
          <div className="text-center py-10 rounded-2xl bg-secondary/30">
            <p className="text-2xl font-bold">Nothing here yet</p>
            <p className="text-base text-muted-foreground mt-1">
              {data.canManage ? "Book a meeting or write the first note." : "Nothing has been shared with you yet."}
            </p>
          </div>
        ) : (
          <>
            {unattached.map(n => <NoteCard key={n.id} note={n} canManage={data.canManage} currentUserId={currentUserId} onChanged={refresh} />)}
            {past.map(m => (
              <MeetingCard key={m.id} meeting={m} notes={byMeeting.get(m.id) ?? []} {...meetingCardProps} />
            ))}
          </>
        )}
      </section>
    </div>
  );
}

// ── Cards ──────────────────────────────────────────────────────────────────

function MeetingCard({ meeting, notes, canManage, currentUserId, subjectId, subjectName, onChanged }: {
  meeting: Meeting;
  notes: Note[];
  canManage: boolean;
  currentUserId: number | null;
  subjectId: number;
  subjectName: string;
  onChanged: () => void;
}) {
  const [writingNote, setWritingNote] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const update = useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      api(`/employee-reviews/meetings/${meeting.id}`, { method: "PATCH", body: JSON.stringify(patch) }),
    onSuccess: onChanged,
    onError: (e: Error) => toast({ title: "Couldn't update it", description: e.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: () => api(`/employee-reviews/meetings/${meeting.id}`, { method: "DELETE" }),
    onSuccess: () => { toast({ title: "Meeting deleted", description: "Anything written up under it stays on the record." }); onChanged(); },
    onError: (e: Error) => toast({ title: "Couldn't delete it", description: e.message, variant: "destructive" }),
  });

  // Deleting mirrors the note rule: only whoever booked it. The server
  // enforces this — the button simply doesn't show for anyone else.
  const canDelete = canManage && currentUserId != null && meeting.createdBy === currentUserId;

  return (
    <div className={cn(
      "rounded-2xl border-2 bg-card p-4 space-y-3",
      meeting.status === "booked" ? "border-primary/40" : "border-border",
      meeting.status === "cancelled" && "opacity-60",
    )}>
      <div className="flex items-start gap-3">
        <CalendarDays className="w-6 h-6 text-primary shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-xl font-bold leading-snug">{meeting.title || MEETING_LABEL[meeting.kind]}</p>
          <p className="text-base text-muted-foreground mt-0.5">
            {niceDate(meeting.scheduledFor)}
            {meeting.status === "held" && " · held"}
            {meeting.status === "cancelled" && " · cancelled"}
            {meeting.createdByName && ` · booked by ${meeting.createdByName}`}
          </p>
        </div>
        {canDelete && !confirmDelete && (
          <button
            onClick={() => setConfirmDelete(true)}
            className="shrink-0 p-2.5 rounded-xl text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            title="Delete this meeting — its write-up notes stay on the record"
          >
            <Trash2 className="w-5 h-5" />
          </button>
        )}
      </div>

      {confirmDelete && (
        <div className="rounded-2xl border-2 border-destructive bg-destructive/5 p-4 space-y-3">
          <p className="text-lg font-bold">Delete this meeting?</p>
          <p className="text-base">Anything written up under it stays on the record — only the meeting itself goes.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
              className="h-14 rounded-2xl bg-destructive text-destructive-foreground text-lg font-bold flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {remove.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Trash2 className="w-5 h-5" />} Yes, delete it
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="h-14 rounded-2xl border-2 border-border text-lg font-bold flex items-center justify-center gap-2 hover:bg-secondary/50"
            >
              <X className="w-5 h-5" /> Keep it
            </button>
          </div>
        </div>
      )}

      {/* The meeting's write-up: what was said, feedback given, objectives
          set — nested with the meeting so the story reads in one place. */}
      {notes.length > 0 && (
        <div className="space-y-3 pl-3 border-l-4 border-secondary">
          {notes.map(n => <NoteCard key={n.id} note={n} canManage={canManage} currentUserId={currentUserId} onChanged={onChanged} inReport />)}
        </div>
      )}

      {canManage && meeting.status === "booked" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            onClick={() => update.mutate({ status: "held" })}
            disabled={update.isPending}
            className="h-14 rounded-2xl bg-emerald-600 text-white text-lg font-bold flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {update.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />} Mark as held
          </button>
          <button
            onClick={() => update.mutate({ status: "cancelled" })}
            disabled={update.isPending}
            className="h-14 rounded-2xl border-2 border-border text-lg font-bold flex items-center justify-center gap-2 hover:bg-secondary/50 disabled:opacity-50"
          >
            <X className="w-5 h-5" /> Cancel
          </button>
        </div>
      )}

      {canManage && meeting.status !== "cancelled" && !writingNote && (
        <button
          onClick={() => setWritingNote(true)}
          className="w-full h-14 rounded-2xl border-2 border-dashed border-border text-lg font-bold flex items-center justify-center gap-2 hover:bg-secondary/50 text-muted-foreground hover:text-foreground transition-colors"
        >
          <Plus className="w-5 h-5" /> Write this meeting up
        </button>
      )}

      {/* Publish the whole write-up in one act, rather than note by note. */}
      {canManage && !writingNote && notes.some(n => n.visibility !== "shared") && (
        <ShareWholeMeeting meetingId={meeting.id} subjectName={subjectName} onChanged={onChanged} />
      )}

      {writingNote && (
        <MeetingWriteUp
          meetingId={meeting.id}
          subjectName={subjectName}
          onDone={() => { setWritingNote(false); onChanged(); }}
          onCancel={() => setWritingNote(false)}
        />
      )}
    </div>
  );
}

/** Publish everything you wrote about a meeting in one act.
 *
 *  Only your OWN unshared notes go — the server enforces that too, because
 *  "private" has to mean private from other managers as well. */
function ShareWholeMeeting({ meetingId, subjectName, onChanged }: {
  meetingId: number; subjectName: string; onChanged: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const share = useMutation({
    mutationFn: () => api<{ shared: number }>(`/employee-reviews/meetings/${meetingId}/share`, { method: "POST" }),
    onSuccess: (r) => {
      toast({
        title: r.shared > 0 ? "Shared with them" : "Nothing left to share",
        description: r.shared > 0 ? `${subjectName} can read the whole write-up now.` : undefined,
      });
      setConfirming(false);
      onChanged();
    },
    onError: (e: Error) => toast({ title: "Couldn't share it", description: e.message, variant: "destructive" }),
  });

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="w-full h-14 rounded-2xl bg-primary text-primary-foreground text-lg font-bold flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
      >
        <Eye className="w-5 h-5" /> Share this write-up with them
      </button>
    );
  }
  return (
    <div className="rounded-2xl border-2 border-primary/40 bg-secondary/30 p-4 space-y-3">
      <p className="text-base font-semibold">
        Share the whole write-up with {subjectName}?
      </p>
      <p className="text-sm text-muted-foreground">
        They will be able to read the feedback, objectives and notes you wrote for this meeting. This can't be undone.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          onClick={() => setConfirming(false)}
          disabled={share.isPending}
          className="h-12 rounded-2xl border-2 border-border text-base font-bold disabled:opacity-50 sm:order-1"
        >
          Not yet
        </button>
        <button
          onClick={() => share.mutate()}
          disabled={share.isPending}
          className="h-12 rounded-2xl bg-primary text-primary-foreground text-base font-bold flex items-center justify-center gap-2 disabled:opacity-50 sm:order-2"
        >
          {share.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />} Share it
        </button>
      </div>
    </div>
  );
}

/**
 * An objective in the "What we agreed" summary — deliberately collapsed.
 *
 * This is a reminder of what the person is working towards, not the place to
 * act on it: the full card (edit, delete, mark done) lives under the meeting
 * that set it. No share button either — objectives come out of a meeting, and
 * a meeting is shared as one report (Graeme, 2026-09-17).
 */
function AgreedObjective({ note, canManage, currentUserId, onChanged }: {
  note: Note; canManage: boolean; currentUserId: number | null; onChanged: () => void;
}) {
  const isAuthor = currentUserId != null && note.authorId === currentUserId;
  const done = useMutation({
    mutationFn: () => api(`/employee-reviews/notes/${note.id}`, {
      method: "PATCH", body: JSON.stringify({ done: true }),
    }),
    onSuccess: onChanged,
    onError: (e: Error) => toast({ title: "Couldn't tick it off", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="rounded-2xl border-2 border-border bg-card px-4 py-3 flex items-start gap-3">
      <Target className="w-5 h-5 text-primary shrink-0 mt-1" />
      <div className="flex-1 min-w-0">
        {note.title
          ? <p className="text-lg font-bold leading-snug break-words">{note.title}</p>
          : <p className="text-lg font-bold leading-snug break-words">{note.body}</p>}
        {note.title && (
          <p className="text-base text-muted-foreground leading-relaxed whitespace-pre-wrap break-words mt-0.5">{note.body}</p>
        )}
        {note.dueDate && (
          <p className="text-sm text-muted-foreground mt-1">Due {niceDate(note.dueDate)}</p>
        )}
      </div>
      {canManage && isAuthor && (
        <button
          onClick={() => done.mutate()}
          disabled={done.isPending}
          className="shrink-0 text-sm font-semibold text-muted-foreground hover:text-emerald-600 flex items-center gap-1.5 disabled:opacity-50"
          title="Mark this objective done"
        >
          {done.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Done
        </button>
      )}
    </div>
  );
}

function NoteCard({ note, canManage, currentUserId, onChanged, inReport = false }: {
  note: Note; canManage: boolean; currentUserId: number | null; onChanged: () => void;
  /** Part of a meeting write-up. The write-up is shared as ONE report, so the
   *  per-item share/unshare controls are hidden — sharing a probation meeting
   *  a fragment at a time is what we moved away from (Graeme, 2026-09-17). */
  inReport?: boolean;
}) {
  const [confirmShare, setConfirmShare] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);
  const Icon = NOTE_ICON[note.kind];

  const update = useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      api(`/employee-reviews/notes/${note.id}`, { method: "PATCH", body: JSON.stringify(patch) }),
    onSuccess: () => { setConfirmShare(false); setEditing(false); onChanged(); },
    onError: (e: Error) => toast({ title: "Couldn't update it", description: e.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: () => api(`/employee-reviews/notes/${note.id}`, { method: "DELETE" }),
    onSuccess: () => { toast({ title: "Deleted" }); onChanged(); },
    onError: (e: Error) => toast({ title: "Couldn't delete it", description: e.message, variant: "destructive" }),
  });

  const isPrivate = note.visibility === "private";
  // The server only lets an author touch their own note; the buttons follow.
  const isAuthor = currentUserId != null && note.authorId === currentUserId;

  return (
    <div className={cn(
      "rounded-2xl border-2 bg-card p-4 space-y-3",
      isPrivate ? "border-dashed border-muted-foreground/40" : "border-border",
      note.doneAt && "opacity-70",
    )}>
      <div className="flex items-start gap-3">
        <Icon className="w-6 h-6 text-muted-foreground shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-sm font-bold uppercase tracking-wide text-muted-foreground">{NOTE_LABEL[note.kind]}</span>
            {isPrivate ? (
              <span className="inline-flex items-center gap-1 text-sm font-bold px-2.5 py-1 rounded-lg bg-secondary text-muted-foreground">
                <Lock className="w-3.5 h-3.5" /> Private to you
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-sm font-bold px-2.5 py-1 rounded-lg bg-primary/10 text-primary">
                <Eye className="w-3.5 h-3.5" /> Shared
              </span>
            )}
            {note.doneAt && (
              <span className="inline-flex items-center gap-1 text-sm font-bold px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" /> Done
              </span>
            )}
          </div>
          {editing ? (
            <div className="space-y-3 mt-1">
              <textarea
                value={draft}
                onChange={e => setDraft(e.target.value)}
                rows={5}
                autoFocus
                className="w-full px-4 py-3 rounded-2xl border-2 border-primary bg-card text-lg focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  onClick={() => update.mutate({ body: draft.trim() })}
                  disabled={update.isPending || !draft.trim()}
                  className="h-14 rounded-2xl bg-primary text-primary-foreground text-lg font-bold flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {update.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />} Save changes
                </button>
                <button
                  onClick={() => { setEditing(false); setDraft(note.body); }}
                  className="h-14 rounded-2xl border-2 border-border text-lg font-bold flex items-center justify-center gap-2 hover:bg-secondary/50"
                >
                  <X className="w-5 h-5" /> Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              {note.title && (
                <p className="text-xl font-bold leading-snug break-words">{note.title}</p>
              )}
              <p className="text-xl leading-relaxed whitespace-pre-wrap break-words">{note.body}</p>
            </div>
          )}
          <p className="text-base text-muted-foreground mt-2">
            {note.authorName ?? "Someone"} · {niceDate(note.createdAt.slice(0, 10))}
            {note.dueDate && ` · due ${niceDate(note.dueDate)}`}
          </p>
        </div>
        {isAuthor && !editing && !confirmDelete && (
          <div className="flex gap-1 shrink-0">
            <button
              onClick={() => { setDraft(note.body); setEditing(true); }}
              className="p-2.5 rounded-xl text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              title="Edit — you wrote this"
            >
              <Pencil className="w-5 h-5" />
            </button>
            <button
              onClick={() => setConfirmDelete(true)}
              className="p-2.5 rounded-xl text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              title="Delete — you wrote this"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          </div>
        )}
      </div>

      {confirmDelete && (
        <div className="rounded-2xl border-2 border-destructive bg-destructive/5 p-4 space-y-3">
          <p className="text-lg font-bold">Delete this {NOTE_LABEL[note.kind].toLowerCase()}?</p>
          <p className="text-base">
            {isPrivate ? "It's private to you — it goes without anyone else ever seeing it." : "It's shared — it disappears from their record too."}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
              className="h-14 rounded-2xl bg-destructive text-destructive-foreground text-lg font-bold flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {remove.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Trash2 className="w-5 h-5" />} Yes, delete it
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="h-14 rounded-2xl border-2 border-border text-lg font-bold flex items-center justify-center gap-2 hover:bg-secondary/50"
            >
              <X className="w-5 h-5" /> Keep it
            </button>
          </div>
        </div>
      )}

      {/* Author-only, matching the server: only whoever wrote a note can
          share, unshare, tick or change it — showing these to another
          manager would just earn them a 403. */}
      {canManage && isAuthor && !editing && (
        <div className="space-y-3">
          {note.kind === "objective" && (
            <button
              onClick={() => update.mutate({ done: !note.doneAt })}
              disabled={update.isPending}
              className="w-full h-14 rounded-2xl border-2 border-border text-lg font-bold flex items-center justify-center gap-2 hover:bg-secondary/50 disabled:opacity-50"
            >
              <CheckCircle2 className="w-5 h-5" /> {note.doneAt ? "Not done after all" : "Mark as done"}
            </button>
          )}

          {!inReport && isPrivate && !confirmShare && (
            <button
              onClick={() => setConfirmShare(true)}
              className="w-full h-14 rounded-2xl bg-primary text-primary-foreground text-lg font-bold flex items-center justify-center gap-2"
            >
              <Eye className="w-5 h-5" /> Share this with them
            </button>
          )}

          {/* Publishing is the one action here the employee sees, so it asks
              once rather than firing off a stray tap. */}
          {!inReport && isPrivate && confirmShare && (
            <div className="rounded-2xl border-2 border-primary bg-primary/5 p-4 space-y-3">
              <p className="text-lg font-bold">Share this note?</p>
              <p className="text-base">
                They'll be able to read it on their own record from now on, and they'll get a notification.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  onClick={() => update.mutate({ visibility: "shared" })}
                  disabled={update.isPending}
                  className="h-14 rounded-2xl bg-primary text-primary-foreground text-lg font-bold flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {update.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Eye className="w-5 h-5" />} Yes, share it
                </button>
                <button
                  onClick={() => setConfirmShare(false)}
                  className="h-14 rounded-2xl border-2 border-border text-lg font-bold flex items-center justify-center gap-2 hover:bg-secondary/50"
                >
                  <X className="w-5 h-5" /> Keep it private
                </button>
              </div>
            </div>
          )}

          {!inReport && !isPrivate && (
            <button
              onClick={() => update.mutate({ visibility: "private" })}
              disabled={update.isPending}
              className="w-full h-14 rounded-2xl border-2 border-border text-lg font-bold flex items-center justify-center gap-2 hover:bg-secondary/50 disabled:opacity-50"
            >
              <EyeOff className="w-5 h-5" /> Make it private again
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Composers ──────────────────────────────────────────────────────────────

function BookMeeting({ subjectId, onDone, onCancel }: { subjectId: number; onDone: () => void; onCancel: () => void }) {
  const [kind, setKind] = useState<MeetingKind>("review");
  const [date, setDate] = useState("");

  const create = useMutation({
    mutationFn: () => api(`/employee-reviews/${subjectId}/meetings`, {
      method: "POST",
      body: JSON.stringify({ kind, scheduledFor: date || undefined }),
    }),
    onSuccess: () => { toast({ title: "Booked", description: "It's on their record." }); onDone(); },
    onError: (e: Error) => toast({ title: "Couldn't book it", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="rounded-2xl border-2 border-primary bg-card p-4 space-y-4">
      <p className="text-xl font-bold">Book a meeting</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {(Object.keys(MEETING_LABEL) as MeetingKind[]).map(k => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={cn(
              "h-14 rounded-2xl border-2 text-lg font-bold transition-colors",
              kind === k ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-secondary/50",
            )}
          >
            {MEETING_LABEL[k]}
          </button>
        ))}
      </div>
      <input
        type="date"
        value={date}
        onChange={e => setDate(e.target.value)}
        className="w-full h-14 px-4 rounded-2xl border-2 border-border bg-card text-lg font-bold focus:outline-none focus:ring-2 focus:ring-primary/40"
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          onClick={() => create.mutate()}
          disabled={create.isPending || !date}
          className="h-16 rounded-2xl bg-primary text-primary-foreground text-xl font-bold flex items-center justify-center gap-3 disabled:opacity-50"
        >
          {create.isPending ? <Loader2 className="w-6 h-6 animate-spin" /> : <CalendarDays className="w-6 h-6" />} Book it
        </button>
        <button onClick={onCancel} className="h-16 rounded-2xl border-2 border-border text-xl font-bold flex items-center justify-center gap-3 hover:bg-secondary/50">
          <X className="w-6 h-6" /> Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * Write a whole meeting up in one go.
 *
 * Feedback, objectives and notes together, saved as ONE entry and shared as
 * one. Adding and publishing them one at a time turned a probation meeting
 * into a handful of disconnected fragments for the colleague to piece
 * together (Graeme, 2026-09-17).
 *
 * The order on screen is the order of the conversation: how it has been
 * going, what we agreed you will work towards, then anything else.
 */
function MeetingWriteUp({ meetingId, subjectName, onDone, onCancel }: {
  meetingId: number; subjectName: string; onDone: () => void; onCancel: () => void;
}) {
  const [feedback, setFeedback] = useState("");
  // Title + description per objective: a bold headline reads at a glance where
  // a paragraph does not, and Graeme had started faking it by putting the
  // title on the body's first line (2026-09-17).
  const [objectives, setObjectives] = useState<Array<{ title: string; body: string }>>([{ title: "", body: "" }]);
  const [notes, setNotes] = useState("");
  const [share, setShare] = useState(false);

  const cleanObjectives = objectives
    .map(o => ({ title: o.title.trim(), body: o.body.trim() }))
    .filter(o => o.body.length > 0 || o.title.length > 0)
    // A title on its own is still an objective — it becomes the body so the
    // record never holds a headline with nothing under it.
    .map(o => (o.body ? o : { title: "", body: o.title }));
  const hasSomething = feedback.trim().length > 0 || notes.trim().length > 0 || cleanObjectives.length > 0;

  const save = useMutation({
    mutationFn: () => api(`/employee-reviews/meetings/${meetingId}/write-up`, {
      method: "POST",
      body: JSON.stringify({
        feedback: feedback.trim() || undefined,
        objectives: cleanObjectives.map(o => ({ title: o.title || undefined, body: o.body })),
        notes: notes.trim() || undefined,
        share,
      }),
    }),
    onSuccess: () => {
      toast({
        title: share ? "Written up and shared" : "Written up — private to you",
        description: share
          ? `${subjectName} can read the whole meeting now.`
          : "Share the whole write-up whenever you're ready.",
      });
      onDone();
    },
    onError: (e: Error) => toast({ title: "Couldn't save the write-up", description: e.message, variant: "destructive" }),
  });

  const box = "w-full px-4 py-3 rounded-2xl border-2 border-border bg-background text-lg leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y";

  return (
    <div className="rounded-2xl border-2 border-primary/40 bg-card p-4 space-y-5">
      <div>
        <h4 className="text-xl font-bold">Write this meeting up</h4>
        <p className="text-base text-muted-foreground mt-0.5">
          Fill in what applies — it all saves as one entry, and shares as one.
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-lg font-bold flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-primary" /> Feedback
        </label>
        <p className="text-sm text-muted-foreground -mt-1">What is working well, and where we can improve.</p>
        <textarea value={feedback} onChange={e => setFeedback(e.target.value)} rows={4} className={box}
          placeholder="e.g. Speed has increased over the last 4–6 weeks — let's keep building towards the mixing prep standard." />
      </div>

      <div className="space-y-2">
        <label className="text-lg font-bold flex items-center gap-2">
          <Target className="w-5 h-5 text-primary" /> Objectives
        </label>
        <p className="text-sm text-muted-foreground -mt-1">
          What they are working towards. These show at the top of their record until the next review replaces them.
        </p>
        {objectives.map((o, i) => (
          <div key={i} className="rounded-2xl border-2 border-border p-3 space-y-2">
            <div className="flex items-start gap-2">
              <input
                value={o.title}
                onChange={e => setObjectives(prev => prev.map((v, j) => (j === i ? { ...v, title: e.target.value } : v)))}
                className="flex-1 px-4 py-2.5 rounded-xl border-2 border-border bg-background text-lg font-bold focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder={i === 0 ? "Title — e.g. Increase in output speed" : "Title"}
              />
              {objectives.length > 1 && (
                <button
                  type="button"
                  onClick={() => setObjectives(prev => prev.filter((_, j) => j !== i))}
                  className="p-2 text-muted-foreground hover:text-destructive"
                  aria-label="Remove this objective"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              )}
            </div>
            <textarea
              value={o.body}
              onChange={e => setObjectives(prev => prev.map((v, j) => (j === i ? { ...v, body: e.target.value } : v)))}
              rows={2}
              className={box}
              placeholder="What it means in practice, and how we'll know it's happening"
            />
          </div>
        ))}
        <button
          type="button"
          onClick={() => setObjectives(prev => [...prev, { title: "", body: "" }])}
          className="text-base font-semibold text-primary hover:underline flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4" /> Add another objective
        </button>
      </div>

      <div className="space-y-2">
        <label className="text-lg font-bold flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-muted-foreground" /> Notes
        </label>
        <p className="text-sm text-muted-foreground -mt-1">Anything else worth recording about the meeting.</p>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} className={box}
          placeholder="e.g. Probation passed. Fantastic reliability, no sickness." />
      </div>

      <label className="flex items-center gap-3 cursor-pointer rounded-2xl border-2 border-border px-4 py-3">
        <input type="checkbox" checked={share} onChange={e => setShare(e.target.checked)} className="w-5 h-5 rounded border-border accent-emerald-600" />
        <span className="text-base font-semibold">
          Share it with {subjectName} as I save
          <span className="block text-sm font-normal text-muted-foreground">
            Otherwise it stays private to you and you can share it later.
          </span>
        </span>
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <button
          onClick={onCancel}
          disabled={save.isPending}
          className="h-14 rounded-2xl border-2 border-border text-lg font-bold flex items-center justify-center gap-2 hover:bg-secondary/50 disabled:opacity-50 sm:order-1"
        >
          <X className="w-5 h-5" /> Cancel
        </button>
        <button
          onClick={() => save.mutate()}
          disabled={!hasSomething || save.isPending}
          className="h-14 rounded-2xl bg-primary text-primary-foreground text-lg font-bold flex items-center justify-center gap-2 disabled:opacity-50 sm:order-2"
        >
          {save.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
          {share ? "Save and share" : "Save write-up"}
        </button>
      </div>
    </div>
  );
}

function WriteNote({ subjectId, subjectName, meetingId, meetingLabel, onDone, onCancel }: {
  subjectId: number; subjectName: string;
  /** When set, the note is saved as part of this meeting's write-up. */
  meetingId?: number; meetingLabel?: string;
  onDone: () => void; onCancel: () => void;
}) {
  const [kind, setKind] = useState<NoteKind>("note");
  const [body, setBody] = useState("");
  const [dueDate, setDueDate] = useState("");
  // Private is the default and stays the default. Sharing is a deliberate
  // act, either here or later from the card.
  const [share, setShare] = useState(false);

  const create = useMutation({
    mutationFn: () => api(`/employee-reviews/${subjectId}/notes`, {
      method: "POST",
      body: JSON.stringify({
        kind,
        body: body.trim(),
        visibility: share ? "shared" : "private",
        dueDate: kind === "objective" && dueDate ? dueDate : undefined,
        meetingId: meetingId ?? undefined,
      }),
    }),
    onSuccess: () => {
      toast({
        title: share ? "Saved and shared" : "Saved — private to you",
        description: share ? `${subjectName} can see it now.` : "Share it whenever you're ready.",
      });
      onDone();
    },
    onError: (e: Error) => toast({ title: "Couldn't save it", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="rounded-2xl border-2 border-primary bg-card p-4 space-y-4">
      <p className="text-xl font-bold">{meetingId ? "Write this meeting up" : "Write a note"}</p>
      {meetingId && meetingLabel && (
        <p className="inline-flex items-center gap-2 text-base font-bold px-3 py-2 rounded-xl bg-primary/10 text-primary">
          <CalendarDays className="w-5 h-5" /> Part of: {meetingLabel}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        {(Object.keys(NOTE_LABEL) as NoteKind[]).map(k => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={cn(
              "h-14 rounded-2xl border-2 text-lg font-bold transition-colors",
              kind === k ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-secondary/50",
            )}
          >
            {NOTE_LABEL[k]}
          </button>
        ))}
      </div>

      <textarea
        value={body}
        onChange={e => setBody(e.target.value)}
        rows={6}
        autoFocus
        placeholder={kind === "objective" ? "What did you agree they'd work on?" : "What was said?"}
        className="w-full px-4 py-3 rounded-2xl border-2 border-border bg-card text-lg focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
      />

      {kind === "objective" && (
        <div>
          <label className="text-base font-bold block mb-1.5">Due by (optional)</label>
          <input
            type="date"
            value={dueDate}
            onChange={e => setDueDate(e.target.value)}
            className="w-full h-14 px-4 rounded-2xl border-2 border-border bg-card text-lg font-bold focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
      )}

      <button
        onClick={() => setShare(v => !v)}
        className={cn(
          "w-full h-16 rounded-2xl border-2 text-lg font-bold flex items-center justify-center gap-3 transition-colors",
          share ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-secondary/50",
        )}
      >
        {share ? <Eye className="w-6 h-6" /> : <Lock className="w-6 h-6" />}
        {share ? `${subjectName} will see this` : "Private to you for now"}
      </button>

      <div className="grid gap-3 sm:grid-cols-2">
        <button
          onClick={() => create.mutate()}
          disabled={create.isPending || !body.trim()}
          className="h-16 rounded-2xl bg-primary text-primary-foreground text-xl font-bold flex items-center justify-center gap-3 disabled:opacity-50"
        >
          {create.isPending ? <Loader2 className="w-6 h-6 animate-spin" /> : <Plus className="w-6 h-6" />} Save it
        </button>
        <button onClick={onCancel} className="h-16 rounded-2xl border-2 border-border text-xl font-bold flex items-center justify-center gap-3 hover:bg-secondary/50">
          <X className="w-6 h-6" /> Cancel
        </button>
      </div>
    </div>
  );
}

// ── The section as the Employee Hub renders it ─────────────────────────────

export function EmployeeReviewsSection({ isManager }: { isManager: boolean }) {
  const [openPersonId, setOpenPersonId] = useState<number | null>(null);

  const { data: people = [], isLoading } = useQuery<Person[]>({
    queryKey: ["employee-review-people"],
    queryFn: () => api<Person[]>("/employee-reviews/people"),
    enabled: isManager,
  });

  // Everyone who isn't a manager sees exactly one thing: their own record.
  if (!isManager) return <RecordView userId="me" />;

  if (openPersonId != null) {
    return <RecordView userId={openPersonId} onBack={() => setOpenPersonId(null)} />;
  }

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <h3 className="text-lg font-bold flex items-center gap-2"><Users className="w-5 h-5 text-primary" /> Whose record?</h3>
        {isLoading ? (
          <div className="flex items-center gap-3 py-8 text-muted-foreground text-lg"><Loader2 className="w-6 h-6 animate-spin" /> Loading…</div>
        ) : (
          people.map(p => (
            <button
              key={p.id}
              onClick={() => setOpenPersonId(p.id)}
              className="w-full text-left rounded-2xl border-2 border-border bg-card hover:border-primary/50 active:scale-[0.995] transition-all p-4 flex items-center gap-4"
            >
              <span className="flex-1 min-w-0">
                <span className="block text-xl font-bold leading-snug">{p.name}</span>
                <span className="block text-base text-muted-foreground capitalize">{p.role}</span>
              </span>
              <ChevronRight className="w-6 h-6 text-muted-foreground shrink-0" />
            </button>
          ))
        )}
      </section>
    </div>
  );
}
