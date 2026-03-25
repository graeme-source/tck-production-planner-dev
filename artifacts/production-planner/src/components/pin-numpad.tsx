import { useState, useEffect, useCallback } from "react";
import { Delete, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface PinNumpadProps {
  onComplete: (pin: string) => Promise<void>;
  error?: string;
  lockedUntil?: string;
  remainingSeconds?: number;
  onError?: (msg: string) => void;
  loading?: boolean;
  label?: string;
}

export function PinNumpad({
  onComplete,
  error,
  lockedUntil,
  remainingSeconds: initialRemaining,
  loading = false,
  label = "Enter your PIN",
}: PinNumpadProps) {
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(initialRemaining ?? null);

  useEffect(() => {
    if (lockedUntil) {
      const target = new Date(lockedUntil).getTime();
      const tick = () => {
        const remaining = Math.ceil((target - Date.now()) / 1000);
        if (remaining <= 0) {
          setCountdown(null);
        } else {
          setCountdown(remaining);
        }
      };
      tick();
      const id = setInterval(tick, 1000);
      return () => clearInterval(id);
    } else {
      setCountdown(null);
    }
  }, [lockedUntil]);

  const handleDigit = useCallback(async (digit: string) => {
    if (submitting || loading || countdown !== null) return;
    const newPin = pin + digit;
    setPin(newPin);
    if (newPin.length === 4) {
      setSubmitting(true);
      await onComplete(newPin);
      setSubmitting(false);
      setPin("");
    }
  }, [pin, submitting, loading, countdown, onComplete]);

  const handleDelete = useCallback(() => {
    if (submitting || loading) return;
    setPin(p => p.slice(0, -1));
  }, [submitting, loading]);

  const handleClear = useCallback(() => {
    if (submitting || loading) return;
    setPin("");
  }, [submitting, loading]);

  const isLocked = countdown !== null && countdown > 0;
  const isDisabled = submitting || loading || isLocked;

  const minutes = countdown !== null ? Math.floor(countdown / 60) : 0;
  const seconds = countdown !== null ? countdown % 60 : 0;

  const digits = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"];

  return (
    <div className="flex flex-col items-center gap-6 w-full">
      <p className="text-sm text-muted-foreground text-center">{label}</p>

      <div className="flex gap-3">
        {[0, 1, 2, 3].map(i => (
          <div
            key={i}
            className={cn(
              "w-3.5 h-3.5 rounded-full border-2 transition-all duration-150",
              pin.length > i
                ? "bg-primary border-primary scale-110"
                : "border-border bg-background"
            )}
          />
        ))}
      </div>

      {isLocked && (
        <div className="text-center text-sm text-destructive bg-destructive/10 rounded-lg px-4 py-2">
          Too many failed attempts. Try again in{" "}
          <span className="font-mono font-bold">
            {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
          </span>
        </div>
      )}

      {error && !isLocked && (
        <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-lg text-center">
          {error}
        </p>
      )}

      <div className="grid grid-cols-3 gap-3 w-full max-w-xs">
        {digits.map((digit, idx) => {
          if (digit === "") {
            return <div key={idx} />;
          }
          if (digit === "del") {
            return (
              <button
                key={idx}
                onClick={handleDelete}
                disabled={isDisabled || pin.length === 0}
                className={cn(
                  "flex items-center justify-center h-14 rounded-xl font-medium text-lg transition-all duration-150",
                  "bg-secondary/60 hover:bg-secondary text-foreground active:scale-95",
                  "disabled:opacity-40 disabled:cursor-not-allowed"
                )}
                aria-label="Delete"
              >
                <Delete className="w-5 h-5" />
              </button>
            );
          }
          return (
            <button
              key={digit}
              onClick={() => handleDigit(digit)}
              disabled={isDisabled}
              className={cn(
                "flex items-center justify-center h-14 rounded-xl font-semibold text-xl transition-all duration-150",
                "bg-secondary/60 hover:bg-secondary text-foreground active:scale-95 active:bg-primary/20",
                "disabled:opacity-40 disabled:cursor-not-allowed"
              )}
            >
              {(submitting || loading) && pin.length === 4 && digit === pin[3] ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : digit}
            </button>
          );
        })}
      </div>

      {pin.length > 0 && !submitting && (
        <button
          onClick={handleClear}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Clear
        </button>
      )}
    </div>
  );
}
