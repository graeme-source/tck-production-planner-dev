/**
 * Performance pay review page for one person (Graeme, 24 Nov 2026):
 * /people/:userId/review. The live data report for any period, what the
 * data suggests to talk about, private prep notes (never shown to them),
 * and a saved copy attached to the review meeting that can be shared with
 * them alongside the written-up notes. Server: routes/people-performance.ts.
 */
import { useEffect, useRef, useState } from "react";
import { PayRateCard } from "./pay-rate-card";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Loader2, Lock, Sparkles, ThumbsUp, Target, Save, Share2, EyeOff, Trash2, Eye, X, CheckCircle2, AlertTriangle, CalendarPlus, StickyNote, Plus,
} from "lucide-react";
import { applyExclusions, suggestions as suggestFor, type Exclusions, type PerformanceReport, type Suggestion } from "@workspace/performance-review";
import { peopleFetch, peopleRetry, PeopleLockedError } from "@/hooks/use-people-gate";
import { PEOPLE_PIN_NEEDED_EVENT } from "@/components/employee-reviews";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MeetingWriteUpView, NotesDetail, PerformanceReportView, periodLabel, type MeetingWriteUp, type ReportEditing } from "./performance-report-view";
import { PeopleModal } from "@/components/people-modal";
import { BookReviewForm } from "./book-review";
import { useRecordFacts } from "./record-panel";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { PeriodPicker, usePeriodChoice } from "@/components/period-picker";
import { customWindow, presetForRange } from "@/lib/roas";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface ReviewResponse {
  report: PerformanceReport;
  suggestions: Suggestion[];
  prep: { body: string; updatedAt: string | null };
  saved: Array<{
    id: number; from: string; to: string; entryId: number | null; entryTitle: string | null; createdAt: string; createdByName: string | null; sharedAt: string | null;
    /** The attached meeting's write-up: my own parts still private, and parts already shared with them. */
    writeUpMine: number; writeUpShared: number;
  }>;
  meetings: Array<{ id: number; title: string; date: string; meetingStatus: string | null }>;
  /** Where the "ready to read" email would go; null = no address. */
  contact?: { email: string | null };
}

/** auto: the server's choice (since their last appraisal, else 6 months);
 *  since: from their last appraisal to today; picker: the standard picker. */
type Period = { kind: "auto" } | { kind: "since"; from: string } | { kind: "picker" };

const londonToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
const fmtDay = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** A People write; a locked People PIN asks for it instead of failing silently. */
async function peopleSend<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    method, credentials: "include",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const j = await res.json().catch(() => ({}));
  if (res.status === 423 || res.status === 428) {
    window.dispatchEvent(new Event(PEOPLE_PIN_NEEDED_EVENT));
    throw new PeopleLockedError(res.status, (j as { error?: string }).error ?? "People is locked");
  }
  if (!res.ok) throw new Error((j as { error?: string }).error ?? `Something went wrong (${res.status})`);
  return j as T;
}

