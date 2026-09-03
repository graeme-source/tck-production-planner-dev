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
import {
  CalendarDays, ChevronLeft, ChevronRight, Eye, EyeOff, Loader2, Lock,
  MessageSquare, Plus, Target, CheckCircle2, Users, X,
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
  createdByName: string | null;
}

interface Note {
  id: number;
  kind: NoteKind;
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

  const openObjectives = data.notes.filter(n => n.kind === "objective" && !n.doneAt);
  const diary = data.notes.filter(n => n.kind !== "objective" || n.doneAt);
  const upcoming = data.meetings.filter(m => m.status === "booked");
  const past = data.meetings.filter(m => m.status !== "booked");

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
          {upcoming.map(m => <MeetingCard key={m.id} meeting={m} canManage={data.canManage} onChanged={refresh} />)}
        </section>
      )}

      {openObjectives.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-lg font-bold flex items-center gap-2"><Target className="w-5 h-5 text-primary" /> What we agreed</h3>
          {openObjectives.map(n => <NoteCard key={n.id} note={n} canManage={data.canManage} onChanged={refresh} />)}
        </section>
      )}

      <section className="space-y-3">
        <h3 className="text-lg font-bold">The record</h3>
        {diary.length === 0 && past.length === 0 ? (
          <div className="text-center py-10 rounded-2xl bg-secondary/30">
            <p className="text-2xl font-bold">Nothing here yet</p>
            <p className="text-base text-muted-foreground mt-1">
              {data.canManage ? "Book a meeting or write the first note." : "Nothing has been shared with you yet."}
            </p>
          </div>
        ) : (
          <>
            {diary.map(n => <NoteCard key={n.id} note={n} canManage={data.canManage} onChanged={refresh} />)}
            {past.map(m => <MeetingCard key={m.id} meeting={m} canManage={data.canManage} onChanged={refresh} />)}
          </>
        )}
      </section>
    </div>
  );
}

// ── Cards ──────────────────────────────────────────────────────────────────

function MeetingCard({ meeting, canManage, onChanged }: { meeting: Meeting; canManage: boolean; onChanged: () => void }) {
  const update = useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      api(`/employee-reviews/meetings/${meeting.id}`, { method: "PATCH", body: JSON.stringify(patch) }),
    onSuccess: onChanged,
    onError: (e: Error) => toast({ title: "Couldn't update it", description: e.message, variant: "destructive" }),
  });

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
      </div>
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
    </div>
  );
}

function NoteCard({ note, canManage, onChanged }: { note: Note; canManage: boolean; onChanged: () => void }) {
  const [confirmShare, setConfirmShare] = useState(false);
  const Icon = NOTE_ICON[note.kind];

  const update = useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      api(`/employee-reviews/notes/${note.id}`, { method: "PATCH", body: JSON.stringify(patch) }),
    onSuccess: () => { setConfirmShare(false); onChanged(); },
    onError: (e: Error) => toast({ title: "Couldn't update it", description: e.message, variant: "destructive" }),
  });

  const isPrivate = note.visibility === "private";

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
          <p className="text-xl leading-relaxed whitespace-pre-wrap break-words">{note.body}</p>
          <p className="text-base text-muted-foreground mt-2">
            {note.authorName ?? "Someone"} · {niceDate(note.createdAt.slice(0, 10))}
            {note.dueDate && ` · due ${niceDate(note.dueDate)}`}
          </p>
        </div>
      </div>

      {canManage && (
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

          {isPrivate && !confirmShare && (
            <button
              onClick={() => setConfirmShare(true)}
              className="w-full h-14 rounded-2xl bg-primary text-primary-foreground text-lg font-bold flex items-center justify-center gap-2"
            >
              <Eye className="w-5 h-5" /> Share this with them
            </button>
          )}

          {/* Publishing is the one action here the employee sees, so it asks
              once rather than firing off a stray tap. */}
          {isPrivate && confirmShare && (
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

          {!isPrivate && (
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

function WriteNote({ subjectId, subjectName, onDone, onCancel }: {
  subjectId: number; subjectName: string; onDone: () => void; onCancel: () => void;
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
      <p className="text-xl font-bold">Write a note</p>
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
