/**
 * "Can you test this?" — forced testing (Graeme, 2026-10-10; Objectives E
 * and F). When Graeme or a manager asks someone to try a change for real,
 * that person gets this card when they're signed in (their own device, or
 * switched in by PIN on a station iPad). WHEN it shows — once, or on
 * arriving at the place — is in lib/test-requests.ts (cardWanted).
 *
 * Like the swipe-panel walkthrough it's a floating card, never a full-screen
 * blocker — they have to be able to use the page to test it. It waits for
 * the PIN pad, the must-answer prompts and any full-screen pop-up, and sits
 * UNDER the to-do takeover and the "your report was fixed" notice.
 *
 *   ask      title, what to try, when — "Take me there" / "I'll try it now",
 *            "Put it on my to-do list — I'll do it later", "I've tried it"
 *   testing  after "Take me there": a small bar that follows them while
 *            they try it — "How did it go?"
 *   answer   three big answers + optional note (dictation) + optional photo,
 *            or "I can't test this" with a reason
 *
 * NO NAGGING (round 2): no timers. "Put it on my to-do list" — and the X —
 * puts it on their own to-do list and it never pops up again; the to-do's
 * link (?testRequest=ID) brings it back when they choose, and answering
 * ticks the to-do off.
 */
import { useEffect, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { Camera, CheckCircle2, ChevronLeft, ClipboardCheck, ListTodo, Loader2, MapPin, Navigation, X } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";
import { DictateButton } from "@/components/dictate-button";
import { useMyTestRequests, useTesterActions } from "@/hooks/use-test-requests";
import { useAnyPromptShowing, useFullScreenOverlayShowing, useReportPromptShowing } from "@/lib/prompt-presence";
import {
  ANSWER_OPTIONS, answerReady, needsAutoTodo, onLinkedPage, openedTestId, pickTestToShow, shouldShowTestCard, whenSummary,
  type MyTestRequest, type TestAnswer,
} from "@/lib/test-requests";

const PROMPT_KEY = "test-request";

type Mode = "ask" | "testing" | "answer";

/** Cards already shown on this page load — the "once" stays up while read. */
const shownThisLoad = new Set<number>();
/** No-place tests already sent to the to-do list on this load. */
const autoTodoSent = new Set<number>();

export function TestRequestCard() {
  const { state, pinLocked, peoplePinPrompt, peoplePinSetupPrompt } = useAuth();
  const userId = state.status === "authenticated" ? state.user.id : null;
  const [location, navigate] = useLocation();
  const search = useSearch();
  const listQ = useMyTestRequests(userId, !pinLocked);
  const actions = useTesterActions(userId);

  // Opened from its to-do (?testRequest=ID): show it until they deal with it
  // or close it. Closing only puts it away for now — it's on their list.
  const [openedId, setOpenedId] = useState<number | null>(() => openedTestId(search));
  useEffect(() => { const id = openedTestId(search); if (id) setOpenedId(id); }, [search]);

  // Re-check the time conditions every minute ("after 2pm").
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  const [, rerender] = useState(0);

  const request = pickTestToShow(listQ.data, { now, path: location, openedId, shownThisLoad });
  const otherPrompt = useAnyPromptShowing(PROMPT_KEY);
  const overlay = useFullScreenOverlayShowing(request != null);
  const show = shouldShowTestCard({
    request,
    pinLocked,
    otherPromptShowing: otherPrompt || overlay || peoplePinPrompt || peoplePinSetupPrompt,
    path: location,
  });
  // The thanks note counts too, so the walkthrough doesn't land on top of it.
  const [thanks, setThanks] = useState<string | null>(null);
  useReportPromptShowing(PROMPT_KEY, show || (!!thanks && !pinLocked));

  // First time on screen: remember it (a no-place test shows only once).
  useEffect(() => {
    if (!show || !request || shownThisLoad.has(request.id)) return;
    shownThisLoad.add(request.id);
    rerender(n => n + 1);
    if (!request.promptedAt) actions.prompted.mutate(request.id);
  }, [show, request?.id]);

  // A no-place test shown before and left without an answer goes on their
  // to-do list rather than popping up again.
  useEffect(() => {
    if (pinLocked || !listQ.data) return;
    for (const r of listQ.data) {
      if (needsAutoTodo(r, shownThisLoad) && !autoTodoSent.has(r.id)) {
        autoTodoSent.add(r.id);
        actions.later.mutate(r.id);
      }
    }
  }, [listQ.data, pinLocked]);

  // Kept here (not in the card) so a pop-up opening over the card and
  // closing again never loses what they'd typed.
  const [modeById, setModeById] = useState<Record<number, Mode>>({});
  const [answer, setAnswer] = useState<TestAnswer | null>(null);
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A different person or a different request starts clean.
  const lastId = useRef<number | null>(null);
  useEffect(() => {
    const id = request?.id ?? null;
    if (id !== lastId.current) {
      lastId.current = id;
      setAnswer(null); setNote(""); setPhoto(null); setError(null);
    }
  }, [request?.id]);
  useEffect(() => { setModeById({}); setThanks(null); setOpenedId(openedTestId(window.location.search)); }, [userId]);
  useEffect(() => {
    if (!thanks) return;
    const t = window.setTimeout(() => setThanks(null), 4000);
    return () => window.clearTimeout(t);
  }, [thanks]);

  if (thanks && !pinLocked) return <ThanksToast text={thanks} onClose={() => setThanks(null)} />;
  if (!show || !request) return null;

  const mode: Mode = modeById[request.id] ?? (request.startedAt ? "testing" : "ask");
  const setMode = (m: Mode) => setModeById(prev => ({ ...prev, [request.id]: m }));
  const busy = actions.start.isPending || actions.later.isPending || actions.answer.isPending;
  const onList = request.todoTaskId != null;

  /** "Put it on my to-do list" — and the X. Never pops up again. */
  const later = () => {
    setError(null);
    if (onList) { setOpenedId(null); return; }
    actions.later.mutate(request.id, {
      onSuccess: () => { setOpenedId(null); setThanks("It's on your to-do list — open it from there when you're ready."); },
      onError: e => setError((e as Error).message),
    });
  };
  const takeMeThere = () => {
    setError(null);
    actions.start.mutate(request.id, {
      onSuccess: () => { setMode("testing"); if (request.linkPath && !onLinkedPage(request.linkPath, location)) navigate(request.linkPath); },
      onError: e => setError((e as Error).message),
    });
  };
  const send = () => {
    if (!answer || !answerReady(answer, note)) return;
    setError(null);
    actions.answer.mutate({ id: request.id, answer, note, photo }, {
      onSuccess: () => {
        setOpenedId(null);
        setThanks(answer === "works_easy" ? "Thanks — that's marked as working." : answer === "cant_test" ? "Thanks — we'll sort out who else can test it." : "Thanks — that's gone straight to whoever asked.");
      },
      onError: e => setError((e as Error).message),
    });
  };
  const laterLabel = onList ? "Close — it's on your to-do list" : "Close — put it on my to-do list";

  if (mode === "testing") {
    return (
      <div
        role="dialog"
        aria-modal="false"
        aria-label={`Testing: ${request.title}`}
        className="fixed z-[55] left-3 right-3 bottom-4 sm:left-6 sm:right-auto sm:bottom-6 sm:w-[26rem] rounded-3xl border-2 border-sky-500 bg-card shadow-2xl p-3 flex items-center gap-3"
      >
        <ClipboardCheck className="w-8 h-8 text-sky-600 shrink-0" />
        <button type="button" onClick={() => setMode("ask")} className="min-w-0 flex-1 text-left" aria-label="Show what to try">
          <span className="block text-xs font-bold uppercase tracking-wide text-sky-700 dark:text-sky-400">Testing</span>
          <span className="block text-base font-bold leading-tight line-clamp-2">{request.title}</span>
        </button>
        <button type="button" onClick={() => setMode("answer")} className="h-12 px-4 rounded-2xl bg-sky-600 text-white text-base font-bold shrink-0">
          How did it go?
        </button>
        <button type="button" onClick={later} disabled={busy} aria-label={laterLabel} title={laterLabel} className="w-11 h-11 rounded-full flex items-center justify-center text-muted-foreground hover:bg-secondary shrink-0">
          {actions.later.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <X className="w-5 h-5" />}
        </button>
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="test-request-title"
      className="fixed z-[55] left-3 right-3 bottom-4 sm:left-6 sm:right-auto sm:bottom-6 sm:w-[30rem] max-h-[85dvh] flex flex-col rounded-3xl border-2 border-sky-500 bg-card shadow-2xl"
    >
      <div className="flex items-start gap-3 p-5 pb-3">
        <div className="w-12 h-12 rounded-2xl bg-sky-100 dark:bg-sky-900/40 flex items-center justify-center shrink-0">
          <ClipboardCheck className="w-7 h-7 text-sky-600" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold uppercase tracking-wide text-sky-700 dark:text-sky-400">Can you test this?</p>
          <h2 id="test-request-title" className="text-xl sm:text-2xl font-display font-bold leading-tight">{request.title}</h2>
        </div>
        <button
          type="button"
          onClick={mode === "answer" ? () => setMode(request.startedAt ? "testing" : "ask") : later}
          disabled={busy}
          aria-label={mode === "answer" ? "Back" : laterLabel}
          title={mode === "answer" ? "Back" : laterLabel}
          className="w-11 h-11 rounded-full flex items-center justify-center text-muted-foreground hover:bg-secondary hover:text-foreground shrink-0"
        >
          {mode === "answer" ? <ChevronLeft className="w-5 h-5" /> : <X className="w-5 h-5" />}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 space-y-3">
        {mode === "ask" ? (
          <AskBody request={request} />
        ) : (
          <AnswerBody
            answer={answer} setAnswer={setAnswer}
            note={note} setNote={setNote}
            photo={photo} setPhoto={setPhoto}
          />
        )}
        {error && <p className="text-base font-semibold text-destructive">Couldn't save — {error}</p>}
      </div>

      <div className="p-5 pt-3 space-y-2">
        {mode === "ask" ? (
          <>
            <button type="button" onClick={takeMeThere} disabled={busy} className="w-full h-14 rounded-2xl bg-sky-600 text-white text-lg font-bold flex items-center justify-center gap-2 disabled:opacity-60">
              {actions.start.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Navigation className="w-5 h-5" />}
              {request.linkPath && !onLinkedPage(request.linkPath, location) ? "Take me there" : "I'll try it now"}
            </button>
            <button type="button" onClick={later} disabled={busy} className="w-full min-h-14 py-2 rounded-2xl border-2 border-border text-base font-bold flex items-center justify-center gap-2 hover:bg-secondary/50 disabled:opacity-60">
              {actions.later.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <ListTodo className="w-5 h-5 shrink-0" />}
              {onList ? "Not now — it's on your to-do list" : "Put it on my to-do list — I'll do it later"}
            </button>
            <button type="button" onClick={() => setMode("answer")} disabled={busy} className="w-full h-12 rounded-2xl text-sky-700 dark:text-sky-300 text-base font-bold hover:bg-sky-50 dark:hover:bg-sky-900/30 disabled:opacity-60">
              I've already tried it — answer now
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={send}
            disabled={busy || !answerReady(answer, note)}
            className="w-full h-14 rounded-2xl bg-primary text-primary-foreground text-lg font-bold flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {actions.answer.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
            {answer === "cant_test" && !note.trim() ? "Say why first" : "Send"}
          </button>
        )}
      </div>
    </div>
  );
}

function AskBody({ request }: { request: MyTestRequest }) {
  return (
    <>
      <p className="text-lg leading-snug whitespace-pre-wrap">{request.steps}</p>
      <p className="flex items-center gap-2 text-base text-muted-foreground">
        <MapPin className="w-4 h-4 shrink-0" /> When: <span className="font-semibold text-foreground">{whenSummary(request)}</span>
      </p>
      {request.isReporter && request.issueDescription && (
        <div className="rounded-2xl bg-secondary/60 p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">You reported</p>
          <p className="text-base line-clamp-3">“{request.issueDescription}”</p>
        </div>
      )}
      {request.isReporter && request.improvementTitle && (
        <div className="rounded-2xl bg-secondary/60 p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Your improvement idea</p>
          <p className="text-base line-clamp-3">“{request.improvementTitle}”</p>
        </div>
      )}
      <p className="text-sm text-muted-foreground">
        Asked by {request.createdByName}. Try it, then tell us: does it work, and is it easy to understand?
      </p>
    </>
  );
}

function AnswerBody({ answer, setAnswer, note, setNote, photo, setPhoto }: {
  answer: TestAnswer | null; setAnswer: (a: TestAnswer) => void;
  note: string; setNote: (s: string) => void;
  photo: File | null; setPhoto: (f: File | null) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <p className="text-lg font-semibold">How did it go?</p>
      <div className="grid gap-2">
        {ANSWER_OPTIONS.map(o => (
          <button
            key={o.answer}
            type="button"
            onClick={() => setAnswer(o.answer)}
            aria-pressed={answer === o.answer}
            className={cn(
              "min-h-[64px] rounded-2xl px-4 py-2 text-left transition-all",
              answer === o.answer ? cn(o.tone, "ring-4 ring-offset-2 ring-offset-card ring-foreground/30") : "border-2 border-border hover:bg-secondary/50",
            )}
          >
            <span className="block text-lg font-bold leading-tight">{o.label}</span>
            <span className={cn("block text-sm", answer === o.answer ? "opacity-90" : "text-muted-foreground")}>{o.hint}</span>
          </button>
        ))}
      </div>
      <div>
        <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
          <label htmlFor="test-note" className="text-sm font-medium text-muted-foreground">
            {answer === "cant_test" ? "Why can't you test it?" : "Anything to add? (optional)"}
          </label>
          <DictateButton value={note} onChange={setNote} context="note" />
        </div>
        <textarea
          id="test-note"
          value={note}
          onChange={e => setNote(e.target.value)}
          rows={2}
          placeholder={answer === "works_confusing" ? "What was confusing?" : answer === "doesnt_work" ? "What happened?" : ""}
          className="w-full px-4 py-3 rounded-2xl border-2 border-border bg-card text-base focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => setPhoto(e.target.files?.[0] ?? null)} />
        <button type="button" onClick={() => fileRef.current?.click()} className="h-11 px-4 rounded-xl border-2 border-border text-base font-semibold flex items-center gap-2 hover:bg-secondary/50">
          <Camera className="w-5 h-5" /> {photo ? "Change photo" : "Add a photo (optional)"}
        </button>
        {photo && (
          <span className="text-sm text-muted-foreground flex items-center gap-1">
            {photo.name}
            <button type="button" onClick={() => setPhoto(null)} aria-label="Remove photo" className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-secondary"><X className="w-4 h-4" /></button>
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={() => setAnswer("cant_test")}
        aria-pressed={answer === "cant_test"}
        className={cn("text-base font-semibold underline underline-offset-4", answer === "cant_test" ? "text-foreground" : "text-muted-foreground")}
      >
        I can't test this
      </button>
    </>
  );
}

function ThanksToast({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <div role="status" className="fixed z-[55] left-3 right-3 bottom-4 sm:left-6 sm:right-auto sm:bottom-6 sm:w-[26rem] rounded-3xl border-2 border-emerald-500 bg-card shadow-2xl p-4 flex items-center gap-3">
      <CheckCircle2 className="w-8 h-8 text-emerald-600 shrink-0" />
      <p className="flex-1 text-base font-semibold">{text}</p>
      <button type="button" onClick={onClose} aria-label="Close" className="w-11 h-11 rounded-full flex items-center justify-center text-muted-foreground hover:bg-secondary"><X className="w-5 h-5" /></button>
    </div>
  );
}
