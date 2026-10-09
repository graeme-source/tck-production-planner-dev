/**
 * "The orange tab on the right now swipes out" — a short guided pop-up the
 * first time each person loads the app after the swipe panel shipped
 * (Graeme, 2026-10-09; Objective H). Steps and when it shows: pure, in
 * lib/swipe-tour.ts.
 *
 * A small floating card, never a full-screen blocker: the person has to be
 * able to reach the tab to try it. Closable at every step (X); "Show me
 * later" and the X put it away until the next page load; reaching the end
 * saves it against the PERSON (/api/user-tours), so it never comes back on
 * any device. Mounted inside QuickActionsDock, so it is never on the
 * visitor kiosk or print views (no dock there) and never for accountants.
 */
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { CheckCircle2, Hand, Loader2, X } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useCompleteTour, useCompletedTours } from "@/hooks/use-user-tours";
import { nextTourStep, shouldShowTour, SWIPE_TOUR_KEY, type TourEvent, type TourStep } from "@/lib/swipe-tour";
import { useAnyPromptShowing, useFullScreenOverlayShowing } from "@/lib/prompt-presence";

/** "Show me later" lasts for this page load only. */
let laterThisLoad = false;

export function useSwipePanelTour(panelOpen: boolean) {
  const { state, pinLocked, peoplePinPrompt, peoplePinSetupPrompt } = useAuth();
  const [location] = useLocation();
  const promptShowing = useAnyPromptShowing();
  const userId = state.status === "authenticated" ? state.user.id : null;
  const completedQ = useCompletedTours(userId, !pinLocked);
  const [later, setLater] = useState(laterThisLoad);
  const [step, setStep] = useState<TourStep>("intro");
  const [finished, setFinished] = useState(false);
  // Any other full-screen pop-up (new to-do, messages…) — wait for it. Not
  // while the tour is running or the panel is open (those are ours).
  const overlayShowing = useFullScreenOverlayShowing(!panelOpen && step === "intro");
  // Someone else signing in on this iPad starts at the beginning.
  useEffect(() => { setStep("intro"); setFinished(false); }, [userId]);

  const active = !finished && (step === "done" || shouldShowTour({
    completed: completedQ.data,
    laterThisLoad: later,
    pinLocked,
    otherPromptShowing: peoplePinPrompt || peoplePinSetupPrompt || promptShowing || overlayShowing,
    path: location,
  }));

  const send = (e: TourEvent) => setStep(s => nextTourStep(s, e));
  // Follow the panel: opened while trying → step on; shut while "swipe it
  // away" → done.
  useEffect(() => {
    if (!active) return;
    send(panelOpen ? "panel_opened" : "panel_closed");
  }, [panelOpen, active]);

  const putOff = () => { laterThisLoad = true; setLater(true); };
  return { active: active && !later, step, userId, start: () => send("start"), putOff, finish: () => setFinished(true) };
}

