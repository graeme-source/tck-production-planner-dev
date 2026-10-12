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
 *   • "Add meeting notes (AI)" is the main way in;
 *   • "Share with <name>" once there's something of yours to share;
 *   • the original notes the AI read, kept for audit.
 * Display only merges (whatHappened) — nothing stored is moved or dropped.
 */
import { useState } from "react";
import { ChevronDown, FileText, Lock, Plus, Sparkles } from "lucide-react";
import { whatHappened, fmtDayIso } from "@workspace/people-reviews";
import { cn } from "@/lib/utils";
import { AutoText } from "./review-fields";
import { recordSend, type PersonRecordEntries, type RecordEntry } from "./reviews-api";
import { ReviewNoteCard, ShareWriteUp, WriteUpComposer } from "./review-notes";
import { MeetingNotesAI, hasHeldDraft } from "./meeting-notes-ai";

export function WhatHappened({ entry, data, person, onChanged }: {
  entry: RecordEntry;
  data: PersonRecordEntries;
  person: { id: number; name: string };
  onChanged: () => void;
}) {
  const first = person.name.split(" ")[0];
  const w = whatHappened(entry);
  const [ai, setAi] = useState(() => hasHeldDraft(entry.id));
  const [byHand, setByHand] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const cancelled = entry.meetingStatus === "cancelled";
  const myPrivate = w.parts.some(n => n.visibility !== "shared" && n.authorId === data.viewerId);
  const sources = entry.sources ?? [];

  return (
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

      {myPrivate && !ai && <ShareWriteUp entryId={entry.id} personName={person.name} onChanged={onChanged} />}

      {!cancelled && !ai && (byHand ? (
        <WriteUpComposer entryId={entry.id} personName={person.name} hideNotes
          onDone={() => { setByHand(false); onChanged(); }} onCancel={() => setByHand(false)} />
      ) : (
        <button type="button" onClick={() => setByHand(true)}
          className="h-11 text-base font-semibold text-muted-foreground hover:text-foreground hover:underline flex items-center gap-1.5">
          <Plus className="w-4 h-4" /> Add feedback or an objective by hand
        </button>
      ))}

      {sources.length > 0 && (
        <div className="rounded-2xl bg-secondary/40 p-3 space-y-2">
          <button type="button" onClick={() => setShowSources(s => !s)} aria-expanded={showSources}
            className="w-full min-h-11 text-left text-base font-bold flex items-center gap-2">
            <Lock className="w-4 h-4 shrink-0" />
            <span className="flex-1">Original meeting notes ({sources.length}) — People access only</span>
            <ChevronDown className={cn("w-5 h-5 transition-transform", showSources && "rotate-180")} />
          </button>
          {showSources && sources.map(s => (
            <div key={s.id} className="rounded-xl border-2 border-border bg-card p-3 space-y-1">
              <p className="text-sm text-muted-foreground">
                {s.kind === "url" ? "From a shared link" : "Pasted"} · {fmtDayIso(s.createdAt.slice(0, 10))}{s.createdByName ? ` · ${s.createdByName}` : ""}
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
  );
}
