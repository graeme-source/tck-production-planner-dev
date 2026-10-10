/**
 * "Can you test this?" — forced testing (Graeme, 2026-10-10; Objectives E
 * and F). When a manager, Graeme, or the deploy session asks someone to try
 * a change for real, that person gets this card whenever they are signed in
 * (their own device, or switched in by PIN on a station iPad) and the
 * request's "when" is met. When it shows: lib/test-requests.ts.
 *
 * Like the swipe-panel walkthrough it's a floating card, never a full-screen
 * blocker — they have to be able to use the page to test it. It waits for
 * the PIN pad, the must-answer prompts and any full-screen pop-up, and sits
 * UNDER the to-do takeover and the "your report was fixed" notice.
 *
 *   ask      title, what to try, when, "Take me there" / "Tell us how it went"
 *   testing  after "Take me there": a small bar that follows them while
 *            they try it — "How did it go?"
 *   answer   three big answers + optional note (dictation) + optional photo,
 *            or "I can't test this" with a reason
 *
 * "Not now" (and the X) puts it away for two hours (server-side, per
 * person). It keeps coming back until they answer or a manager closes it.
 */
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Camera, CheckCircle2, ChevronLeft, ClipboardCheck, Clock, Loader2, MapPin, Navigation, X } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";
import { DictateButton } from "@/components/dictate-button";
import { useMyTestRequests, useTesterActions } from "@/hooks/use-test-requests";
import { useAnyPromptShowing, useFullScreenOverlayShowing, useReportPromptShowing } from "@/lib/prompt-presence";
import {
  ANSWER_OPTIONS, answerReady, onLinkedPage, pickTestToShow, shouldShowTestCard, whenSummary,
  type MyTestRequest, type TestAnswer,
} from "@/lib/test-requests";

const PROMPT_KEY = "test-request";

type Mode = "ask" | "testing" | "answer";

export function TestRequestCard() {
  const { state, pinLocked, peoplePinPrompt, peoplePinSetupPrompt } = useAuth();
  const userId = state.status === "authenticated" ? state.user.id : null;
  const [location, navigate] = useLocation();
  const listQ = useMyTestRequests(userId, !pinLocked);
  const actions = useTesterActions(userId);

  // Re-check the time conditions every minute ("after 2pm").
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  const request = pickTestToShow(listQ.data, now, location);
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
  useEffect(() => { setModeById({}); setThanks(null); }, [userId]);
  useEffect(() => {
    if (!thanks) return;
    const t = window.setTimeout(() => setThanks(null), 4000);
    return () => window.clearTimeout(t);
  }, [thanks]);

  if (thanks && !pinLocked) return <ThanksToast text={thanks} onClose={() => setThanks(null)} />;
  if (!show || !request) return null;

  const mode: Mode = modeById[request.id] ?? (request.startedAt ? "testing" : "ask");
  const setMode = (m: Mode) => setModeById(prev => ({ ...prev, [request.id]: m }));
  const busy = actions.start.isPending || actions.snooze.isPending || actions.answer.isPending;

  const notNow = () => {
    setError(null);
    actions.snooze.mutate(request.id, { onError: e => setError((e as Error).message) });
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
      onSuccess: () => setThanks(answer === "works_easy" ? "Thanks — that's marked as working." : answer === "cant_test" ? "Thanks — we'll sort out who else can test it." : "Thanks — that's gone straight to whoever asked."),
      onError: e => setError((e as Error).message),
    });
  };

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
        <button type="button" onClick={notNow} disabled={busy} aria-label="Not now — ask me later" className="w-11 h-11 rounded-full flex items-center justify-center text-muted-foreground hover:bg-secondary shrink-0">
          {actions.snooze.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <X className="w-5 h-5" />}
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
          onClick={mode === "answer" ? () => setMode(request.startedAt ? "testing" : "ask") : notNow}
          disabled={busy}
          aria-label={mode === "answer" ? "Back" : "Not now — ask me later"}
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
            {request.linkPath && !onLinkedPage(request.linkPath, location) ? (
              <button type="button" onClick={takeMeThere} disabled={busy} className="w-full h-14 rounded-2xl bg-sky-600 text-white text-lg font-bold flex items-center justify-center gap-2 disabled:opacity-60">
                {actions.start.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Navigation className="w-5 h-5" />} Take me there
              </button>
            ) : (
              <button type="button" onClick={takeMeThere} disabled={busy} className="w-full h-14 rounded-2xl bg-sky-600 text-white text-lg font-bold flex items-center justify-center gap-2 disabled:opacity-60">
                {actions.start.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Navigation className="w-5 h-5" />} I'll try it now
              </button>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={notNow} disabled={busy} className="h-14 rounded-2xl border-2 border-border text-base font-bold flex items-center justify-center gap-2 hover:bg-secondary/50 disabled:opacity-60">
                {actions.snooze.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Clock className="w-5 h-5" />} Not now
              </button>
              <button type="button" onClick={() => setMode("answer")} disabled={busy} className="h-14 rounded-2xl border-2 border-sky-500 text-sky-700 dark:text-sky-300 text-base font-bold hover:bg-sky-50 dark:hover:bg-sky-900/30 disabled:opacity-60">
                I've tried it
              </button>
            </div>
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
