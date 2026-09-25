/**
 * "Set your private PIN to open People" (Graeme, 2026-09-25).
 *
 * Shown instead of any PIN prompt when someone with People access opens a
 * People page before they've set their private PIN. The private PIN is
 * compulsory for them — the station PIN never opens People — so there is
 * nothing to type here: the only ways on are to set the PIN (the button IS
 * the link to /account/people-pin) or to close the card, which takes them
 * back to the dashboard. It can never trap anyone: explicit X, a "Not now"
 * button, capped at 92dvh with internal scroll.
 */
import { Link, useLocation } from "wouter";
import { KeyRound, X } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";

export function PeoplePinSetupCard() {
  const { closePeoplePinSetup } = useAuth();
  const [, navigate] = useLocation();

  const close = () => { closePeoplePinSetup(); navigate("/"); };

  return (
    <div className="pointer-events-auto fixed inset-0 z-[9999] flex items-center justify-center bg-background/95 backdrop-blur-sm p-4">
      <div
        className="relative w-full max-w-md max-h-[92dvh] overflow-y-auto bg-card border border-border rounded-3xl p-6 sm:p-8 shadow-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="people-pin-setup-title"
      >
        <button
          onClick={close}
          aria-label="Close"
          className="absolute top-3 right-3 w-11 h-11 rounded-full flex items-center justify-center text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex flex-col items-center text-center gap-2 mb-6 pt-2">
          <div className="flex items-center justify-center w-14 h-14 rounded-full bg-primary/10 mb-1">
            <KeyRound className="w-7 h-7 text-primary" />
          </div>
          <h2 id="people-pin-setup-title" className="text-2xl font-display font-bold">Set your private PIN to open People</h2>
          <p className="text-base text-muted-foreground">
            People holds everyone's records, so it has its own PIN — different from the one you type at the stations.
            You only need to set it once. It takes a minute and needs your account password.
          </p>
        </div>

        <Link
          href="/account/people-pin"
          onClick={closePeoplePinSetup}
          className="w-full h-14 rounded-2xl bg-primary text-primary-foreground text-lg font-bold flex items-center justify-center"
        >
          Set your private PIN
        </Link>
        <button
          onClick={close}
          className="mt-3 w-full h-12 rounded-2xl border-2 border-border bg-secondary/40 hover:bg-secondary text-base font-semibold transition-colors"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
