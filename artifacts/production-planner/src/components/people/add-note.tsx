/**
 * "Add a note" — a note or observation straight onto someone's record, not
 * part of any meeting (Graeme, 2026-10-14: "I need to be able to just put
 * notes, observations, stuff like that, privately, and choose to publish
 * them if I wish"). Objective H.
 *
 *   • Private to whoever wrote it until shared. "Save — private to you" is
 *     the main button; "Save and share with <name>" saves and shares in one
 *     go (an in-app notification, nothing emailed).
 *   • Dated today unless it's an observation from an earlier day.
 *   • It then sits in The record (All, Notes) as a loose note, with its own
 *     Share / edit / remove — the same card as every other note.
 *   • Closing with something typed asks Save / Discard / Keep editing, so
 *     nothing written is lost by a stray tap outside.
 *
 * Server: POST /api/people-reviews/person/:userId/notes
 * (routes/people-review-notes.ts — People PIN, founder or People access,
 * never your own record, audited).
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Eye, Loader2, Lock } from "lucide-react";
import { looseNoteCanSave, LOOSE_NOTE_BODY_MAX, LOOSE_NOTE_TITLE_MAX, fmtDayIso } from "@workspace/people-reviews";
import { toast } from "@/hooks/use-toast";
import { DictateButton } from "@/components/dictate-button";
import { PinnedFooter, pinnedPrimaryClass } from "@/components/ui/pinned-save-bar";
import { usePeopleModalCloseGuard } from "@/components/people-modal";
import { FieldLabel } from "./review-fields";
import { recordSend, type ReviewNote } from "./reviews-api";

type Visibility = "private" | "shared";

export function AddNoteForm({ userId, personName, today, onSaved, onCancel }: {
  userId: number;
  personName: string;
  /** London today, from the record (YYYY-MM-DD). */
  today: string;
  onSaved: (note: ReviewNote) => void;
  onCancel: () => void;
}) {
  const first = personName.split(" ")[0] || personName;
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [date, setDate] = useState(today);
  const [sharing, setSharing] = useState(false);

  const save = useMutation({
    mutationFn: (visibility: Visibility) => recordSend<ReviewNote>("POST", `/person/${userId}/notes`, {
      title: title.trim() || null,
      body,
      noteDate: date && date !== today ? date : null,
      visibility,
    }),
    onSuccess: (note, visibility) => {
      toast({ title: visibility === "shared" ? `Saved and shared with ${first}` : "Saved — private to you" });
      onSaved(note);
    },
    onError: e => toast({ title: "Couldn't save the note", description: e instanceof Error ? e.message : "Try again — what you typed is still here", variant: "destructive" }),
  });

  const dateOk = date !== "" && date <= today;
  const canSave = looseNoteCanSave(body) && dateOk && !save.isPending;
  const dirty = body.trim() !== "" || title.trim() !== "";

  usePeopleModalCloseGuard(dirty && !save.isSuccess ? {
    title: "This note isn't saved",
    description: `Save it to ${first}'s record — private to you — or throw it away?`,
    saveLabel: "Save — private to you",
    onSave: async () => {
      if (!canSave) return false;
      try { await save.mutateAsync("private"); return true; } catch { return false; }
    },
    onDiscard: () => {},
  } : null);

  return (
    <div className="space-y-5">
      <p className="rounded-2xl bg-secondary/50 px-4 py-3 text-base flex items-start gap-2">
        <Lock className="w-5 h-5 shrink-0 mt-0.5" />
        <span>Private to you until you share it. Nobody else sees it — not {first}, not other managers.</span>
      </p>

      <label className="block space-y-1.5">
        <FieldLabel>The note</FieldLabel>
        <textarea value={body} onChange={e => setBody(e.target.value)} rows={7} maxLength={LOOSE_NOTE_BODY_MAX} autoFocus
          placeholder="What you noticed, what was said, anything worth keeping…"
          className="w-full rounded-2xl border-2 border-border bg-card px-4 py-3 text-lg leading-relaxed" />
      </label>
      <DictateButton value={body} onChange={setBody} context="note" size="lg" />

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <label className="block space-y-1.5">
          <FieldLabel>Headline (optional)</FieldLabel>
          <input value={title} onChange={e => setTitle(e.target.value)} maxLength={LOOSE_NOTE_TITLE_MAX}
            placeholder="e.g. Great help with the new starter"
            className="w-full h-14 rounded-2xl border-2 border-border bg-card px-4 text-lg" />
        </label>
        <label className="block space-y-1.5">
          <FieldLabel>Date</FieldLabel>
          <input type="date" value={date} max={today} onChange={e => setDate(e.target.value)}
            className="w-full h-14 rounded-2xl border-2 border-border bg-card px-4 text-lg font-bold" />
        </label>
      </div>
      {!dateOk && <p className="text-base font-semibold text-destructive">Pick today or an earlier day.</p>}
      {dateOk && date !== today && <p className="text-sm text-muted-foreground">It'll sit on the record on {fmtDayIso(date)}.</p>}

      {/* Pinned to the bottom of the pop-up, always in view. Sharing asks
          first, right there in the bar, as sharing a note later does. */}
      <PinnedFooter>
        {sharing ? (
          <div className="space-y-2" data-testid="footer-add-note-share">
            <p className="text-base"><span className="font-bold">Share it with {first} now?</span> They can read it on their own record from now on and get a notification in the app. You can make it private again later.</p>
            <div className="grid gap-2 grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <button type="button" disabled={!canSave} onClick={() => save.mutate("shared")}
                className="min-h-14 rounded-2xl bg-primary text-primary-foreground text-lg font-bold flex items-center justify-center gap-2 disabled:opacity-50">
                {save.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Eye className="w-5 h-5" />} Yes, save and share
              </button>
              <button type="button" disabled={save.isPending} onClick={() => setSharing(false)}
                className="min-h-14 rounded-2xl border-2 border-border text-lg font-bold disabled:opacity-50">
                Not yet
              </button>
            </div>
          </div>
        ) : (
        <div className="space-y-2" data-testid="footer-add-note">
          <div className="grid gap-2 grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <button type="button" disabled={!canSave} onClick={() => save.mutate("private")} className={pinnedPrimaryClass}>
              {save.isPending && save.variables === "private" ? <Loader2 className="w-6 h-6 animate-spin" /> : <Lock className="w-6 h-6" />} Save — private to you
            </button>
            <button type="button" onClick={onCancel} className="min-h-14 rounded-2xl border-2 border-border text-lg font-bold">Cancel</button>
          </div>
          <button type="button" disabled={!canSave} onClick={() => setSharing(true)}
            className="w-full min-h-12 rounded-2xl border-2 border-primary text-primary text-base font-bold flex items-center justify-center gap-2 hover:bg-primary/5 disabled:opacity-50">
            <Eye className="w-5 h-5" /> Save and share with {first}
          </button>
        </div>
        )}
      </PinnedFooter>
    </div>
  );
}
