import { useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { PinNumpad } from "@/components/pin-numpad";
import { UserAvatar } from "@/components/user-avatar";
import { Lock } from "lucide-react";

export function PinLockOverlay() {
  const { state, verifyPin, logout } = useAuth();
  const [pinError, setPinError] = useState("");
  const [pinLockedUntil, setPinLockedUntil] = useState<string | undefined>();
  const [pinRemainingSeconds, setPinRemainingSeconds] = useState<number | undefined>();

  const user = state.status === "authenticated" ? state.user : null;

  const handlePinComplete = async (pin: string) => {
    setPinError("");
    const result = await verifyPin(pin);
    if (result.error) {
      setPinError(result.error);
      if (result.lockedUntil) {
        setPinLockedUntil(result.lockedUntil);
        setPinRemainingSeconds(result.remainingSeconds);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-background/95 backdrop-blur-sm">
      <div className="w-full max-w-sm px-4">
        <div className="flex flex-col items-center gap-2 mb-8">
          <img
            src={`${import.meta.env.BASE_URL}tck-logo-dark.png`}
            alt="The Calzone Kitchen"
            className="h-16 w-auto object-contain"
          />
        </div>

        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
          <div className="flex flex-col items-center gap-1 mb-6">
            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary/10 mb-2">
              <Lock className="w-5 h-5 text-primary" />
            </div>
            {user && (
              <div className="flex flex-col items-center gap-1">
                <UserAvatar name={user.name} avatarUrl={user.avatarUrl} size="md" />
                <p className="text-sm font-semibold mt-1">{user.name}</p>
                <p className="text-xs text-muted-foreground capitalize">{user.role}</p>
              </div>
            )}
            <p className="text-sm text-muted-foreground mt-2 text-center">
              Station locked. Enter your PIN to continue.
            </p>
          </div>

          <PinNumpad
            onComplete={handlePinComplete}
            error={pinError}
            lockedUntil={pinLockedUntil}
            remainingSeconds={pinRemainingSeconds}
            label="Enter your 4-digit PIN"
          />

          <div className="mt-5">
            <button
              onClick={() => logout()}
              className="w-full py-3 rounded-xl border-2 border-border bg-secondary/40 hover:bg-secondary text-sm font-semibold text-foreground transition-colors active:scale-[0.98]"
            >
              Sign in as a different user
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
