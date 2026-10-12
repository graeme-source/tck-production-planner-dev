/**
 * "Book a review" — THE one way to put something on someone's employment
 * record (Graeme, 2026-10-12: "we just have one review that we then
 * classify, rather than different types of reviews").
 *
 * Pick what it's about (the classification — Performance appraisal,
 * Probation review, 1:1, Disciplinary, Attendance… an editable list), the
 * day and time, and whether it's booked, already held, or just a record with
 * no meeting. Everything — the classification included — can be changed
 * afterwards in the review itself, which opens straight after with every
 * field autosaving.
 */
import { useState } from "react";
import { CalendarDays } from "lucide-react";
import {
  sortClassifications, evidenceLine, startingMeetingStatus, fmtDayIso, type MeetingStatus,
} from "@workspace/people-reviews";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { FieldLabel, PillButton } from "./review-fields";
import { recordSend, type PersonRecordEntries } from "./reviews-api";

type When = "booked" | "held" | "none";

export function BookReviewForm({ data, onCreated, onCancel }: {
  data: PersonRecordEntries;
  onCreated: (id: number) => void;
  onCancel: () => void;
}) {
  const classifications = sortClassifications(data.classifications).filter(c => c.active);
  const [classificationId, setClassificationId] = useState<number | null>(null);
  const [date, setDate] = useState(data.today);
  const [time, setTime] = useState("");
  const [when, setWhen] = useState<When>("booked");
  const [title, setTitle] = useState("");
  const [inReview, setInReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const cls = classifications.find(c => c.id === classificationId);
  const evidence = evidenceLine(cls?.evidence ?? null, data.attendance);
  const first = data.person.name.split(" ")[0];
  // A booked review on a day that's already gone is saved as held.
  const status: MeetingStatus | null = when === "none" ? null : startingMeetingStatus(date || null, data.today, when === "held");

  const submit = async () => {
    if (!classificationId || !date) return;
    setBusy(true);
    try {
      const r = await recordSend<{ id: number }>("POST", `/person/${data.person.id}/entries`, {
        classificationId, title, entryDate: date, status: inReview ? "open" : "closed",
        meetingStatus: status,
        ...(status ? { meetingDate: date, meetingTime: time || null } : {}),
      });
      onCreated(r.id);
    } catch (e) {
      toast({ title: "Couldn't save it", description: e instanceof Error ? e.message : "Try again — nothing typed is lost", variant: "destructive" });
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <FieldLabel>What's it about?</FieldLabel>
        <p className="text-sm text-muted-foreground">You can change this at any time afterwards.</p>
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

      <div className="space-y-1.5">
        <FieldLabel>The meeting</FieldLabel>
        <div className="grid gap-2 sm:grid-cols-3">
          {([
            ["booked", "Booking it", "It's coming up"],
            ["held", "Already held", "Writing it up after"],
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

      <div className="grid gap-4 sm:grid-cols-2">
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
      {when === "booked" && status === "held" && date && (
        <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">{fmtDayIso(date)} has already gone, so it'll be saved as held.</p>
      )}

      <label className="block space-y-1.5">
        <FieldLabel>Summary (optional)</FieldLabel>
        <input value={title} onChange={e => setTitle(e.target.value)} maxLength={400} placeholder="e.g. Three-month check-in"
          className="w-full h-14 rounded-2xl border-2 border-border bg-card px-4 text-lg" />
        <span className="block text-sm text-muted-foreground">Private — {first} never sees the summary or the classification, only what you choose to share from the write-up.</span>
      </label>

      <div className="space-y-1.5">
        <FieldLabel>Put them in review?</FieldLabel>
        <button type="button" onClick={() => setInReview(o => !o)} aria-pressed={inReview}
          className={cn("w-full h-14 rounded-2xl border-2 text-lg font-bold",
            inReview ? "border-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" : "border-border")}>
          {inReview ? "Yes — open, in review (shows on their badge)" : "No"}
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <button type="button" disabled={!classificationId || !date || busy} onClick={() => void submit()}
          className="h-16 rounded-2xl bg-primary text-primary-foreground text-xl font-bold flex items-center justify-center gap-2 disabled:opacity-50">
          <CalendarDays className="w-6 h-6" /> {when === "booked" && status === "booked" ? "Book it" : "Save it"}
        </button>
        <button type="button" onClick={onCancel} className="h-16 rounded-2xl border-2 border-border text-xl font-bold">Cancel</button>
      </div>
      <p className="text-sm text-muted-foreground">
        It opens straight away to write it up, add stage and warnings, letters and the rest. Everything saves as you go.
        {when === "booked" ? " Booking puts a to-do on your own list for that day." : ""}
      </p>
    </div>
  );
}
