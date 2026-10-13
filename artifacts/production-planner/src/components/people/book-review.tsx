/**
 * "Schedule a meeting" — THE one way to put something on someone's
 * employment record.
 *
 * Graeme, 2026-10-12: "What I really want to be able to do is to schedule a
 * meeting. I can give it a title. I don't need to put lots of information in
 * there at the time… Remove anything that we don't need, and maybe just have
 * the option to add certain things."
 *
 * So the form is: a title (optional — the AI names it from the notes later),
 * the day and the time. That's it. What it's about (the classification),
 * "already held / no meeting" and "put them in review" sit under More
 * options for the times they're truly needed. A meeting with no
 * classification picked starts as the one flagged for meetings (data —
 * defaultMeetingClassification), and the AI suggests a better one from the
 * notes. Everything can be changed afterwards in the meeting itself.
 *
 * Booking still puts the same discreet to-do on the booker's list ("HR
 * meeting at 10:30 — tap here"), made on the server.
 */
import { useState } from "react";
import { CalendarDays, ChevronDown } from "lucide-react";
import {
  sortClassifications, evidenceLine, startingMeetingStatus, fmtDayIso, defaultMeetingClassification, entryClassification,
  ANSWERS_TRIGGER_LABEL, type AnswersTrigger, type MeetingStatus,
} from "@workspace/people-reviews";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { FieldLabel } from "./review-fields";
import { ClassTicks } from "./class-ticks";
import { recordSend, type PersonRecordEntries } from "./reviews-api";
import { PinnedFooter, pinnedPrimaryClass } from "@/components/ui/pinned-save-bar";

type When = "booked" | "held" | "none";