export function SwipePanelTourCard({ tour }: { tour: ReturnType<typeof useSwipePanelTour> }) {
  const onFinished = tour.finish;
  const complete = useCompleteTour(tour.userId);
  const { step } = tour;
  // Save the moment they've done it — closing the last card can't lose it.
  useEffect(() => {
    if (step === "done" && !complete.isPending && !complete.isSuccess && !complete.isError) complete.mutate(SWIPE_TOUR_KEY);
  }, [step, complete]);

  if (!tour.active) return null;

  const close = () => {
    if (step === "done") { if (complete.isSuccess) onFinished(); else complete.mutate(SWIPE_TOUR_KEY, { onSuccess: onFinished }); return; }
    tour.putOff();
  };

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="swipe-tour-title"
      className="fixed z-[100] left-3 right-3 bottom-4 sm:left-6 sm:right-auto sm:bottom-6 sm:w-[26rem] max-h-[92dvh] overflow-y-auto rounded-3xl border-2 border-orange-400 bg-card shadow-2xl p-5"
    >
      <button
        type="button"
        onClick={close}
        aria-label={step === "done" ? "Close" : "Close — show me later"}
        className="absolute top-3 right-3 w-11 h-11 rounded-full flex items-center justify-center text-muted-foreground hover:bg-secondary hover:text-foreground"
      >
        <X className="w-5 h-5" />
      </button>

      {step === "intro" && (
        <>
          <SwipeDemo />
          <h2 id="swipe-tour-title" className="mt-4 text-2xl font-display font-bold pr-10">The orange tab on the right now swipes out</h2>
          <p className="mt-1 text-base text-muted-foreground">Grab it and drag it left to open your quick actions — to-dos, improvements, issues, defects & waste and more. Swipe it back to put it away.</p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button type="button" onClick={tour.putOff} className="h-14 rounded-2xl border-2 border-border text-lg font-bold hover:bg-secondary/50">Show me later</button>
            <button type="button" onClick={tour.start} className="h-14 rounded-2xl bg-orange-500 text-white text-lg font-bold hover:bg-orange-600">Try it now</button>
          </div>
        </>
      )}

      {step === "try" && (
        <div className="flex items-start gap-3 pr-10">
          <Hand className="w-9 h-9 text-orange-500 shrink-0 -scale-x-100" />
          <div>
            <h2 id="swipe-tour-title" className="text-xl font-bold">Try it now</h2>
            <p className="text-base text-muted-foreground">Put your finger on the flashing orange tab on the right and drag it to the left.</p>
          </div>
        </div>
      )}

      {step === "swipe_away" && (
        <div className="flex items-start gap-3 pr-10">
          <Hand className="w-9 h-9 text-orange-500 shrink-0" />
          <div>
            <h2 id="swipe-tour-title" className="text-xl font-bold">Now swipe it away</h2>
            <p className="text-base text-muted-foreground">Drag the panel back to the right to put it away.</p>
          </div>
        </div>
      )}

      {step === "done" && (
        <>
          <div className="flex items-start gap-3 pr-10">
            <CheckCircle2 className="w-9 h-9 text-emerald-600 shrink-0" />
            <div>
              <h2 id="swipe-tour-title" className="text-xl font-bold">Done — you've got it</h2>
              <p className="text-base text-muted-foreground">Drag the orange tab out whenever you need it. You won't see this again.</p>
            </div>
          </div>
          {complete.isError && (
            <p className="mt-3 text-base font-semibold text-destructive">Couldn't save that you've done it — {(complete.error as Error).message}. Tap Got it to try again.</p>
          )}
          <button
            type="button"
            onClick={close}
            disabled={complete.isPending}
            className="mt-4 w-full h-14 rounded-2xl bg-primary text-primary-foreground text-lg font-bold flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {complete.isPending && <Loader2 className="w-5 h-5 animate-spin" />} Got it
          </button>
        </>
      )}
    </div>
  );
}

/** A little looping picture: a finger drags the orange tab left and the panel follows. */
function SwipeDemo() {
  return (
    <div className="relative mx-auto h-28 w-52 overflow-hidden rounded-2xl border-2 border-border bg-secondary/40" aria-hidden="true">
      {/* page lines */}
      <div className="absolute left-3 top-3 right-12 space-y-2">
        <div className="h-2 rounded bg-muted-foreground/20" />
        <div className="h-2 w-3/4 rounded bg-muted-foreground/20" />
        <div className="h-2 w-1/2 rounded bg-muted-foreground/20" />
      </div>
      {/* the panel, with the tab on its left edge */}
      <div className="swipe-demo-panel absolute top-0 bottom-0 right-0 w-[118px] bg-card border-l border-border">
        <div className="absolute -left-4 top-1/2 -translate-y-1/2 h-12 w-4 rounded-l-lg bg-orange-500" />
        <div className="m-2 space-y-1.5">
          <div className="h-4 rounded-md bg-primary/30" />
          <div className="h-4 rounded-md bg-blue-400/40" />
          <div className="h-4 rounded-md bg-amber-500/40" />
        </div>
      </div>
      {/* the finger */}
      <div className="swipe-demo-finger absolute top-1/2 right-[2px] -mt-3 h-6 w-6 rounded-full bg-foreground/70 ring-4 ring-foreground/20" />
    </div>
  );
}
