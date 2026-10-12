/**
 * YOUR OWN record in the Employee Hub — read-only (Graeme, 2026-09-03;
 * rebuilt 2026-10-12 on the one classified review).
 *
 * What you see: the reviews your manager has shared something from — the
 * day, and the feedback, objectives and notes they chose to share — plus
 * "What we agreed" from the latest one. Never the review's classification,
 * summary or stage: those stay on the private employment record. The server
 * (GET /api/employee-reviews/me) decides what you may read; nothing here
 * hides rows it was sent. It's a record of what was said, not a
 * conversation, so nothing here writes.
 *
 * Booking and writing reviews up happens on each person's record in People
 * (components/people-record.tsx, components/people/review-notes.tsx).
 *
 * Also home to api(): the People-section fetch that turns a timed-out
 * private PIN into a "enter your PIN" prompt instead of lost typing.
 */
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Loader2, MessageSquare, Target } from "lucide-react";
import { fmtDayIso, NOTE_KIND_LABEL, MEETING_STATUS_LABEL, type MeetingStatus, type NoteKind } from "@workspace/people-reviews";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

/** Fired when a People write is refused because the private-PIN lock shut. */
export const PEOPLE_PIN_NEEDED_EVENT = "tck:people-pin-needed";

export async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (res.status === 423 || res.status === 428) {
    // The People PIN timed out while they were working (2026-10-12). Ask for
    // it straight away (PeopleSection listens) and keep everything typed —
    // the form isn't cleared on an error, so Save just needs pressing again.
    window.dispatchEvent(new Event(PEOPLE_PIN_NEEDED_EVENT));
    throw new Error("Your private PIN timed out — nothing you've typed is lost. Enter your PIN, then press Save again.");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Something went wrong (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

interface MyNote {
  id: number;
  entryId: number | null;
  kind: NoteKind;
  title: string | null;
  body: string;
  dueDate: string | null;
  doneAt: string | null;
  authorName: string | null;
  createdAt: string;
}

interface MyRecord {
  name: string;
  reviews: Array<{ entryId: number; date: string; status: MeetingStatus | null; notes: MyNote[] }>;
  loose: MyNote[];
  agreed: MyNote[];
}

function MyNoteCard({ note }: { note: MyNote }) {
  const Icon = note.kind === "objective" ? Target : MessageSquare;
  return (
    <div className="rounded-2xl border-2 border-border bg-card p-4 flex items-start gap-3">
      <Icon className="w-6 h-6 text-muted-foreground shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold uppercase tracking-wide text-muted-foreground mb-1">
          {NOTE_KIND_LABEL[note.kind] ?? "Note"}{note.doneAt ? " · done" : ""}
        </p>
        {note.title && <p className="text-xl font-bold leading-snug break-words">{note.title}</p>}
        <p className="text-xl leading-relaxed whitespace-pre-wrap break-words">{note.body}</p>
        <p className="text-base text-muted-foreground mt-2">
          {note.authorName ?? "Your manager"} · {fmtDayIso(note.createdAt.slice(0, 10))}{note.dueDate ? ` · due ${fmtDayIso(note.dueDate)}` : ""}
        </p>
      </div>
    </div>
  );
}

export function EmployeeReviewsSection() {
  const { data, isLoading, error } = useQuery<MyRecord>({
    queryKey: ["employee-review-record", "me"],
    queryFn: () => api<MyRecord>("/employee-reviews/me"),
  });

  if (isLoading) {
    return <div className="flex items-center justify-center py-16 text-muted-foreground gap-3 text-lg"><Loader2 className="w-6 h-6 animate-spin" /> Loading…</div>;
  }
  if (error || !data) {
    return <div className="p-5 rounded-2xl bg-destructive/10 text-destructive text-lg font-semibold">{error instanceof Error ? error.message : "Couldn't load your record."}</div>;
  }
  const empty = data.reviews.length === 0 && data.loose.length === 0;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-3xl font-bold leading-snug">Your record</h2>
        <p className="text-base text-muted-foreground mt-1">Feedback, objectives and notes your manager has shared with you from your reviews.</p>
      </div>

      {data.agreed.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-lg font-bold flex items-center gap-2"><Target className="w-5 h-5 text-primary" /> What we agreed</h3>
          <p className="text-sm text-muted-foreground -mt-1">From your most recent review. They also stay on the review that set them.</p>
          {data.agreed.map(n => (
            <div key={n.id} className="rounded-2xl border-2 border-border bg-card px-4 py-3 flex items-start gap-3">
              <Target className="w-5 h-5 text-primary shrink-0 mt-1" />
              <div className="flex-1 min-w-0">
                <p className="text-lg font-bold leading-snug break-words">{n.title ?? n.body}</p>
                {n.title && <p className="text-base text-muted-foreground whitespace-pre-wrap break-words mt-0.5">{n.body}</p>}
                {n.dueDate && <p className="text-sm text-muted-foreground mt-1">Due {fmtDayIso(n.dueDate)}</p>}
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="space-y-3">
        <h3 className="text-lg font-bold">Your reviews</h3>
        {empty ? (
          <div className="text-center py-10 rounded-2xl bg-secondary/30">
            <p className="text-2xl font-bold">Nothing here yet</p>
            <p className="text-base text-muted-foreground mt-1">Nothing has been shared with you yet.</p>
          </div>
        ) : (
          <>
            {data.reviews.map(r => (
              <div key={r.entryId} className="rounded-2xl border-2 border-border bg-card p-4 space-y-3">
                <p className="text-xl font-bold flex items-center gap-2">
                  <CalendarDays className="w-6 h-6 text-primary shrink-0" /> Review — {fmtDayIso(r.date)}
                  {r.status === "booked" && <span className="text-sm font-bold px-2.5 py-1 rounded-lg bg-sky-100 text-sky-900 dark:bg-sky-950/50 dark:text-sky-200">{MEETING_STATUS_LABEL.booked}</span>}
                </p>
                <div className="space-y-3 pl-3 border-l-4 border-secondary">
                  {r.notes.map(n => <MyNoteCard key={n.id} note={n} />)}
                </div>
              </div>
            ))}
            {data.loose.map(n => <MyNoteCard key={n.id} note={n} />)}
          </>
        )}
      </section>
    </div>
  );
}
