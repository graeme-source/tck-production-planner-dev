import { useState, useEffect, type FormEvent } from "react";
import { useLocation, useSearch } from "wouter";
import { Loader2, CheckCircle2 } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function AcceptInvite() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const token = new URLSearchParams(search).get("token") ?? "";

  const [invite, setInvite] = useState<{ email: string; role: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) { setError("Invalid invite link."); setLoading(false); return; }
    fetch(`${BASE}/api/auth/invites/${token}`, { credentials: "include" })
      .then(r => r.json())
      .then(data => {
        if (data.error) { setError(data.error); }
        else { setInvite(data); }
        setLoading(false);
      })
      .catch(() => { setError("Failed to validate invite."); setLoading(false); });
  }, [token]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) { setError("Passwords do not match."); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    setSaving(true);
    setError("");
    const res = await fetch(`${BASE}/api/auth/invites/${token}/accept`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, password }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) { setError(data.error ?? "Failed to create account."); return; }
    setDone(true);
    setTimeout(() => setLocation("/"), 2000);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-2 mb-8">
          <img src={`${BASE}/tck-logo-dark.png`} alt="TCK" className="h-20 w-auto object-contain" />
          <span className="text-xs text-muted-foreground tracking-widest uppercase font-medium">Production Planner</span>
        </div>

        <div className="bg-card border border-border rounded-2xl p-8 shadow-sm">
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary/50" /></div>
          ) : done ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <CheckCircle2 className="w-10 h-10 text-green-600" />
              <p className="font-semibold text-lg">Account created!</p>
              <p className="text-sm text-muted-foreground">Taking you to the dashboard…</p>
            </div>
          ) : error && !invite ? (
            <div className="text-center py-6">
              <p className="text-sm text-destructive bg-destructive/10 px-4 py-3 rounded-lg mb-4">{error}</p>
              <a href={`${BASE}/`} className="text-sm text-muted-foreground hover:text-foreground">Back to sign in</a>
            </div>
          ) : (
            <>
              <h1 className="text-xl font-semibold mb-1">Set up your account</h1>
              <p className="text-sm text-muted-foreground mb-6">
                You've been invited as <strong>{invite?.role}</strong> for {invite?.email}
              </p>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Your name</label>
                  <input type="text" value={name} onChange={e => setName(e.target.value)} required minLength={2}
                    placeholder="e.g. Jordan Smith"
                    className="w-full px-3 py-2.5 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Password</label>
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
                  {saving ? "Creating account…" : "Create account"}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
