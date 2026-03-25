import { useState } from "react";
import { Loader2, KeyRound, CheckCircle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PinNumpad } from "./pin-numpad";

interface PinSetupModalProps {
  user: { id: number; name: string };
  onClose: () => void;
  onComplete?: () => void;
  required?: boolean;
}

type Step = "enter" | "confirm" | "done";

export function PinSetupModal({ user, onClose, onComplete, required = false }: PinSetupModalProps) {
  const [step, setStep] = useState<Step>("enter");
  const [firstPin, setFirstPin] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const handleFirstPin = async (pin: string) => {
    setFirstPin(pin);
    setError("");
    setStep("confirm");
  };

  const handleConfirmPin = async (pin: string) => {
    if (pin !== firstPin) {
      setError("PINs don't match. Please try again.");
      setStep("enter");
      setFirstPin("");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/auth/pin/set", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });

      if (res.ok) {
        setStep("done");
        setTimeout(() => {
          onComplete?.();
          onClose();
        }, 1500);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to set PIN");
        setStep("enter");
        setFirstPin("");
      }
    } catch {
      setError("Network error. Please try again.");
      setStep("enter");
      setFirstPin("");
    } finally {
      setSaving(false);
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open && !required) {
      onClose();
    }
  };

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-sm"
        onPointerDownOutside={required ? (e) => e.preventDefault() : undefined}
        onEscapeKeyDown={required ? (e) => e.preventDefault() : undefined}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-primary" />
            Set up your PIN
          </DialogTitle>
        </DialogHeader>

        {required && (
          <p className="text-sm font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 rounded-md px-3 py-2">
            A 4-digit PIN is required to use quick sign-in on this device.
          </p>
        )}

        <p className="text-sm text-muted-foreground">
          Create a 4-digit PIN for quick sign-in on this device, {user.name}.
        </p>

        {step === "enter" && (
          <PinNumpad
            onComplete={handleFirstPin}
            error={error}
            label="Choose a 4-digit PIN"
          />
        )}

        {step === "confirm" && (
          <PinNumpad
            onComplete={handleConfirmPin}
            label="Confirm your PIN"
            loading={saving}
          />
        )}

        {step === "done" && (
          <div className="flex flex-col items-center gap-3 py-6">
            <CheckCircle className="w-12 h-12 text-green-500" />
            <p className="text-sm font-medium">PIN set successfully!</p>
          </div>
        )}

        {step !== "done" && !required && (
          <button
            onClick={onClose}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors text-center w-full mt-2"
          >
            Skip for now
          </button>
        )}
      </DialogContent>
    </Dialog>
  );
}
