import { useState, useEffect, type FormEvent } from "react";
import { useSearch } from "wouter";
import { Loader2, CheckCircle2 } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function ResetPassword() {
  const search = useSearch();
  const token = new URLSearchParams(search).get("token") ?? "";

  const [valid, setValid] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) { setValid(false); return; }
    fetch(`${BASE}/api/auth/reset-password/${token}`, { credentials: "include" })
      .then(r => setValid(r.ok))
      .catch(() => setValid(false));
  }, [token]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) { setError("Passwords do not match."); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    setSaving(true);
    setError("");
    const res = await fetch(`${BASE}/api/auth/reset-password/${token}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) { setError(data.error ?? "Failed to reset password."); return; }
    setDone(true);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-2 mb-8">
          <img src={`${BASE}/tck-logo-dark.png`} alt="TCK" className="h-20 w-auto object-contain" />
          <span className="text-xs text-muted-foreground tracking-widest uppercase font-medium">Production Planner</span>
        </div>

        <div className="bg-card border border-border rounded-2xl p-8 shadow-sm">
          {valid === null ? (
            <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary/50" /></div>
          ) : !valid ? (
            <div className="text-center py-6">
              <p className="text-sm text-destructive bg-destructive/10 px-4 py-3 rounded-lg mb-4">
                This reset link is invalid or has expired. Please request a new one.
              </p>
              <a href={`${BASE}/forgot-password`} className="text-sm text-primary hover:underline">Request new link</a>
            </div>
          ) : done ? (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <CheckCircle2 className="w-10 h-10 text-green-600" />
              <p className="font-semibold text-lg">Password updated!</p>
              <p className="text-sm text-muted-foreground">You can now sign in with your new password.</p>
              <a href={`${BASE}/`} className="text-sm text-primary hover:underline mt-2">Sign in</a>
            </div>
          ) : (
            <>
              <h1 className="text-xl font-semibold mb-1">Choose a new password</h1>
              <p className="text-sm text-muted-foreground mb-6">Must be at least 8 characters.</p>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-1.5 block">New password</label>
                  <input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={8}
                    placeholder="Min. 8 characters"
                    className="w-full px-3 py-2.5 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Confirm password</label>
                  <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required
                    placeholder="Repeat password"
                    className="w-full px-3 py-2.5 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
                {error && <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-lg">{error}</p>}
                <button type="submit" disabled={saving}
                  className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  {saving ? "Updating…" : "Update password"}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
