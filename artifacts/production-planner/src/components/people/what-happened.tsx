/**
 * "What happened" — the ONE place a meeting's content lives (Graeme,
 * 2026-10-12: "It looks like we've got two different UIs for adding
 * information to the same meeting… I can add notes if I want, but I don't
 * want to then be asked to add more notes when I write it up later").
 *
 * The old "Record notes" box and "Write it up" panel are merged here:
 *   • the meeting's notes (typed at scheduling or after; People access only,
 *     never shared; autosaving) come first — they count as written up;
 *   • then the write-up parts (summary, what was agreed, actions — from the
 *     AI or by hand), each private until shared;
 *   • "Add meeting notes (AI)" is THE way in — the separate by-hand write-up
 *     went 30 Oct 2026 (Graeme: one schedule, then the notes, then share);
 *   • "Share with <name>" once there's something of yours to share;
 *   • the original notes the AI read, kept for audit — private to whoever
 *     pasted them (the server only sends you your own).
 * Display only merges (whatHappened) — nothing stored is moved or dropped.
 */
import { useState, type ReactNode } from "react";
import { AlertTriangle, Check, ChevronDown, FileText, Loader2, Lock, Sparkles } from "lucide-react";
import { whatHappened, fmtDayIso } from "@workspace/people-reviews";
import { cn } from "@/lib/utils";
import { AutoText } from "./review-fields";
import { recordSend, type PersonRecordEntries, type RecordEntry } from "./reviews-api";
import { ReviewNoteCard, ShareWriteUp } from "./review-notes";
import { RecordReadersProvider } from "./share-dialog";
import { MeetingNotesAI, hasHeldDraft, hasHeldWork } from "./meeting-notes-ai";
import { PinnedFooter } from "@/components/ui/pinned-save-bar";
import { useAutosaveSummary } from "@/hooks/autosave-summary";
import { reviewFooterMode, showShareInFooter, SAVE_SUMMARY_LABEL } from "@/lib/review-footer";

/** The review editor's footer when nothing needs a Save press: every field
 *  saves itself, so it says how that's going — and offers Share. */
function AutosaveFooter({ share }: { share: ReactNode }) {
  const summary = useAutosaveSummary();
  const state = summary?.state ?? "saved";
  return (
    <div className="space-y-2" data-testid="footer-autosave" data-state={state}>
      {state === "error" ? (
        <button type="button" onClick={summary?.retry} className="min-h-11 text-base font-bold text-destructive underline flex items-center gap-2" role="status">
          <AlertTriangle className="w-5 h-5 shrink-0" /> {SAVE_SUMMARY_LABEL.error}
        </button>
      ) : (
        <p className={cn("min-h-11 text-base font-bold flex items-center gap-2", state === "saved" ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")} role="status">
          {state === "saved" ? <Check className="w-5 h-5 shrink-0" /> : <Loader2 className="w-5 h-5 shrink-0 animate-spin" />}
          {state === "saved" ? "All changes saved" : SAVE_SUMMARY_LABEL[state]}
          <span className="hidden sm:inline font-normal text-sm text-muted-foreground">· everything here saves as you type</span>
        </p>
      )}
      {share}
    </div>
  );
}

export function WhatHappened({ entry, data, person, onChanged }: {
  entry: RecordEntry;
  data: PersonRecordEntries;
  person: { id: number; name: string };
  onChanged: () => void;
}) {
  const first = person.name.split(" ")[0];
  const w = whatHappened(entry);
  const [ai, setAi] = useState(() => hasHeldWork(entry.id));
  const [showSources, setShowSources] = useState(false);
  const cancelled = entry.meetingStatus === "cancelled";
  const myUnshared = w.parts.filter(n => n.visibility !== "shared" && n.authorId === data.viewerId);
  const myPrivate = myUnshared.length > 0;
  const sources = entry.sources ?? [];
  const mode = reviewFooterMode({ aiOpen: ai, hasDraft: hasHeldDraft(entry.id), byHand: false });

  return (
    <RecordReadersProvider readers={data.recordReaders}>
    <section className="rounded-3xl border-2 border-border bg-card p-4 space-y-4">
      <h3 className="text-lg font-bold flex items-center gap-2"><FileText className="w-5 h-5 text-primary" /> What happened</h3>

      {ai ? (
        <MeetingNotesAI entry={entry} data={data} personName={person.name}
          onSaved={() => { setAi(false); onChanged(); }} onClose={() => setAi(false)} />
      ) : !cancelled && (
        <button type="button" onClick={() => setAi(true)}
          className="w-full min-h-16 rounded-2xl bg-primary text-primary-foreground px-4 py-3 text-xl font-bold flex items-center justify-center gap-2">
          <Sparkles className="w-6 h-6 shrink-0" /> Add meeting notes (AI)
        </button>
      )}

      <div className="space-y-1">
        <AutoText label="Notes" initial={entry.notes} rows={w.recordNotes ? 6 : 3}
          placeholder="Anything you want to jot down — before the meeting or after. Optional."
          onSave={async v => {
            await recordSend("PATCH", `/entries/${entry.id}`, { notes: v });
            // Notes on a booked meeting whose day has come mark it held (server) — show that.
            if (entry.meetingStatus === "booked" && v.trim()) onChanged();
          }} />
        <p className="text-sm text-muted-foreground flex items-center gap-1.5">
          <Lock className="w-3.5 h-3.5 shrink-0" /> People access only — never shared with {first}.
          {entry.notesUpdatedByName && entry.notesUpdatedAt ? ` Last written by ${entry.notesUpdatedByName}, ${fmtDayIso(entry.notesUpdatedAt)}.` : ""}
        </p>
      </div>

      {w.parts.length > 0 && (
        <div className="space-y-3 pl-3 border-l-4 border-secondary">
          {w.parts.map(n => (
            <ReviewNoteCard key={n.id} note={n} viewerId={data.viewerId} canWrite personName={person.name} onChanged={onChanged} inReport />
          ))}
        </div>
      )}

      {mode === "autosave" && (
        <PinnedFooter>
          <AutosaveFooter share={showShareInFooter(mode, myPrivate)
            ? <div className="flex justify-end"><ShareWriteUp entryId={entry.id} personName={person.name} parts={myUnshared} onChanged={onChanged} /></div>
            : null} />
        </PinnedFooter>
      )}


      {sources.length > 0 && (
        <div className="rounded-2xl bg-secondary/40 p-3 space-y-2">
          <button type="button" onClick={() => setShowSources(s => !s)} aria-expanded={showSources}
            className="w-full min-h-11 text-left text-base font-bold flex items-center gap-2">
            <Lock className="w-4 h-4 shrink-0" />
            <span className="flex-1">Original meeting notes ({sources.length}) — private to you</span>
            <ChevronDown className={cn("w-5 h-5 transition-transform", showSources && "rotate-180")} />
          </button>
          {showSources && sources.map(s => (
            <div key={s.id} className="rounded-xl border-2 border-border bg-card p-3 space-y-1">
              <p className="text-sm text-muted-foreground">
                Pasted notes{s.url ? " · link kept for reference" : ""} · {fmtDayIso(s.createdAt.slice(0, 10))}{s.createdByName ? ` · ${s.createdByName}` : ""}
              </p>
              {s.url && (
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-base font-semibold text-primary underline break-all">{s.url}</a>
              )}
              <p className="text-base whitespace-pre-wrap break-words max-h-80 overflow-y-auto">{s.text}</p>
            </div>
          ))}
        </div>
      )}
    </section>
    </RecordReadersProvider>
  );
}
