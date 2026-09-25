/**
 * Private PIN for the People section (Graeme, 2026-09-24) — /account/people-pin.
 *
 * A second PIN, used ONLY to open People (employee records, reviews,
 * return-to-work forms), so the PIN you type in front of others at a
 * station can't open them. COMPULSORY for anyone with People access
 * (2026-09-25): People stays shut until it's set, and it can be changed but
 * not removed while you have access. Setting or changing it needs your
 * account password. Only shown to people with People access.
 */
import { useState } from "react";
import { Link } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { ChevronLeft, Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useIsRtwManager } from "@/hooks/use-rtw-manager";
import { toast } from "@/hooks/use-toast";

async function post(path: string, body: unknown) {
  const res = await fetch(`/api/auth/${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Couldn't save");
  return data;
}

export default function PeoplePinPage() {
  const { state, refreshUser } = useAuth();
  const canSeePeople = useIsRtwManager();
  const hasPrivatePin = state.status === "authenticated" && !!state.user.hasPrivatePin;
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");

  const reset = () => { setPassword(""); setPin(""); setConfirm(""); };
  const save = useMutation({
    mutationFn: () => post("private-pin/set", { currentPassword: password, pin }),
    onSuccess: async () => {
      reset();
      await refreshUser();
      toast({ title: "Private PIN saved", description: "People now opens with this PIN — never your station PIN." });
    },
    onError: (e: Error) => toast({ title: "Not saved", description: e.message, variant: "destructive" }),
  });

  const pinOk = /^\d{4}$/.test(pin) && pin === confirm;
  const inputCls = "w-full h-14 px-4 rounded-2xl border-2 border-border bg-card text-lg focus:outline-none focus:ring-2 focus:ring-primary/40";

  if (!canSeePeople) {
    return (
      <div className="max-w-lg mx-auto space-y-4">
        <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ChevronLeft className="w-4 h-4" /> Back</Link>
        <p className="text-base text-muted-foreground">This setting is only for people with People access. Graeme switches that on in Settings → Team &amp; Access.</p>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div>
        <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ChevronLeft className="w-4 h-4" /> Back</Link>
        <h1 className="text-3xl font-display font-bold mt-1">Private PIN for People</h1>
        <p className="text-base text-muted-foreground mt-1">
          A second PIN used only to open People — employee records, reviews and return-to-work forms. You need one to
          open People at all. Keep typing your normal PIN at the stations; nobody watching can use it to open People.
        </p>
      </div>

      <div className={`rounded-2xl border-2 p-4 flex items-center gap-3 ${hasPrivatePin ? "border-primary/40 bg-primary/5" : "border-amber-400 bg-amber-50 dark:bg-amber-950/30"}`}>
        {hasPrivatePin ? <ShieldCheck className="w-6 h-6 text-primary" /> : <ShieldAlert className="w-6 h-6 text-amber-600" />}
        <p className="text-base font-semibold">
          {hasPrivatePin ? "Set — People opens with your private PIN." : "Not set yet — People stays shut until you set one."}
        </p>
      </div>

      <div className="space-y-3">
        <label className="block">
          <span className="block text-sm font-semibold mb-1.5">Your account password</span>
          <input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} className={inputCls} />
        </label>
        <label className="block">
          <span className="block text-sm font-semibold mb-1.5">{hasPrivatePin ? "New private PIN" : "Private PIN"} (4 digits, different from your station PIN)</span>
          <input type="password" inputMode="numeric" autoComplete="new-password" maxLength={4} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} className={inputCls} />
        </label>
        <label className="block">
          <span className="block text-sm font-semibold mb-1.5">Type it again</span>
          <input type="password" inputMode="numeric" autoComplete="new-password" maxLength={4} value={confirm} onChange={e => setConfirm(e.target.value.replace(/\D/g, "").slice(0, 4))} className={inputCls} />
        </label>
        {confirm.length === 4 && pin !== confirm && <p className="text-sm text-destructive">The two PINs don't match.</p>}
        <button
          onClick={() => save.mutate()}
          disabled={!password || !pinOk || save.isPending}
          className="w-full h-14 rounded-2xl bg-primary text-primary-foreground text-lg font-bold flex items-center justify-center gap-2 disabled:opacity-40"
        >
          {save.isPending && <Loader2 className="w-5 h-5 animate-spin" />}
          {hasPrivatePin ? "Change private PIN" : "Set private PIN"}
        </button>
        <p className="text-sm text-muted-foreground">
          It can be changed any time but not removed while you have People access.
        </p>
      </div>
    </div>
  );
}