export function PerformanceReview({ userId, ready }: { userId: number; ready: boolean }) {
  const qc = useQueryClient();
  const [period, setPeriod] = useState<Period>({ kind: "auto" });
  // The standard period picker (Graeme, 25 Nov 2026), used once a preset or
  // a date is picked; until then the page opens on Since last review.
  const picker = usePeriodChoice("last6Months");
  const range = period.kind === "auto" ? null
    : period.kind === "since" ? { from: period.from, to: londonToday() }
    : { from: picker.period.from, to: picker.period.to };
  const key = ["people-performance", userId, range?.from ?? "auto", range?.to ?? "auto"];
  const { data, isLoading, error } = useQuery<ReviewResponse>({
    queryKey: key,
    enabled: ready && !(period.kind === "picker" && picker.period.empty),
    retry: peopleRetry,
    queryFn: () => peopleFetch(`/people-performance/person/${userId}${range ? `?from=${range.from}&to=${range.to}` : ""}`),
  });
  const [viewing, setViewing] = useState<number | null>(null);
  // What's been unticked while going through it (Graeme, 24 Nov 2026) —
  // kept per person and period in this browser, so a refresh doesn't lose it.
  const exKey = data ? `perf-review-ex:${userId}:${data.report.period.from}:${data.report.period.to}` : null;
  const [ex, setEx] = useState<Exclusions>({ sections: [], items: [] });
  useEffect(() => {
    if (!exKey) return;
    try { const raw = localStorage.getItem(exKey); setEx(raw ? JSON.parse(raw) as Exclusions : { sections: [], items: [] }); } catch { setEx({ sections: [], items: [] }); }
  }, [exKey]);
  const updateEx = (next: Exclusions) => {
    setEx(next);
    try { if (exKey) localStorage.setItem(exKey, JSON.stringify(next)); } catch { /* private window: keep in memory */ }
  };
  const flip = (xs: string[], x: string) => (xs.includes(x) ? xs.filter(y => y !== x) : [...xs, x]);
  // "Add to my prep notes" from the notes card (Graeme, 24 Nov 2026: "so I
  // can then include that in the notes for the meeting").
  const appendToPrep = useRef<((text: string) => void) | null>(null);

  if (!ready || isLoading) return <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  if (error) {
    return (
      <div className="py-10 text-center space-y-3">
        <p className="text-lg font-semibold">{error instanceof PeopleLockedError ? "People is locked" : "Couldn't load the report"}</p>
        <p className="text-sm text-muted-foreground">{(error as Error).message}</p>
        <Link href={`/people/${userId}`} className="inline-flex h-11 items-center px-4 rounded-xl border border-border font-medium">Back to their record</Link>
      </div>
    );
  }
  if (!data) return null;
  const original = data.report;
  const r = applyExclusions(original, ex);
  const leftOut = ex.sections.length + ex.items.length;
  const first = r.person.name.split(" ")[0] ?? r.person.name;
  const refresh = () => qc.invalidateQueries({ queryKey: ["people-performance", userId] });
  const editing: ReportEditing = {
    original, ex,
    toggleSection: sec => updateEx({ ...ex, sections: flip(ex.sections, sec) }),
    toggleItem: k => updateEx({ ...ex, items: flip(ex.items, k) }),
    addToPrep: text => {
      appendToPrep.current?.(text);
      toast({ title: "Added to your prep notes", description: "It's at the bottom of your prep notes." });
    },
  };

  return (
    <div className="space-y-5 pb-10">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/people/${userId}`} className="text-sm text-muted-foreground inline-flex items-center gap-1 hover:text-foreground min-h-11">
            <ArrowLeft className="w-4 h-4" /> {r.person.name}'s record
          </Link>
          <h1 className="text-2xl sm:text-3xl font-display font-bold">Performance review — {r.person.name}</h1>
          <p className="text-sm text-muted-foreground">
            {r.person.jobTitle ? `${r.person.jobTitle} · ` : ""}{periodLabel(r)}
            {r.period.lastReviewDate ? ` · last appraisal ${fmtDay(r.period.lastReviewDate)}` : " · no appraisal on the record yet"}
          </p>
        </div>
      </div>
      <ReviewPeriodPicker period={period} onChange={setPeriod} picker={picker} shown={r.period} />

      <p className="text-sm text-muted-foreground -mb-2">
        {leftOut > 0
          ? <><span className="font-semibold text-foreground">{leftOut} {leftOut === 1 ? "thing" : "things"} left out</span> — {leftOut === 1 ? "it won't" : "they won't"} be in the copy you save and share. <button type="button" onClick={() => updateEx({ sections: [], items: [] })} className="underline decoration-dotted underline-offset-2">Put everything back</button></>
          : "Untick a card, or anything inside one that isn't right, to leave it out of the copy you save and share."}
      </p>
      <PerformanceReportView report={r} audience="manager" editing={editing}
        onNotesCard={() => document.getElementById("record-notes")?.scrollIntoView({ behavior: "smooth", block: "start" })} />

      {/* Prep notes and their record's notes side by side (Graeme, 24 Nov
          2026: "I want them available here … just for me to read from during
          the meeting"). */}
      {/* Their rate of pay and last pay rise, to discuss (26 Nov 2026) —
          beside the prep notes, never in the report they're shown. */}
      <PayRateCard userId={userId} ready={ready} canWrite />
      <div className="grid gap-4 lg:grid-cols-2 items-start">
        <PrepNotes userId={userId} first={first} initial={data.prep} appendRef={appendToPrep} />
        <RecordNotesPanel userId={userId} first={first} report={r} editing={editing} onAdded={refresh} />
      </div>

      <SuggestionsCard suggestions={leftOut > 0 ? suggestFor(r) : data.suggestions} />

      <SavedCopies
        userId={userId} first={first} report={r} meetings={data.meetings} saved={data.saved}
        onChanged={refresh} onView={setViewing} ready={ready} exclusions={ex} personEmail={data.contact?.email ?? null}
      />

      <SavedViewer id={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}

/**
 * The standard period picker, plus "Since last review" at the front of the
 * row (Graeme, 24 Nov 2026: always offered — from their last performance
 * appraisal on the record to today; the page opens on it when there is one).
 */
function ReviewPeriodPicker({ period, onChange, picker, shown }: {
  period: Period;
  onChange: (p: Period) => void;
  picker: ReturnType<typeof usePeriodChoice>;
  /** The dates the report on screen covers, as the server worked them out. */
  shown: { from: string; to: string; lastReviewDate: string | null };
}) {
  const lastReview = shown.lastReviewDate;
  const usingPicker = period.kind === "picker";
  const sinceActive = period.kind === "since" || (period.kind === "auto" && !!lastReview);
  const now = new Date();
  // Until a preset or date is picked, show the report's own dates and light
  // the preset they match, if any.
  const periodId = usingPicker ? picker.periodId : sinceActive ? "custom" : presetForRange(shown.from, shown.to, now);
  const win = usingPicker ? picker.period : customWindow(shown.from, shown.to, now);
  return (
    <PeriodPicker
      periodId={periodId}
      period={win}
      todayStr={picker.todayStr}
      extras={[{
        key: "since",
        label: `Since last review${lastReview ? ` · ${fmtDay(lastReview)}` : ""}`,
        active: sinceActive,
        disabled: !lastReview,
        reason: "no performance appraisal on their record yet",
        onClick: () => lastReview && onChange({ kind: "since", from: lastReview }),
      }]}
      onPreset={(id) => { picker.onPreset(id); onChange({ kind: "picker" }); }}
      onDate={(field, value) => {
        if (usingPicker) picker.onDate(field, value);
        else picker.setRange(field === "from" ? value : shown.from, field === "to" ? value : shown.to);
        onChange({ kind: "picker" });
      }}
    />
  );
}

function SuggestionsCard({ suggestions }: { suggestions: Suggestion[] }) {
  const strengths = suggestions.filter(s => s.tone === "strength");
  const focus = suggestions.filter(s => s.tone === "focus");
  return (
    <section className="rounded-2xl border-2 border-border bg-card p-4 sm:p-5">
      <h2 className="text-lg font-display font-bold flex items-center gap-2"><Sparkles className="w-5 h-5 text-primary" /> What the data says to talk about</h2>
      <p className="text-xs text-muted-foreground mb-3">Worked out from the figures above. For you to use — it isn't shared with them.</p>
      {suggestions.length === 0 && <p className="text-sm text-muted-foreground">Nothing stands out either way in this period.</p>}
      {strengths.length > 0 && (
        <div className="mb-3">
          <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5 mb-1.5"><ThumbsUp className="w-4 h-4" /> Recognise</p>
          <ul className="space-y-2">{strengths.map((s, i) => <SuggestionRow key={i} s={s} />)}</ul>
        </div>
      )}
      {focus.length > 0 && (
        <div>
          <p className="text-sm font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1.5 mb-1.5"><Target className="w-4 h-4" /> Objectives to set</p>
          <ul className="space-y-2">{focus.map((s, i) => <SuggestionRow key={i} s={s} />)}</ul>
        </div>
      )}
    </section>
  );
}

function SuggestionRow({ s }: { s: Suggestion }) {
  return (
    <li className={cn("rounded-xl px-3 py-2 text-sm", s.tone === "strength" ? "bg-emerald-50 dark:bg-emerald-950/30" : "bg-amber-50 dark:bg-amber-950/30")}>
      <p className="font-semibold">{s.headline}</p>
      <p className="text-muted-foreground">{s.detail}</p>
    </li>
  );
}

/**
 * Their record's notes, beside the prep notes — to read from in the meeting,
 * copy across, and add to there and then (Graeme, 24 Nov 2026). A note added
 * here goes on their record, private to you, exactly like "Add a note" on the
 * record; what's said about it in the meeting comes through the note taker.
 */
function RecordNotesPanel({ userId, first, report, editing, onAdded }: {
  userId: number; first: string; report: PerformanceReport; editing: ReportEditing; onAdded: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const add = async () => {
    const body = draft.trim();
    if (!body) return;
    setBusy(true);
    try {
      await peopleSend("POST", `/people-reviews/person/${userId}/notes`, { body, visibility: "private" });
      setDraft("");
      toast({ title: "Note added", description: `On ${first}'s record, private to you.` });
      onAdded();
    } catch (e) {
      if (!(e instanceof PeopleLockedError)) toast({ title: "Couldn't add it", description: (e as Error).message, variant: "destructive" });
    } finally { setBusy(false); }
  };
  // "Write up these notes" (Graeme, 26 Nov 2026): every note in the period
  // into constructive feedback with objectives — a draft to read and edit,
  // saved only as a private note when he chooses.
  const [writing, setWriting] = useState(false);
  const [writeUp, setWriteUp] = useState<{ body: string; count: number; missing: string[] } | null>(null);
  const [savingWriteUp, setSavingWriteUp] = useState(false);
  const writeItUp = async () => {
    setWriting(true);
    try {
      setWriteUp(await peopleSend<{ body: string; count: number; missing: string[] }>(
        "POST", `/people-performance/person/${userId}/write-up`, { from: report.period.from, to: report.period.to }));
    } catch (e) {
      if (!(e instanceof PeopleLockedError)) toast({ title: "Couldn't write it up", description: (e as Error).message, variant: "destructive" });
    } finally { setWriting(false); }
  };
  const saveWriteUp = async () => {
    if (!writeUp?.body.trim()) return;
    setSavingWriteUp(true);
    try {
      await peopleSend("POST", `/people-reviews/person/${userId}/notes`, { title: `Review write-up, ${periodLabel(report)}`, body: writeUp.body.trim(), visibility: "private" });
      setWriteUp(null);
      toast({ title: "Write-up saved", description: `On ${first}'s record, private until you share it.` });
      onAdded();
    } catch (e) {
      if (!(e instanceof PeopleLockedError)) toast({ title: "Couldn't save it", description: (e as Error).message, variant: "destructive" });
    } finally { setSavingWriteUp(false); }
  };
  return (
    <section id="record-notes" className="rounded-2xl border-2 border-border bg-card p-4 sm:p-5 space-y-3 scroll-mt-4">
      <div>
        <h2 className="text-lg font-display font-bold flex items-center gap-2"><StickyNote className="w-5 h-5 text-primary" /> Notes on {first}'s record</h2>
        <p className="text-xs text-muted-foreground">Everything written on their record for {periodLabel(report)}. Your private notes stay private.</p>
      </div>
      <button type="button" onClick={() => void writeItUp()} disabled={writing}
        className="h-11 px-3 rounded-xl border-2 border-primary/40 text-sm font-semibold flex items-center gap-2 hover:bg-primary/5 disabled:opacity-50">
        {writing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4 text-primary" />}
        {writing ? "Writing it up… (up to a minute)" : `Write these up as feedback for ${first}`}
      </button>
      <Dialog open={writeUp != null} onOpenChange={o => { if (!o) setWriteUp(null); }}>
        <DialogContent className="max-w-3xl w-[calc(100vw-2rem)] max-h-[92dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>Feedback for {first} — draft</DialogTitle></DialogHeader>
          {writeUp && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Written from {writeUp.count} {writeUp.count === 1 ? "note" : "notes"} on their record ({periodLabel(report)}). Read it through and change anything — it's saved as a private note, and {first} only sees it if you share it.</p>
              {writeUp.missing.length > 0 && (
                <p className="rounded-xl border-2 border-amber-400 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
                  <AlertTriangle className="w-4 h-4 inline mr-1 -mt-0.5" />
                  From the notes but not in the draft: <span className="font-semibold">{writeUp.missing.join(", ")}</span>. Check nothing's been left out.
                </p>
              )}
              <textarea value={writeUp.body} onChange={e => setWriteUp({ ...writeUp, body: e.target.value })} rows={20}
                aria-label="The write-up"
                className="w-full rounded-xl border-2 border-primary/40 bg-background px-3 py-2 text-sm leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-primary/30" />
              <div className="flex flex-wrap gap-2 justify-end">
                <button type="button" onClick={() => setWriteUp(null)} className="h-12 px-4 rounded-xl border-2 border-border text-base font-semibold">Discard</button>
                <button type="button" onClick={() => void saveWriteUp()} disabled={savingWriteUp || !writeUp.body.trim()}
                  className="h-12 px-4 rounded-xl bg-primary text-primary-foreground text-base font-bold flex items-center gap-2 disabled:opacity-50">
                  {savingWriteUp && <Loader2 className="w-4 h-4 animate-spin" />} Save to {first}'s record — private
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <div className="space-y-2">
        <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={3}
          placeholder={`Add a note to ${first}'s record…`}
          className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-primary/30" />
        {draft.trim() && (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void add()} disabled={busy}
              className="h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add to their record — private
            </button>
            <span className="text-xs text-amber-700 dark:text-amber-400">Not added yet</span>
          </div>
        )}
      </div>
      <div className="max-h-[75dvh] overflow-y-auto pr-1">
        <NotesDetail r={report} audience="manager" editing={editing} heading={false} />
      </div>
    </section>
  );
}

