/**
 * "Add meeting notes (AI)" (Graeme, 2026-10-12: "record the meeting on AI
 * note summary and then upload that summary… I don't need to do loads of
 * admin").
 *
 *   1. PASTE the notes (big box, dictation too), or reuse what's already
 *      written on the meeting. Wispr Flow shared links need a login
 *      (checked with a real link, 12 Oct 2026), so the app never reads a
 *      link: a pasted link moves into "Link to the notes (optional)", is
 *      kept on the entry as the source reference, and the box says to copy
 *      the notes in instead.
 *   2. Claude drafts: a title from the topic, a short summary, what was
 *      agreed, follow-up actions with owners and dates, and a suggested
 *      classification.
 *   3. Graeme checks and edits the draft. NOTHING is on the record until he
 *      presses Save to record — the panel says so the whole time. The draft
 *      is held in memory for this tab (never on disk: HR notes on a shared
 *      iPad) so closing the pop-up by accident doesn't lose it.
 *   4. Saved → private to him; "Share with <name>" is the next, separate tap.
 *
 * Server: routes/people-meeting-notes.ts (People PIN, the write rule, zod).
 */
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  AlertTriangle, Check, Link2, Loader2, Plus, RotateCcw, Sparkles, Trash2, X,
} from "lucide-react";
import {
  sortClassifications, whatHappenedText, linkOnly, linkPastedMessage, ACTION_OWNERS, MAX_NOTES_CHARS,
  ANSWERS_TRIGGER, ANSWERS_TRIGGER_LABEL, ANSWERS_TRIGGER_QUESTION, needsPolicyReview, entryClassIds, entryClassification, meetingNotesSaveParts as saveDraftParts,
  type ActionOwner, type MeetingNotesDraft, type AnswersTrigger,
} from "@workspace/people-reviews";
import { TRIGGER_HINT } from "./trigger-link";
import { ClassTicks } from "./class-ticks";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { DictateButton } from "@/components/dictate-button";
import { ChoiceButton, FieldLabel } from "./review-fields";
import { recordSend, type PersonRecordEntries, type RecordEntry } from "./reviews-api";
import { PinnedFooter, pinnedPrimaryClass } from "@/components/ui/pinned-save-bar";
import { usePeopleModalCloseGuard } from "@/components/people-modal";

type Action = MeetingNotesDraft["actions"][number] & { todo: boolean };
interface Draft extends Omit<MeetingNotesDraft, "actions"> {
  actions: Action[];
  /** Ticked in the check step (0184); unset = the suggestion, else as it is. */
  classificationIds?: number[];
}
interface Source { kind: "url" | "text"; url: string | null; text: string }
interface ReadResult { draft: MeetingNotesDraft; repaired: string[]; source: Source }

interface Held {
  url: string;
  text: string;
  draft: Draft | null;
  source: Source | null;
  repaired: string[];
}

/** Drafts in progress, per meeting, for this tab only (never persisted). */
const heldDrafts = new Map<number, Held>();

const box = "w-full px-4 py-3 rounded-2xl border-2 border-border bg-background text-lg leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/30";
const input = "w-full h-12 px-4 rounded-xl border-2 border-border bg-background text-lg focus:outline-none focus:ring-2 focus:ring-primary/30";

export function hasHeldDraft(entryId: number): boolean {
  return heldDrafts.get(entryId)?.draft != null;
}

