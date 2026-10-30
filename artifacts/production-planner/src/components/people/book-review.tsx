/**
 * "Schedule a meeting" — THE one way to put a meeting on someone's
 * employment record.
 *
 * Graeme, 2026-10-30: "a very simple tool to go onto someone's record, book
 * a meeting… Generally speaking, I'm going to book it and then add the notes
 * immediately because I've just held the meeting. We can book it in advance,
 * but the default is just to do it right there and then… We've just got
 * meetings, and we put them on the calendar. We then add notes to them when
 * we do them."
 *
 * So the form is: the day (today), an optional time and title, and a box
 * for the notes.
 *   • Notes pasted → it's saved as held and opens straight on the AI's
 *     draft (title, what it's about, what was agreed, objectives, pay
 *     change, in review) to check and save — private to you.
 *   • No notes → it's just on the schedule; open it and add the notes when
 *     it's happened.
 * No classification, "held / booked / no meeting" or "in review" choices up
 * front any more — the notes decide those. The meeting starts as the
 * classification flagged for meetings (data — defaultMeetingClassification).
 * Nothing goes on a to-do list unless "Put it on my to-do list" is ticked.
 */
import { useState } from "react";
import { CalendarDays, ListTodo, Sparkles } from "lucide-react";
import {
  sortClassifications, startingMeetingStatus, fmtDayIso, defaultMeetingClassification, MAX_NOTES_CHARS,
  ANSWERS_TRIGGER_LABEL, type AnswersTrigger, type MeetingStatus,
} from "@workspace/people-reviews";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { DictateButton } from "@/components/dictate-button";
import { FieldLabel } from "./review-fields";
import { recordSend, type PersonRecordEntries } from "./reviews-api";
import { queueNotesForAI } from "./meeting-notes-ai";
import { PinnedFooter, pinnedPrimaryClass } from "@/components/ui/pinned-save-bar";

/** Enough pasted to be worth reading (the AI read needs 20 characters). */
const MIN_NOTES = 20;

export function BookReviewForm({ data, onCreated, onCancel, answersTrigger = null }: {
  data: PersonRecordEntries;
  /** Booked from a trigger banner: the review answers that trigger (0183). */
  answersTrigger?: AnswersTrigger | null;
  onCreated: (id: number) => void;
  onCancel: () => void;
}) {
  const classifications = sortClassifications(data.classifications).filter(c => c.active);
  const startAs = defaultMeetingClassification(classifications) ?? classifications[0] ?? null;
  const [date, setDate] = useState(data.today);
  const [time, setTime] = useState("");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [todo, setTodo] = useState(false);
  const [busy, setBusy] = useState(false);
  const first = data.person.name.split(" ")[0];
  const hasNotes = notes.trim().length >= MIN_NOTES;
  // Notes = it happened. Otherwise a day already gone is held, today or later is on the schedule.
  const status: MeetingStatus = hasNotes ? "held" : startingMeetingStatus(date || null, data.today);
  const offerTodo = status === "booked";

  const submit = async () => {
    if (!startAs || !date) return;
    setBusy(true);
    try {
      const r = await recordSend<{ id: number }>("POST", `/person/${data.person.id}/entries`, {
        classificationId: startAs.id, classificationIds: [startAs.id], title: title.trim(), entryDate: date, status: "closed",
        meetingStatus: status, meetingDate: date, meetingTime: time || null,
        ...(offerTodo && todo ? { meetingTodo: true } : {}),
        ...(answersTrigger ? { answersTrigger } : {}),
      });
      // The meeting opens on the AI reading these notes — nothing is lost.
      if (hasNotes) queueNotesForAI(r.id, notes.trim());
      onCreated(r.id);
    } catch (e) {
      toast({ title: "Couldn't save it", description: e instanceof Error ? e.message : "Try again — nothing typed is lost", variant: "destructive" });
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
        <label className="block space-y-1.5">
          <FieldLabel>Day</FieldLabel>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="w-full h-14 rounded-2xl border-2 border-border bg-card px-4 text-lg font-bold" />
        </label>
        <label className="block space-y-1.5">
          <FieldLabel>Time (optional)</FieldLabel>
          <input type="time" value={time} onChange={e => setTime(e.target.value)}
            className="w-full h-14 rounded-2xl border-2 border-border bg-card px-4 text-lg font-bold" />
        </label>
      </div>

      <label className="block space-y-1.5">
        <FieldLabel>Title (optional)</FieldLabel>
        <input value={title} onChange={e => setTitle(e.target.value)} maxLength={400} placeholder="Leave it blank — the AI names it from your notes"
          className="w-full h-14 rounded-2xl border-2 border-border bg-card px-4 text-lg" />
      </label>

      <div className="space-y-2">
        <FieldLabel>Meeting notes — just held it? Paste them here</FieldLabel>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={8} maxLength={MAX_NOTES_CHARS}
          placeholder="Paste your Wispr Flow notes (or dictate). Leave it empty to just put the meeting on the schedule."
          className="w-full px-4 py-3 rounded-2xl border-2 border-border bg-card text-lg leading-relaxed resize-y min-h-40" />
        <DictateButton value={notes} onChange={setNotes} context="note" size="lg" />
        <p className="text-sm text-muted-foreground">
          {hasNotes
            ? `The AI reads them next: title, what it's about, what was agreed, objectives, any pay change. You check it, then it saves — private to you until you share it with ${first} or HR.`
            : "No notes yet? It just goes on the schedule. Open it and add the notes when it's happened."}
        </p>
      </div>

      {answersTrigger && answersTrigger !== "none" && (
        <p className="rounded-2xl bg-secondary/50 p-4 text-base">
          <span className="font-bold">For the attendance trigger: </span>
          this meeting will count as the {answersTrigger === "both" ? "sickness and lates" : ANSWERS_TRIGGER_LABEL[answersTrigger].toLowerCase()} review.
        </p>
      )}

      {offerTodo && (
        <button type="button" onClick={() => setTodo(t => !t)} aria-pressed={todo}
          className={cn("w-full min-h-14 rounded-2xl border-2 px-4 py-2 text-left text-base font-bold flex items-center gap-3",
            todo ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground")}>
          <ListTodo className="w-5 h-5 shrink-0" />
          <span className="flex-1">{todo ? `On my to-do list for ${fmtDayIso(date)}` : "Put it on my to-do list too"}</span>
          <span className={cn("w-6 h-6 rounded-md border-2 shrink-0", todo ? "border-primary bg-primary" : "border-border")} aria-hidden />
        </button>
      )}

      {/* Pinned to the bottom of the pop-up, always in view (2026-10-13). */}
      <PinnedFooter>
        <div className="grid gap-2 grid-cols-[minmax(0,2fr)_minmax(0,1fr)]" data-testid="footer-book-review">
          <button type="button" disabled={!startAs || !date || busy} onClick={() => void submit()} className={pinnedPrimaryClass}>
            {hasNotes ? <Sparkles className="w-6 h-6" /> : <CalendarDays className="w-6 h-6" />}
            {hasNotes ? "Save and read the notes" : status === "booked" ? "Schedule it" : "Save it"}
          </button>
          <button type="button" onClick={onCancel} className="min-h-14 rounded-2xl border-2 border-border text-lg font-bold">Cancel</button>
        </div>
      </PinnedFooter>
    </div>
  );
}