/** Private prep notes — saves itself; only you ever see your own. */
function PrepNotes({ userId, first, initial, appendRef }: {
  userId: number; first: string; initial: { body: string; updatedAt: string | null };
  appendRef: React.MutableRefObject<((text: string) => void) | null>;
}) {
  const [text, setText] = useState(initial.body);
  const textRef = useRef(text);
  textRef.current = text;
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<string | null>(null);
  const save = async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const body = pending.current;
    pending.current = null;
    if (body == null) return;
    setState("saving");
    try {
      await peopleSend("PUT", `/people-performance/person/${userId}/prep`, { body });
      if (pending.current == null) setState("saved");
    } catch { setState("error"); }
  };
  useEffect(() => () => { if (pending.current != null) void save(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const change = (next: string) => {
    setText(next);
    pending.current = next;
    setState("idle");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), 800);
  };
  // "Tidy into bullet points": nothing changes until he chooses Save.
  const [tidying, setTidying] = useState(false);
  const [proposal, setProposal] = useState<{ original: string; tidied: string; missing: string[] } | null>(null);
  const tidy = async () => {
    const original = textRef.current;
    if (!original.trim()) return;
    setTidying(true);
    try {
      const r = await peopleSend<{ tidied: string; missing: string[] }>("POST", `/people-performance/person/${userId}/prep/tidy`, { body: original });
      setProposal({ original, tidied: r.tidied, missing: r.missing ?? [] });
    } catch (e) {
      toast({ title: "Couldn't tidy them", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    } finally {
      setTidying(false);
    }
  };
  // Notes copied in from the report land at the bottom and save like typing.
  useEffect(() => {
    appendRef.current = (add: string) => {
      const cur = textRef.current.replace(/\s+$/, "");
      change(cur ? `${cur}\n\n${add}` : add);
    };
    return () => { appendRef.current = null; };
  }); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className="rounded-2xl border-2 border-border bg-card p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2 mb-1">
        <h2 className="text-lg font-display font-bold flex items-center gap-2"><Lock className="w-5 h-5 text-muted-foreground" /> Your prep notes</h2>
        <span className={cn("text-xs flex items-center gap-1", state === "error" ? "text-destructive" : state === "saved" ? "text-emerald-600" : "text-muted-foreground")}>
          {state === "saving" && <><Loader2 className="w-3 h-3 animate-spin" /> Saving…</>}
          {state === "saved" && <><CheckCircle2 className="w-3 h-3" /> Saved</>}
          {state === "error" && <><AlertTriangle className="w-3 h-3" /> Not saved — try again</>}
          {state === "idle" && "Saves as you type"}
        </span>
      </div>
      <p className="text-xs text-muted-foreground mb-2">Private to you — {first} never sees these, and they're never part of a shared report.</p>
      {/* "Tidy into bullet points" (Graeme, 26 Nov 2026): AI shortens them
          for reading in the meeting; old and new side by side, he chooses. */}
      <div className="mb-2">
        <button type="button" onClick={() => void tidy()} disabled={!text.trim() || tidying}
          className="h-11 px-3 rounded-xl border-2 border-primary/40 text-sm font-semibold flex items-center gap-2 hover:bg-primary/5 disabled:opacity-50">
          {tidying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4 text-primary" />}
          {tidying ? "Tidying…" : "Tidy into bullet points"}
        </button>
      </div>
      <Dialog open={proposal != null} onOpenChange={o => { if (!o) setProposal(null); }}>
        <DialogContent className="max-w-5xl w-[calc(100vw-2rem)] max-h-[92dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>Tidied prep notes — use them?</DialogTitle></DialogHeader>
          {proposal && (
            <div className="space-y-3">
              {proposal.missing.length > 0 && (
                <p className="rounded-xl border-2 border-amber-400 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
                  <AlertTriangle className="w-4 h-4 inline mr-1 -mt-0.5" />
                  Not in the new version: <span className="font-semibold">{proposal.missing.join(", ")}</span>. Check before you save.
                </p>
              )}
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <p className="text-sm font-semibold text-muted-foreground mb-1">Your notes now</p>
                  <pre className="whitespace-pre-wrap font-sans text-sm rounded-xl border border-border bg-secondary/30 p-3 max-h-[55dvh] overflow-y-auto">{proposal.original}</pre>
                </div>
                <div>
                  <p className="text-sm font-semibold text-primary mb-1">Tidied</p>
                  <pre className="whitespace-pre-wrap font-sans text-sm rounded-xl border-2 border-primary/40 bg-primary/5 p-3 max-h-[55dvh] overflow-y-auto">{proposal.tidied}</pre>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 justify-end">
                <button type="button" onClick={() => setProposal(null)}
                  className="h-12 px-4 rounded-xl border-2 border-border text-base font-semibold">Keep my original</button>
                <button type="button" onClick={() => { change(proposal.tidied); setProposal(null); void save(); toast({ title: "Prep notes replaced with the tidied version" }); }}
                  className="h-12 px-4 rounded-xl bg-primary text-primary-foreground text-base font-bold">Save — replace my notes</button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <textarea
        value={text}
        onChange={e => change(e.target.value)}
        onBlur={() => void save()}
        rows={16}
        placeholder={`What to say to ${first}, things that aren't in the system, questions to ask…`}
        className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-primary/30"
      />
      <p className="text-xs text-muted-foreground mt-2">
        Their full record — past reviews, notes and private entries — is on <Link href={`/people/${userId}`} className="underline decoration-dotted underline-offset-2">{first}'s record</Link>.
      </p>
    </section>
  );
}

function SavedCopies({ userId, first, report, meetings, saved, onChanged, onView, ready, exclusions, personEmail }: {
  userId: number; first: string; report: PerformanceReport;
  meetings: ReviewResponse["meetings"]; saved: ReviewResponse["saved"];
  onChanged: () => void; onView: (id: number) => void; ready: boolean; exclusions: Exclusions;
  personEmail: string | null;
}) {
  const [entryId, setEntryId] = useState<string>(meetings[0] ? String(meetings[0].id) : "");
  // Book the review meeting right here (Graeme, 24 Nov 2026: "I don't want
  // to have to create the meeting first and then go and select it").
  const [booking, setBooking] = useState(false);
  const facts = useRecordFacts(userId, ready && booking);
  const [justBooked, setJustBooked] = useState<number | null>(null);
  useEffect(() => {
    // Once the new meeting is in the list, select it.
    if (justBooked != null && meetings.some(m => m.id === justBooked)) { setEntryId(String(justBooked)); setJustBooked(null); }
  }, [justBooked, meetings]);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ id: number; action: "share" | "unshare" | "delete" } | null>(null);
  // Sharing a report attached to the meeting also shares my write-up of it
  // (ticked by default — the final report is the figures plus what was agreed).
  const [withWriteUp, setWithWriteUp] = useState(true);
  // Email them it's ready to read — ticked by default for a performance review (24 Nov 2026).
  const [withEmail, setWithEmail] = useState(true);

  const saveCopy = async () => {
    setBusy(true);
    try {
      await peopleSend("POST", `/people-performance/person/${userId}/reports`, { from: report.period.from, to: report.period.to, entryId: entryId ? Number(entryId) : null, exclusions });
      toast({ title: "Report saved", description: entryId ? "Attached to the meeting. Share it with them when you're ready." : "Saved to their record. Share it with them when you're ready." });
      onChanged();
    } catch (e) {
      if (!(e instanceof PeopleLockedError)) toast({ title: "Couldn't save it", description: (e as Error).message, variant: "destructive" });
    } finally { setBusy(false); }
  };
  const act = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm.action === "delete") await peopleSend("DELETE", `/people-performance/reports/${confirm.id}`);
      else {
        const out = await peopleSend<{ writeUpShared?: number; emailed?: { to: string } | null; emailError?: string | null }>("POST", `/people-performance/reports/${confirm.id}/share`, {
          shared: confirm.action === "share", shareWriteUp: confirm.action === "share" && withWriteUp, email: confirm.action === "share" && withEmail && !!personEmail,
        });
        if (out.emailError) toast({ title: "Shared, but the email didn't go", description: out.emailError, variant: "destructive" });
        if (confirm.action === "share") {
          toast({ title: "Shared", description: `${out.writeUpShared ? `The report and your write-up of the meeting are now on ${first}'s record.` : `The report is now on ${first}'s record.`}${out.emailed ? ` Emailed ${out.emailed.to}.` : ""}` });
        }
      }
      setConfirm(null);
      onChanged();
    } catch (e) {
      if (!(e instanceof PeopleLockedError)) toast({ title: "Couldn't do that", description: (e as Error).message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  return (
    <section className="rounded-2xl border-2 border-border bg-card p-4 sm:p-5 space-y-4">
      <div>
        <h2 className="text-lg font-display font-bold">Use it in the meeting</h2>
        <p className="text-sm text-muted-foreground">
          Save a copy of this report ({periodLabel(report)}) to the review meeting. The figures are frozen as they are now; the meeting's write-up is added as it's written. {first} only sees it once you share it.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm flex-1 min-w-[16rem]">
          <span className="block text-xs text-muted-foreground mb-1">Attach to</span>
          <select value={entryId} onChange={e => setEntryId(e.target.value)} className="w-full h-11 rounded-xl border border-border bg-background px-3">
            <option value="">— No meeting, just their record —</option>
            {meetings.map(m => <option key={m.id} value={m.id}>{fmtDay(m.date)} · {m.title}{m.meetingStatus === "booked" ? " (booked)" : ""}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => setBooking(true)}
          className="h-11 px-4 rounded-xl border-2 border-primary/40 text-sm font-semibold flex items-center gap-1.5 hover:bg-primary/5">
          <CalendarPlus className="w-4 h-4" /> Book the review meeting
        </button>
        <button type="button" onClick={() => void saveCopy()} disabled={busy}
          className="h-11 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save a copy
        </button>
      </div>
      {meetings.length === 0 && <p className="text-xs text-muted-foreground">No meetings on their record yet — book the review here, then save a copy to it.</p>}
      {booking && (
        <PeopleModal title={`Book the review meeting — ${report.person.name}`} onClose={() => setBooking(false)} wide>
          {facts.data ? (
            <BookReviewForm
              data={facts.data}
              startAsLabel="Performance appraisal"
              initialTitle="Performance review"
              onCancel={() => setBooking(false)}
              onCreated={id => {
                setBooking(false);
                setJustBooked(id);
                onChanged();
                toast({ title: "Review meeting booked", description: "It's selected below — save a copy of the report to it when you're ready." });
              }}
            />
          ) : (
            <div className="py-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          )}
        </PeopleModal>
      )}

      {saved.length > 0 && (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {saved.map(s => (
            <li key={s.id} className="px-3 py-2.5 flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[14rem]">
                <p className="text-sm font-semibold">{fmtDay(s.from)} – {fmtDay(s.to)}{s.entryTitle ? <span className="font-normal text-muted-foreground"> · {s.entryTitle}</span> : null}</p>
                <p className="text-xs text-muted-foreground">
                  Saved {fmtDay(s.createdAt)}{s.createdByName ? ` by ${s.createdByName}` : ""} · {s.sharedAt ? <span className="text-emerald-700 dark:text-emerald-400 font-semibold">Shared with {first} {fmtDay(s.sharedAt)}</span> : "Not shared"}
                </p>
              </div>
              <span className="flex items-center gap-1.5">
                <button type="button" onClick={() => onView(s.id)} className="h-10 px-3 rounded-lg border border-border text-sm flex items-center gap-1 hover:bg-secondary"><Eye className="w-4 h-4" /> View</button>
                {s.sharedAt
                  ? <button type="button" onClick={() => setConfirm({ id: s.id, action: "unshare" })} className="h-10 px-3 rounded-lg border border-border text-sm flex items-center gap-1 hover:bg-secondary"><EyeOff className="w-4 h-4" /> Stop sharing</button>
                  : <>
                      <button type="button" onClick={() => { setWithWriteUp(true); setWithEmail(true); setConfirm({ id: s.id, action: "share" }); }} className="h-10 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-semibold flex items-center gap-1"><Share2 className="w-4 h-4" /> Share with {first}</button>
                      <button type="button" onClick={() => setConfirm({ id: s.id, action: "delete" })} aria-label="Delete this copy" className="h-10 w-10 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:text-destructive hover:border-destructive"><Trash2 className="w-4 h-4" /></button>
                    </>}
              </span>
              {confirm?.id === s.id && (
                <div className="w-full rounded-xl bg-secondary/50 px-3 py-2 flex flex-wrap items-center gap-2 text-sm">
                  <span className="flex-1">
                    {confirm.action === "share" && <>
                      {first} will see this report in their own record (not your prep notes or the suggestions).
                      {s.entryId != null && s.writeUpMine > 0 && (
                        <label className="mt-1.5 flex items-start gap-2 cursor-pointer">
                          <input type="checkbox" checked={withWriteUp} onChange={e => setWithWriteUp(e.target.checked)} className="w-4 h-4 mt-0.5 accent-[#7cb342]" />
                          <span>Also share your write-up of <span className="font-semibold">{s.entryTitle ?? "the meeting"}</span> ({s.writeUpMine} {s.writeUpMine === 1 ? "part" : "parts"} still private) — it shows with the report.</span>
                        </label>
                      )}
                      {s.entryId != null && s.writeUpMine === 0 && s.writeUpShared > 0 && <span className="block mt-1">The meeting's write-up is already shared and shows with the report.</span>}
                      {s.entryId != null && s.writeUpMine === 0 && s.writeUpShared === 0 && <span className="block mt-1">Nothing's written up for the meeting yet — once it is, and shared, it shows with the report.</span>}
                      {personEmail ? (
                        <label className="mt-1.5 flex items-start gap-2 cursor-pointer">
                          <input type="checkbox" checked={withEmail} onChange={e => setWithEmail(e.target.checked)} className="w-4 h-4 mt-0.5 accent-[#7cb342]" />
                          <span>Email {first} that their performance review is ready to read, with a link <span className="text-muted-foreground">({personEmail})</span>.</span>
                        </label>
                      ) : <span className="block mt-1 text-muted-foreground">No email address on {first}'s account, so they'll only be told in the app.</span>}
                    </>}
                    {confirm.action === "unshare" && `${first} will no longer see this report.`}
                    {confirm.action === "delete" && "Delete this saved copy? The live report is unaffected."}
                  </span>
                  <button type="button" onClick={() => void act()} disabled={busy}
                    className={cn("h-10 px-3 rounded-lg text-sm font-semibold flex items-center gap-1 disabled:opacity-50", confirm.action === "delete" ? "bg-destructive text-destructive-foreground" : "bg-primary text-primary-foreground")}>
                    {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                    {confirm.action === "share" ? "Share it" : confirm.action === "unshare" ? "Stop sharing" : "Delete"}
                  </button>
                  <button type="button" onClick={() => setConfirm(null)} aria-label="Cancel" className="h-10 w-10 rounded-lg border border-border flex items-center justify-center"><X className="w-4 h-4" /></button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SavedViewer({ id, onClose }: { id: number | null; onClose: () => void }) {
  const { data, isLoading } = useQuery<{ report: PerformanceReport; sharedAt: string | null; writeUp: MeetingWriteUp | null }>({
    queryKey: ["people-performance-saved", id],
    enabled: id != null,
    retry: peopleRetry,
    queryFn: () => peopleFetch(`/people-performance/reports/${id}`),
  });
  return (
    <Dialog open={id != null} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="w-[calc(100vw-1rem)] sm:max-w-[min(96vw,1200px)] max-h-[92dvh] overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">
            {data ? `${data.report.person.name} — ${periodLabel(data.report)}` : "Saved report"}
          </DialogTitle>
        </DialogHeader>
        {isLoading || !data ? <Loader2 className="w-6 h-6 animate-spin text-muted-foreground mx-auto my-10" /> : <>
          <MeetingWriteUpView writeUp={data.writeUp} audience="manager" />
          <PerformanceReportView report={data.report} audience="manager" />
        </>}
      </DialogContent>
    </Dialog>
  );
}