export function MeetingNotesAI({ entry, data, personName, onSaved, onClose }: {
  entry: RecordEntry;
  data: PersonRecordEntries;
  personName: string;
  onSaved: () => void;
  onClose: () => void;
}) {
  const first = personName.split(" ")[0];
  const start = heldDrafts.get(entry.id);
  const [url, setUrl] = useState(start?.url ?? "");
  const [text, setText] = useState(start?.text ?? "");
  const [draft, setDraft] = useState<Draft | null>(start?.draft ?? null);
  const [source, setSource] = useState<Source | null>(start?.source ?? null);
  const [repaired, setRepaired] = useState<string[]>(start?.repaired ?? []);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // "Does this review deal with the attendance trigger?" — asked only while
  // a trigger is due for them, or when this review is already linked.
  const askTrigger = entry.answersTrigger != null
    || needsPolicyReview(data.triggerReview?.sickness) || needsPolicyReview(data.triggerReview?.lates);
  const [link, setLink] = useState<AnswersTrigger | null>(entry.answersTrigger);
  const existing = whatHappenedText(entry);
  const classifications = sortClassifications(data.classifications).filter(c => c.active || entryClassIds(entry).includes(c.id));

  // Keep the work in memory as it changes.
  useEffect(() => {
    heldDrafts.set(entry.id, { url, text, draft, source, repaired });
  }, [entry.id, url, text, draft, source, repaired]);

  /** The notes box. A link pasted on its own is never read — it moves to the
   *  link field (kept as the reference) and the box says what to do. */
  const changeText = (v: string) => {
    const link = linkOnly(v);
    if (link) {
      setUrl(link);
      setText("");
      setNotice(linkPastedMessage(link));
      return;
    }
    setText(v);
    if (v.trim()) setNotice(null);
  };

  const read = useMutation({
    mutationFn: () => recordSend<ReadResult>("POST", `/entries/${entry.id}/meeting-notes/read`, { text, url: url.trim() || null }),
    onSuccess: r => {
      setNotice(null);
      setSource(r.source);
      setRepaired(r.repaired);
      setDraft({ ...r.draft, objectives: r.draft.objectives ?? [], actions: r.draft.actions.map(a => ({ ...a, todo: a.owner === "me" })) });
    },
    onError: (e: unknown) => setNotice(e instanceof Error ? e.message : "Couldn't read the notes"),
  });

  const save = useMutation({
    mutationFn: (d: Draft) => recordSend<{ created: number; todos: number }>("POST", `/entries/${entry.id}/meeting-notes`, {
      title: d.title, classificationId: d.classificationId,
      classificationIds: d.classificationIds ?? (d.classificationId != null ? [d.classificationId] : entryClassIds(entry)),
      summary: d.summary,
      ...saveDraftParts(d),
      actions: d.actions.map(a => ({ what: a.what, owner: a.owner, ownerName: a.owner === "other" ? (a.ownerName || null) : null, date: a.date || null, todo: a.owner === "me" && a.todo })),
      source,
      // Only sent when the question was asked (otherwise left as it is).
      ...(askTrigger ? { answersTrigger: link } : {}),
    }),
    onSuccess: r => {
      heldDrafts.delete(entry.id);
      toast({
        title: "Saved to the record — private to you",
        description: `${r.todos ? `${r.todos} to-do${r.todos === 1 ? "" : "s"} on your list. ` : ""}Share it with ${first} when you're ready.`,
      });
      onSaved();
    },
    onError: (e: unknown) => {
      toast({ title: "Couldn't save it", description: e instanceof Error ? e.message : "Try again — the draft is still here", variant: "destructive" });
    },
  });

  const discard = () => { heldDrafts.delete(entry.id); onClose(); };

  // Closing the review (X, Escape, tapping outside) with a draft that isn't
  // on the record asks Save / Discard / Keep editing (Graeme, 2026-10-13).
  usePeopleModalCloseGuard(draft ? {
    title: "This draft isn't saved",
    description: `The AI's write-up of this meeting isn't on ${first}'s record yet. Save it now, or throw it away?`,
    saveLabel: "Save to record",
    onSave: async () => {
      try { await save.mutateAsync(draft); return true; } catch { return false; }
    },
    onDiscard: () => { heldDrafts.delete(entry.id); },
  } : null);
  const set = (patch: Partial<Draft>) => setDraft(d => (d ? { ...d, ...patch } : d));

  // ── Step 1: paste the notes ──────────────────────────────────────────────
  if (!draft) {
    const canRead = text.trim().length >= 20;
    return (
      <div className="rounded-3xl border-2 border-primary/50 bg-card p-4 space-y-4">
        <div className="flex items-start gap-3">
          <Sparkles className="w-6 h-6 text-primary shrink-0 mt-1" />
          <div className="flex-1 min-w-0">
            <h4 className="text-xl font-bold">Add meeting notes (AI)</h4>
            <p className="text-base text-muted-foreground">Paste the notes — from Wispr Flow or anywhere. The AI drafts the record; you check it before anything is saved.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="p-2 rounded-xl text-muted-foreground hover:bg-secondary"><X className="w-6 h-6" /></button>
        </div>

        {notice && (
          <div className="rounded-2xl bg-amber-50 dark:bg-amber-950/30 border-2 border-amber-300 dark:border-amber-800 p-4 flex items-start gap-3" role="status">
            <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
            <p className="text-base font-semibold text-amber-950 dark:text-amber-100">{notice}</p>
          </div>
        )}

        <div className="space-y-2">
          <FieldLabel>Paste the notes</FieldLabel>
          <textarea value={text} onChange={e => changeText(e.target.value)} rows={12} maxLength={MAX_NOTES_CHARS}
            placeholder="Paste the meeting summary or transcript here — or dictate it." className={cn(box, "resize-y min-h-64")} />
          <DictateButton value={text} onChange={changeText} context="note" size="lg" />
          {existing && text.trim() !== existing.trim() && (
            <button type="button" onClick={() => changeText(text.trim() ? `${text.trim()}\n\n${existing}` : existing)}
              className="w-full h-12 rounded-2xl border-2 border-border text-base font-bold hover:bg-secondary/50">
              Use what's already written on this meeting
            </button>
          )}
        </div>

        <label className="block space-y-1.5">
          <span className="text-base font-bold flex items-center gap-2"><Link2 className="w-4 h-4 text-muted-foreground" /> Link to the notes (optional)</span>
          <input value={url} onChange={e => setUrl(e.target.value)} inputMode="url" autoCapitalize="off" autoCorrect="off" maxLength={2000}
            placeholder="https://notes.wisprflow.ai/shared/…" className={input} />
          <span className="block text-sm text-muted-foreground">Kept on the record as where the notes came from. The app doesn't open it — Wispr Flow links need a login.</span>
        </label>

        <PinnedFooter>
          <div className="space-y-1.5" data-testid="footer-ai-paste">
            {!canRead && <p className="text-sm text-muted-foreground">Paste or dictate the notes first, then read them.</p>}
            <button type="button" disabled={!canRead || read.isPending} onClick={() => read.mutate()}
              className="w-full h-14 rounded-2xl bg-primary text-primary-foreground text-xl font-bold flex items-center justify-center gap-2 disabled:opacity-50">
              {read.isPending ? <Loader2 className="w-6 h-6 animate-spin" /> : <Sparkles className="w-6 h-6" />}
              {read.isPending ? "Reading the notes… about 20 seconds" : "Read the notes"}
            </button>
          </div>
        </PinnedFooter>
      </div>
    );
  }

  // ── Step 2: check the draft, then save ───────────────────────────────────
  const suggested = classifications.find(c => c.id === draft.classificationId);
  const nowTicked = entryClassIds(entry);
  const current = entryClassification(entry, classifications);
  // Starts as the AI's suggestion (replacing the meetings default), else as it is now.
  const draftTicks = draft.classificationIds ?? (draft.classificationId != null ? [draft.classificationId] : nowTicked);
  return (
    <div className="rounded-3xl border-2 border-primary/50 bg-card p-4 space-y-5">
      <div className="flex items-start gap-3">
        <Sparkles className="w-6 h-6 text-primary shrink-0 mt-1" />
        <div className="flex-1 min-w-0">
          <h4 className="text-xl font-bold">Check the AI's draft</h4>
          <p className="text-base text-muted-foreground">Change anything that's wrong. Save to record is at the bottom, always in view.</p>
        </div>
      </div>

      {repaired.length > 0 && (
        <p className="text-sm text-muted-foreground">The AI's answer needed tidying: {repaired.join("; ")}.</p>
      )}

      <label className="block space-y-1.5">
        <FieldLabel>Title</FieldLabel>
        <input value={draft.title} onChange={e => set({ title: e.target.value })} maxLength={120} className={cn(input, "h-14 font-bold")} />
      </label>

      <ClassTicks classifications={classifications.filter(c => c.active || nowTicked.includes(c.id))} value={draftTicks}
        onChange={ids => set({ classificationIds: ids })} label="What's it about?"
        hint={<>{suggested ? `The AI suggests "${suggested.label}".` : "The AI didn't suggest one."} Now: {current?.label ?? "—"}. Tick all that fit, or leave it.</>} />

      {askTrigger && (
        <div className="space-y-1.5">
          <FieldLabel>{ANSWERS_TRIGGER_QUESTION}</FieldLabel>
          <p className="text-sm text-muted-foreground">
            {first}'s attendance trigger is due. Pick one if this meeting was that review — otherwise it only counts if it's classified as attendance or timekeeping.
          </p>
          <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">
            {ANSWERS_TRIGGER.map(v => (
              <ChoiceButton key={v} selected={link === v} onClick={() => setLink(link === v ? null : v)} hint={TRIGGER_HINT[v]}>
                {ANSWERS_TRIGGER_LABEL[v]}
              </ChoiceButton>
            ))}
          </div>
        </div>
      )}

      <label className="block space-y-1.5">
        <FieldLabel>Summary</FieldLabel>
        <textarea value={draft.summary} onChange={e => set({ summary: e.target.value })} rows={5} maxLength={4000} className={cn(box, "resize-y")} />
      </label>

      <div className="space-y-2">
        <FieldLabel>What was agreed</FieldLabel>
        <p className="text-sm text-muted-foreground -mt-1">
          One list of bullet points — what's going to happen from here. Not objectives, not to-dos. It shows under "What we agreed" on the record — and to {first} once shared.
        </p>
        {draft.agreements.length === 0 && <p className="text-base text-muted-foreground">Nothing agreed — that's fine.</p>}
        <ul className="space-y-2">
          {draft.agreements.map((a, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="pt-3 text-xl font-bold text-primary select-none" aria-hidden>•</span>
              <textarea value={a} rows={2} maxLength={500} placeholder="e.g. Back on 4 May 2027, 24 hours a week over 3 days"
                aria-label={`Agreed point ${i + 1}`}
                onChange={e => set({ agreements: draft.agreements.map((v, j) => (j === i ? e.target.value : v)) })}
                className={cn(box, "flex-1 min-w-0 resize-y text-base")} />
              <button type="button" aria-label="Remove this point" onClick={() => set({ agreements: draft.agreements.filter((_, j) => j !== i) })}
                className="p-3 text-muted-foreground hover:text-destructive"><Trash2 className="w-5 h-5" /></button>
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => set({ agreements: [...draft.agreements, ""] })}
          className="h-11 text-base font-semibold text-primary hover:underline flex items-center gap-1.5"><Plus className="w-4 h-4" /> Add a point</button>
      </div>

      <div className="space-y-2">
        <FieldLabel>Performance objectives</FieldLabel>
        <p className="text-sm text-muted-foreground -mt-1">
          Only goals {first} is to achieve at work (e.g. "Wrap 240 packs an hour by 1 December"). Most meetings have none. These can be marked done later.
        </p>
        {draft.objectives.length === 0 && <p className="text-base text-muted-foreground">None — that's normal for this kind of meeting.</p>}
        {draft.objectives.map((o, i) => {
          const upd = (p: Partial<Draft["objectives"][number]>) => set({ objectives: draft.objectives.map((v, j) => (j === i ? { ...v, ...p } : v)) });
          return (
            <div key={i} className="rounded-2xl border-2 border-border p-3 space-y-2">
              <div className="flex items-start gap-2">
                <input value={o.title} placeholder="e.g. Wrapping speed" maxLength={300} onChange={e => upd({ title: e.target.value })}
                  className={cn(input, "flex-1 min-w-0 font-bold")} />
                <button type="button" aria-label="Remove this objective" onClick={() => set({ objectives: draft.objectives.filter((_, j) => j !== i) })}
                  className="p-3 text-muted-foreground hover:text-destructive"><Trash2 className="w-5 h-5" /></button>
              </div>
              <textarea value={o.detail ?? ""} rows={2} maxLength={2000} placeholder="What it means in practice, and how we'll know"
                onChange={e => upd({ detail: e.target.value })} className={cn(box, "resize-y text-base")} />
              <label className="block space-y-1">
                <span className="text-sm font-bold">Target date (optional)</span>
                <input type="date" value={o.date ?? ""} onChange={e => upd({ date: e.target.value || null })} className={cn(input, "text-base font-bold")} />
              </label>
            </div>
          );
        })}
        <button type="button" onClick={() => set({ objectives: [...draft.objectives, { title: "", detail: null, date: null }] })}
          className="h-11 text-base font-semibold text-primary hover:underline flex items-center gap-1.5"><Plus className="w-4 h-4" /> Add a performance objective</button>
      </div>

      <div className="space-y-2">
        <FieldLabel>Follow-up actions</FieldLabel>
        {draft.actions.length === 0 && <p className="text-base text-muted-foreground">No actions.</p>}
        {draft.actions.map((a, i) => {
          const upd = (p: Partial<Action>) => set({ actions: draft.actions.map((v, j) => (j === i ? { ...v, ...p } : v)) });
          return (
            <div key={i} className="rounded-2xl border-2 border-border p-3 space-y-2">
              <div className="flex items-start gap-2">
                <input value={a.what} maxLength={300} onChange={e => upd({ what: e.target.value })} className={cn(input, "flex-1 min-w-0 font-bold")} />
                <button type="button" aria-label="Remove this action" onClick={() => set({ actions: draft.actions.filter((_, j) => j !== i) })}
                  className="p-3 text-muted-foreground hover:text-destructive"><Trash2 className="w-5 h-5" /></button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {ACTION_OWNERS.map((o: ActionOwner) => (
                  <button key={o} type="button" onClick={() => upd({ owner: o, todo: o === "me" })} aria-pressed={a.owner === o}
                    className={cn("h-12 rounded-xl border-2 text-base font-bold", a.owner === o ? "border-primary bg-primary/10 text-primary" : "border-border")}>
                    {o === "me" ? "Me" : o === "colleague" ? first : "Someone else"}
                  </button>
                ))}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {a.owner === "other" && (
                  <input value={a.ownerName ?? ""} placeholder="Who?" maxLength={80} onChange={e => upd({ ownerName: e.target.value })} className={input} />
                )}
                <input type="date" value={a.date ?? ""} aria-label="By when" onChange={e => upd({ date: e.target.value || null })} className={cn(input, "text-base font-bold")} />
              </div>
              {a.owner === "me" && (
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={a.todo} onChange={e => upd({ todo: e.target.checked })} className="w-5 h-5 accent-emerald-600" />
                  <span className="text-base font-semibold">Put it on my to-do list <span className="font-normal text-muted-foreground">("HR action due — tap here", {a.date ? "that day" : "a week from today"})</span></span>
                </label>
              )}
            </div>
          );
        })}
        <button type="button" onClick={() => set({ actions: [...draft.actions, { what: "", owner: "me", ownerName: null, date: null, todo: true }] })}
          className="h-11 text-base font-semibold text-primary hover:underline flex items-center gap-1.5"><Plus className="w-4 h-4" /> Add an action</button>
      </div>

      <p className="text-sm text-muted-foreground">
        Saving marks the meeting held and keeps the pasted notes{source?.url ? " and the link" : ""} on it, private to you. The write-up stays private to you until you share it — with HR, or with {first} after checking it twice.
      </p>

      <PinnedFooter>
        <div className="space-y-2" data-testid="footer-ai-draft">
          <p className="text-base font-bold text-amber-800 dark:text-amber-300 flex items-center gap-2" role="status">
            <AlertTriangle className="w-5 h-5 shrink-0" /> Not saved yet — check it, then Save to record.
          </p>
          {confirmDiscard ? (
            <div className="rounded-2xl border-2 border-destructive bg-destructive/5 p-3 space-y-2">
              <p className="text-lg font-bold">Throw this draft away?</p>
              <div className="grid gap-2 grid-cols-2">
                <button type="button" onClick={discard} className="min-h-12 rounded-2xl bg-destructive text-destructive-foreground text-base font-bold">Yes, throw it away</button>
                <button type="button" onClick={() => setConfirmDiscard(false)} className="min-h-12 rounded-2xl border-2 border-border text-base font-bold">Keep it</button>
              </div>
            </div>
          ) : (
            <>
              <button type="button" disabled={save.isPending} onClick={() => save.mutate(draft)} className={pinnedPrimaryClass}>
                {save.isPending ? <Loader2 className="w-6 h-6 animate-spin" /> : <Check className="w-6 h-6" />} Save to record
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => { setDraft(null); setSource(null); }}
                  className="min-h-12 rounded-2xl border-2 border-border text-base font-bold flex items-center justify-center gap-2 hover:bg-secondary/50">
                  <RotateCcw className="w-5 h-5" /> Read again
                </button>
                <button type="button" onClick={() => setConfirmDiscard(true)}
                  className="min-h-12 rounded-2xl border-2 border-border text-base font-bold flex items-center justify-center gap-2 hover:bg-secondary/50">
                  <X className="w-5 h-5" /> Discard
                </button>
              </div>
            </>
          )}
        </div>
      </PinnedFooter>
    </div>
  );
}