export function BookReviewForm({ data, onCreated, onCancel, answersTrigger = null }: {
  data: PersonRecordEntries;
  /** Booked from a trigger banner: the review answers that trigger (0183). */
  answersTrigger?: AnswersTrigger | null;
  onCreated: (id: number) => void;
  onCancel: () => void;
}) {
  const classifications = sortClassifications(data.classifications).filter(c => c.active);
  const fallback = defaultMeetingClassification(classifications);
  // Ticked classifications (0184); none ticked yet = the meetings default.
  const [picked, setPicked] = useState<number[] | null>(null);
  const [date, setDate] = useState(data.today);
  const [time, setTime] = useState("");
  const [when, setWhen] = useState<When>("booked");
  const [title, setTitle] = useState("");
  const [inReview, setInReview] = useState(false);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const classIds = picked ?? (fallback ? [fallback.id] : []);
  const classificationId = classIds[0] ?? null;
  const cls = classificationId != null ? entryClassification({ classificationId, classificationIds: classIds }, classifications) : undefined;
  const evidence = picked != null ? evidenceLine(cls?.evidence ?? null, data.attendance) : null;
  const first = data.person.name.split(" ")[0];
  // A booked meeting on a day that's already gone is saved as held.
  const status: MeetingStatus | null = when === "none" ? null : startingMeetingStatus(date || null, data.today, when === "held");

  const submit = async () => {
    if (!classificationId || !date) return;
    setBusy(true);
    try {
      const r = await recordSend<{ id: number }>("POST", `/person/${data.person.id}/entries`, {
        classificationId, classificationIds: classIds, title: title.trim(), entryDate: date, status: inReview ? "open" : "closed",
        meetingStatus: status,
        ...(answersTrigger ? { answersTrigger } : {}),
        ...(status ? { meetingDate: date, meetingTime: time || null } : {}),
      });
      onCreated(r.id);
    } catch (e) {
      toast({ title: "Couldn't save it", description: e instanceof Error ? e.message : "Try again — nothing typed is lost", variant: "destructive" });
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-5">
      <label className="block space-y-1.5">
        <FieldLabel>Title (optional)</FieldLabel>
        <input value={title} onChange={e => setTitle(e.target.value)} maxLength={400} placeholder="e.g. Maternity planning — or leave it blank"
          className="w-full h-14 rounded-2xl border-2 border-border bg-card px-4 text-lg" />
        <span className="block text-sm text-muted-foreground">Leave it blank and the AI names it from your meeting notes. Private — {first} never sees it.</span>
      </label>

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
        <label className="block space-y-1.5">
          <FieldLabel>{when === "none" ? "Date" : "Day"}</FieldLabel>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="w-full h-14 rounded-2xl border-2 border-border bg-card px-4 text-lg font-bold" />
        </label>
        {when !== "none" && (
          <label className="block space-y-1.5">
            <FieldLabel>Time (optional)</FieldLabel>
            <input type="time" value={time} onChange={e => setTime(e.target.value)}
              className="w-full h-14 rounded-2xl border-2 border-border bg-card px-4 text-lg font-bold" />
          </label>
        )}
      </div>
      {answersTrigger && answersTrigger !== "none" && (
        <p className="rounded-2xl bg-secondary/50 p-4 text-base">
          <span className="font-bold">For the attendance trigger: </span>
          this meeting will count as the {answersTrigger === "both" ? "sickness and lates" : ANSWERS_TRIGGER_LABEL[answersTrigger].toLowerCase()} review. You can change that in the meeting under More options.
        </p>
      )}
      {when === "booked" && status === "held" && date && (
        <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">{fmtDayIso(date)} has already gone, so it'll be saved as held.</p>
      )}

      <button type="button" onClick={() => setMore(m => !m)} aria-expanded={more}
        className="w-full h-12 rounded-2xl border-2 border-dashed border-border text-base font-bold flex items-center justify-center gap-2 text-muted-foreground hover:text-foreground">
        More options <ChevronDown className={cn("w-5 h-5 transition-transform", more && "rotate-180")} />
      </button>

      {more && (
        <div className="space-y-5 rounded-3xl border-2 border-border p-4">
          <ClassTicks classifications={classifications} value={classIds} onChange={setPicked} label="What's it about?"
            hint={<>Only if you know already — otherwise it starts as {fallback ? `"${fallback.label}"` : "the first on the list"} and the AI suggests one from the notes.</>} />
          {evidence && (
            <p className={cn("rounded-2xl p-4 text-base", evidence.triggered ? "bg-rose-50 dark:bg-rose-950/30" : "bg-secondary/50")}>
              <span className="font-bold">{evidence.triggered ? "Policy trigger reached. " : "From their attendance: "}</span>{evidence.text}
            </p>
          )}

          <div className="space-y-1.5">
            <FieldLabel>The meeting</FieldLabel>
            <div className="grid gap-2 sm:grid-cols-3">
              {([
                ["booked", "Booking it", "It's coming up"],
                ["held", "Already held", "Adding notes after"],
                ["none", "No meeting", "Just for the record"],
              ] as const).map(([k, label, hint]) => (
                <button key={k} type="button" onClick={() => setWhen(k)} aria-pressed={when === k}
                  className={cn("min-h-16 rounded-2xl border-2 px-3 py-2 text-left",
                    when === k ? "border-primary bg-primary/10" : "border-border hover:bg-secondary/50")}>
                  <span className={cn("block text-lg font-bold", when === k && "text-primary")}>{label}</span>
                  <span className="block text-sm text-muted-foreground">{hint}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <FieldLabel>Put them in review?</FieldLabel>
            <button type="button" onClick={() => setInReview(o => !o)} aria-pressed={inReview}
              className={cn("w-full h-14 rounded-2xl border-2 text-lg font-bold",
                inReview ? "border-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" : "border-border")}>
              {inReview ? "Yes — open, in review (shows on their badge)" : "No"}
            </button>
          </div>
        </div>
      )}

      {/* Pinned to the bottom of the pop-up, always in view (2026-10-13). */}
      <PinnedFooter>
        <div className="grid gap-2 grid-cols-[minmax(0,2fr)_minmax(0,1fr)]" data-testid="footer-book-review">
          <button type="button" disabled={!classificationId || !date || busy} onClick={() => void submit()} className={pinnedPrimaryClass}>
            <CalendarDays className="w-6 h-6" /> {status === "booked" ? "Schedule it" : "Save it"}
          </button>
          <button type="button" onClick={onCancel} className="min-h-14 rounded-2xl border-2 border-border text-lg font-bold">Cancel</button>
        </div>
      </PinnedFooter>
      <p className="text-sm text-muted-foreground">
        {status === "booked" ? "A to-do goes on your own list for that day. " : ""}
        After the meeting, open it and tap "Add meeting notes (AI)" — paste your notes (from Wispr Flow or anywhere), check what it drafts, save.
      </p>
    </div>
  );
}
