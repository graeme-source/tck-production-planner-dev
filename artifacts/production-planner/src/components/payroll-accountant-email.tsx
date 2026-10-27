/**
 * The accountant's email address (Graeme, 2026-10-27) — where a new
 * starter's payroll paperwork goes automatically the moment it's complete.
 * Founder edits it here on Finance → Payroll; the accountants see it read
 * only. Autosaves with a visible state. API: /api/starter-payroll.
 */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Mail } from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const KEY = ["starter-payroll", "accountant-email"] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function jsonOrThrow<T>(r: Response): Promise<T> {
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${r.status}`);
  return body as T;
}

export function PayrollAccountantEmail() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: KEY,
    queryFn: () => fetch(`${BASE}/api/starter-payroll/accountant-email`, { credentials: "include" })
      .then(r => jsonOrThrow<{ email: string | null; canEdit: boolean }>(r)),
  });
  const [value, setValue] = useState("");
  const [state, setState] = useState<"idle" | "dirty" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (q.data && !loaded.current) { setValue(q.data.email ?? ""); loaded.current = true; }
  }, [q.data]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const save = useMutation({
    mutationFn: (email: string) => fetch(`${BASE}/api/starter-payroll/accountant-email`, {
      method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    }).then(r => jsonOrThrow<{ email: string | null }>(r)),
    onSuccess: res => {
      setState("saved"); setError(null);
      qc.setQueryData(KEY, (old: { email: string | null; canEdit: boolean } | undefined) => ({ canEdit: old?.canEdit ?? true, email: res.email }));
      void qc.invalidateQueries({ queryKey: ["starter-payroll", "status"] });
    },
    onError: (e: Error) => { setState("error"); setError(e.message); },
  });

  const trimmed = value.trim();
  const valid = trimmed === "" || EMAIL_RE.test(trimmed);

  function onChange(next: string) {
    setValue(next);
    setState("dirty");
    if (timer.current) clearTimeout(timer.current);
    const t = next.trim();
    // Only a real address (or a cleared box) is saved; anything else waits.
    if (t !== "" && !EMAIL_RE.test(t)) return;
    timer.current = setTimeout(() => { setState("saving"); save.mutate(t); }, 1000);
  }

  if (q.isLoading) return null;
  if (q.error) return <p className="text-sm text-destructive">Couldn't load the accountant's email: {(q.error as Error).message}</p>;
  const canEdit = q.data?.canEdit ?? false;
  const saved = q.data?.email ?? null;

  const chip =
    !valid ? { text: "That doesn't look like an email address yet", cls: "text-destructive" } :
    state === "dirty" ? { text: "Unsaved…", cls: "text-muted-foreground" } :
    state === "saving" ? { text: "Saving…", cls: "text-muted-foreground" } :
    state === "saved" ? { text: "Saved", cls: "text-emerald-600 dark:text-emerald-400" } :
    state === "error" ? { text: `Couldn't save — ${error ?? "try again"}`, cls: "text-destructive" } :
    { text: saved ? "Saved" : "Not set", cls: saved ? "text-muted-foreground" : "text-amber-700 dark:text-amber-400" };

  return (
    <section className="rounded-3xl border-2 border-border bg-card p-4 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Mail className="w-5 h-5 text-primary" />
        <h3 className="text-lg font-bold">Accountant's email</h3>
        <span className={cn("text-sm font-medium inline-flex items-center gap-1", chip.cls)} aria-live="polite">
          {state === "saving" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {state === "saved" && valid && <Check className="w-3.5 h-3.5" />}
          {chip.text}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">
        A new starter's payroll paperwork (HMRC starter checklist, payroll details with their payslip email, and P45 if they have one)
        is emailed here automatically as soon as they've finished it. Never the health questionnaire.
      </p>
      {canEdit ? (
        <input
          type="email" inputMode="email" autoComplete="email" autoCapitalize="none"
          value={value} onChange={e => onChange(e.target.value)}
          placeholder="accountant@example.co.uk"
          className={cn("w-full h-12 px-3 rounded-xl border-2 bg-background text-base", valid ? "border-border" : "border-destructive")}
        />
      ) : (
        <p className="text-base font-semibold break-all">{saved ?? "Not set yet — Graeme sets this."}</p>
      )}
      {!saved && state !== "saving" && (
        <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
          Until this is set, starter paperwork is not sent automatically.
        </p>
      )}
    </section>
  );
}
