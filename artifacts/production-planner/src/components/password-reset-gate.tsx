import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useAuth } from "@/contexts/auth-context";
import { UserAvatar } from "@/components/user-avatar";
import { PASSWORD_RULES, validatePassword } from "@/lib/password-policy";
import { toast } from "@/hooks/use-toast";
import { AlertTriangle, Check, KeyRound, Loader2, ShieldAlert, X } from "lucide-react";

/**
 * Forced password reset with a 24-hour grace period.
 *
 * While the user's passwordResetDeadline is in the future, a warning stripe
 * sits at the top of the app with a live countdown and a "Reset now" button.
 * Once the deadline passes, a full-screen blocker (same treatment as the PIN
 * lock overlay) forces the change before the app can be used. Changing the
 * password clears the deadline server-side; refreshUser() then removes the
 * gate. Users with no deadline (the founder, anyone who already reset) render
 * nothing.
 */
export function PasswordResetGate() {
  const { state, refreshUser, logout } = useAuth();
  const [modalOpen, setModalOpen] = useState(false);
  // Re-render every 30s so the countdown ticks and the banner flips to the
  // blocker at the exact deadline without needing a page reload.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const user = state.status === "authenticated" ? state.user : null;
  const deadline = user?.passwordResetDeadline ? new Date(user.passwordResetDeadline).getTime() : null;

  if (!user || !deadline) return null;

  const expired = now >= deadline;

  if (expired) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center overflow-y-auto bg-background/95 backdrop-blur-sm">
        <div className="w-full max-w-sm px-4 py-8">
          <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
            <div className="flex flex-col items-center gap-1 mb-5">
              <div className="flex items-center justify-center w-10 h-10 rounded-full bg-destructive/10 mb-2">
                <ShieldAlert className="w-5 h-5 text-destructive" />
              </div>
              <UserAvatar name={user.name} avatarUrl={user.avatarUrl} size="md" />
              <p className="text-sm font-semibold mt-1">{user.name}</p>
              <p className="text-sm text-muted-foreground mt-2 text-center">
                Your password reset deadline has passed. Set a new password to continue.
              </p>
            </div>
            <ChangePasswordForm onSuccess={refreshUser} />
            <div className="mt-4">
              <button
                onClick={() => logout()}
                className="w-full py-3 rounded-xl border-2 border-border bg-secondary/40 hover:bg-secondary text-sm font-semibold text-foreground transition-colors active:scale-[0.98]"
              >
                Sign in as a different user
              </button>
              <p className="text-xs text-muted-foreground text-center mt-3">
                Forgotten your password? Sign out and use “Forgot password” on the login screen.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="bg-amber-500 text-amber-950 px-4 py-2 text-sm font-semibold flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center border-b-2 border-amber-600">
        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
        <span>
          In {formatTimeLeft(deadline - now)}, you will be forced to reset your password. Please do
          it now or as soon as possible to avoid losing access.
        </span>
        <button
          onClick={() => setModalOpen(true)}
          className="ml-1 px-3 py-1 rounded-lg bg-amber-950 text-amber-50 text-xs font-bold hover:bg-amber-900 transition-colors active:scale-[0.98]"
        >
          Reset now
        </button>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center overflow-y-auto bg-background/80 backdrop-blur-sm">
          <div className="w-full max-w-sm px-4 py-8">
            <div className="bg-card border border-border rounded-2xl p-6 shadow-sm relative">
              <button
                onClick={() => setModalOpen(false)}
                className="absolute top-3 right-3 p-2 rounded-lg hover:bg-secondary text-muted-foreground"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
              <div className="flex flex-col items-center gap-1 mb-5">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary/10 mb-2">
                  <KeyRound className="w-5 h-5 text-primary" />
                </div>
                <p className="text-sm font-semibold">Set a new password</p>
              </div>
              <ChangePasswordForm
                onSuccess={async () => {
                  setModalOpen(false);
                  await refreshUser();
                }}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function formatTimeLeft(ms: number): string {
  const totalMinutes = Math.max(1, Math.ceil(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours >= 2) return `${hours} hours`;
  if (hours === 1) return minutes > 0 ? `1 hour ${minutes} minutes` : `1 hour`;
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

function ChangePasswordForm({ onSuccess }: { onSuccess: () => void | Promise<void> }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const ruleResults = useMemo(
    () => PASSWORD_RULES.map((r) => ({ label: r.label, ok: r.test(newPassword) })),
    [newPassword],
  );

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");

    if (!currentPassword) { setError("Enter your current password."); return; }
    const policyError = validatePassword(newPassword);
    if (policyError) { setError(policyError); return; }
    if (newPassword !== confirm) { setError("New passwords don't match."); return; }

    setSaving(true);
    try {
      const res = await fetch("/api/auth/password/change", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (res.ok) {
        toast({ title: "Password updated", description: "Your new password is now active." });
        await onSuccess();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to change password.");
      }
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1">Current password</label>
        <input
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          autoComplete="current-password"
          className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1">New password</label>
        <input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
          className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1">Confirm new password</label>
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>

      <ul className="space-y-1 pt-1">
        {ruleResults.map((r) => (
          <li key={r.label} className={`flex items-center gap-2 text-xs ${r.ok ? "text-primary" : "text-muted-foreground"}`}>
            {r.ok ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
            {r.label}
          </li>
        ))}
      </ul>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <button
        type="submit"
        disabled={saving}
        className="w-full py-3 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors active:scale-[0.98] disabled:opacity-60 flex items-center justify-center gap-2"
      >
        {saving && <Loader2 className="w-4 h-4 animate-spin" />}
        Save new password
      </button>
    </form>
  );
}
