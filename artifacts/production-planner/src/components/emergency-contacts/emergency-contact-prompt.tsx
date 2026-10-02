/**
 * "Add your emergency contact" (Graeme, 2026-10-02) — the short card
 * everyone without one on file gets at sign-in.
 *
 * When (lib/emergency-contacts.ts, tested): at a sign-in — the app opening
 * signed in, the morning PIN unlock, or someone PIN-switching onto a shared
 * iPad — i.e. the pause before work starts, right after the PIN pad. It
 * never covers the PIN pad, the People PIN prompts, or the kiosk / meeting
 * / print pages.
 *
 * Not skippable for good: "Not now" (or the X) puts it away only until
 * their next sign-in, so it comes back every shift until it's done. But it
 * can never trap anyone: per the house rule every overlay has an explicit
 * close, is capped at 92dvh and scrolls inside.
 */
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { HeartPulse, X } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { INITIAL_SIGN_IN, nextSignIn, shouldShowEmergencyPrompt, type SignInTracker } from "@/lib/emergency-contacts";
import { useMyEmergencyContact, useSaveMyEmergencyContact, toInput } from "./emergency-contacts-api";
import { EmergencyContactForm } from "./emergency-contact-form";

export function EmergencyContactPrompt() {
  const { state, pinLocked, peoplePinPrompt, peoplePinSetupPrompt } = useAuth();
  const [location] = useLocation();
  const userId = state.status === "authenticated" ? state.user.id : null;
  const firstName = state.status === "authenticated" ? state.user.name.split(" ")[0] : "";

  const [tracker, setTracker] = useState<SignInTracker>(INITIAL_SIGN_IN);
  useEffect(() => { setTracker(t => nextSignIn(t, { userId, pinLocked })); }, [userId, pinLocked]);
  const [deferredInEpoch, setDeferredInEpoch] = useState<number | null>(null);

  // Only asked for once signed in and unlocked; the answer is per person.
  const mine = useMyEmergencyContact(userId != null && !pinLocked);
  const save = useSaveMyEmergencyContact();
  const initial = useMemo(() => toInput(null), []);
  const [justSaved, setJustSaved] = useState(false);

  const show = !justSaved && mine.data != null && shouldShowEmergencyPrompt({
    promptNeeded: mine.data.promptNeeded,
    pinLocked,
    otherPromptShowing: peoplePinPrompt || peoplePinSetupPrompt,
    path: location,
    deferredInEpoch,
    epoch: tracker.epoch,
  });
  // Someone else signing in gets their own card.
  useEffect(() => { setJustSaved(false); }, [userId]);

  if (!show) return null;
  const notNow = () => setDeferredInEpoch(tracker.epoch);

  return (
    <div className="fixed inset-0 z-[9990] flex items-center justify-center bg-background/90 backdrop-blur-sm p-3 sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="emergency-contact-prompt-title"
        className="relative w-full max-w-lg max-h-[92dvh] overflow-y-auto bg-card border-2 border-border rounded-3xl p-5 sm:p-7 shadow-xl"
      >
        <button
          onClick={notNow}
          aria-label="Close — ask me next time I sign in"
          className="absolute top-3 right-3 w-11 h-11 rounded-full flex items-center justify-center text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <X className="w-5 h-5" />
        </button>
        <div className="flex flex-col items-center text-center gap-2 mb-5 pt-1">
          <div className="w-14 h-14 rounded-full bg-red-100 dark:bg-red-950/50 flex items-center justify-center">
            <HeartPulse className="w-7 h-7 text-red-600 dark:text-red-400" />
          </div>
          <h2 id="emergency-contact-prompt-title" className="text-2xl font-display font-bold">
            {firstName ? `${firstName}, add your emergency contact` : "Add your emergency contact"}
          </h2>
          <p className="text-base text-muted-foreground">
            If something happens to you at work, who should we call? Only managers can see it, and every time someone looks it's recorded.
          </p>
        </div>
        <EmergencyContactForm
          initial={initial}
          whose="your"
          submitLabel="Save my emergency contact"
          onSave={async data => { await save.mutateAsync(data); setJustSaved(true); }}
        />
        <button onClick={notNow}
          className="mt-3 w-full h-12 rounded-2xl border-2 border-border bg-secondary/40 hover:bg-secondary text-base font-semibold">
          Not now — ask me next time I sign in
        </button>
        <p className="mt-3 text-sm text-muted-foreground text-center">You can change it any time from your account menu → My emergency contact.</p>
      </div>
    </div>
  );
}
