/**
 * The People section's private-PIN prompt (Graeme, 2026-09-24).
 *
 * Shown instead of the station lock when someone who has set a private PIN
 * opens a People page (employee records, reviews, return-to-work). It asks
 * for the PRIVATE PIN — never the one typed at stations — and "Not now"
 * always gets them out (back to the dashboard), so it can never trap anyone.
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { ShieldCheck } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { PinNumpad } from "@/components/pin-numpad";

export function PeoplePinOverlay() {
  const { verifyPeoplePin, cancelPeoplePin } = useAuth();
  const [, navigate] = useLocation();
  const [error, setError] = useState("");
  const [lockedUntil, setLockedUntil] = useState<string | undefined>();
  const [remainingSeconds, setRemainingSeconds] = useState<number | undefined>();

  const onComplete = async (pin: string) => {
    setError("");
    const r = await verifyPeoplePin(pin);
    if (r.error) {
      setError(r.error);
      if (r.lockedUntil) { setLockedUntil(r.lockedUntil); setRemainingSeconds(r.remainingSeconds); }
    }
  };

  return (
    // Same stacking and pointer-events rule as the station PIN overlay.
    <div className="pointer-events-auto fixed inset-0 z-[9999] flex items-center justify-center bg-background/95 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm max-h-[92dvh] overflow-y-auto bg-card border border-border rounded-2xl p-6 shadow-sm" role="dialog" aria-modal="true" aria-labelledby="people-pin-title">
        <div className="flex flex-col items-center gap-1 mb-6 text-center">
          <div className="flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 mb-2">
            <ShieldCheck className="w-6 h-6 text-primary" />
          </div>
          <h2 id="people-pin-title" className="text-lg font-bold">People — private PIN</h2>
          <p className="text-sm text-muted-foreground">
            Enter your <span className="font-semibold text-foreground">private</span> PIN — not the one you use at the stations.
          </p>
        </div>
        <PinNumpad
          onComplete={onComplete}
          error={error}
          lockedUntil={lockedUntil}
          remainingSeconds={remainingSeconds}
          label="Enter your private PIN"
        />
        <button
          onClick={() => { cancelPeoplePin(); navigate("/"); }}
          className="mt-5 w-full py-3 rounded-xl border-2 border-border bg-secondary/40 hover:bg-secondary text-sm font-semibold transition-colors"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
