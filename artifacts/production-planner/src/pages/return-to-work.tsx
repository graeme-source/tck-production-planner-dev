/**
 * My return-to-work forms (Graeme, 2026-09-14; any absence 2026-09-25). A
 * colleague completes the form WITH a manager after a spell of absence —
 * sickness, dependants' or emergency leave, unexplained absence; never
 * holiday. Privacy: only the colleague and people with People access can see
 * the content — the server enforces it; this page just shows what it's
 * allowed.
 *
 * This page is always YOUR OWN forms, whoever you are — it's where the chase
 * to-do sends a colleague. Everyone else's forms live on each person's record
 * in People (/people/<id>): Graeme opened this page expecting everyone's,
 * saw only his own (none) and concluded there were no forms at all. So a
 * People-access user here sees a clear link to the outstanding ones, and the
 * old manager link /return-to-work?user=<id> now goes to that person's record.
 */
import { useState } from "react";
import { Link, Redirect, useSearch } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, HeartPulse, CheckCircle2, Lock, PenLine, UsersRound, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useSensitivePinGate } from "@/hooks/use-sensitive-pin-gate";
import { useIsRtwManager } from "@/hooks/use-rtw-manager";
import { FormEditor, fmtRange, type RtwForm } from "@/components/rtw-form-editor";
import { absencePhrase } from "@/lib/rtw-wording";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface DueSpell {
  start: string;
  end: string;
  days: number;
  types: string[];
  sickness: boolean;
}

interface MineResponse {
  forms: RtwForm[];
  due: DueSpell[];
  isRtwManager: boolean;
  /** People-access only: how many forms OTHER people owe (count, no names). */
  othersOutstanding?: number;
}

export default function ReturnToWorkPage() {
  const search = useSearch();
  const isPeopleManager = useIsRtwManager();
  const forUser = new URLSearchParams(search).get("user");
  // Health data on shared and personally-lent iPads: ask for the PIN on
  // entry, admins included — same posture as the Employee Hub.
  useSensitivePinGate({ includeAdmins: true, entryKey: "return-to-work", scope: "people" });
  const queryClient = useQueryClient();
  const [openForm, setOpenForm] = useState<RtwForm | null>(null);
  const [starting, setStarting] = useState(false);

  const { data: mine, isLoading } = useQuery<MineResponse>({
    queryKey: ["rtw-mine"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/return-to-work/mine`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
  });

  // Old manager links (chase to-dos raised before 2026-09-25, the Employee
  // Records modal) → that person's record, where their forms now live.
  if (isPeopleManager && forUser != null && /^\d+$/.test(forUser)) {
    return <Redirect to={`/people/${forUser}`} replace />;
  }

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["rtw-mine"] });

  const startForm = async (spell: DueSpell) => {
    setStarting(true);
    try {
      const r = await fetch(`${BASE}/api/return-to-work`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ absenceStart: spell.start, absenceEnd: spell.end, absenceType: spell.types.join(" + ") || null }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Failed");
      const fr = await fetch(`${BASE}/api/return-to-work/form/${d.id}`, { credentials: "include" });
      if (!fr.ok) throw new Error("Couldn't open the form");
      setOpenForm(await fr.json());
      refresh();
    } catch (err) {
      toast({ title: "Couldn't open the form", description: err instanceof Error ? err.message : "Try again", variant: "destructive" });
    } finally {
      setStarting(false);
    }
  };

  const openExisting = async (id: number) => {
    const r = await fetch(`${BASE}/api/return-to-work/form/${id}`, { credentials: "include" });
    if (r.ok) setOpenForm(await r.json());
    else toast({ title: "Couldn't open the form", description: "Try again", variant: "destructive" });
  };

  if (isLoading) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  if (openForm) {
    return (
      <div className="max-w-2xl mx-auto pb-24">
        <FormEditor form={openForm} isRtwManager={mine?.isRtwManager === true} onBack={() => { setOpenForm(null); refresh(); }} onDone={() => { setOpenForm(null); refresh(); }} />
      </div>
    );
  }

  const forms = mine?.forms ?? [];
  const due = mine?.due ?? [];
  const others = mine?.othersOutstanding ?? 0;

  return (
    <div className="max-w-2xl mx-auto pb-24 space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl bg-rose-100 dark:bg-rose-950/40 flex items-center justify-center">
          <HeartPulse className="w-6 h-6 text-rose-600" />
        </div>
        <div>
          <h1 className="font-display font-bold text-2xl leading-tight">My return-to-work forms</h1>
          <p className="text-sm text-muted-foreground flex items-center gap-1"><Lock className="w-3 h-3" /> Private — you and people with People access only.</p>
        </div>
      </div>

      {mine?.isRtwManager && (
        <Link
          href="/people"
          className="block rounded-2xl border-2 border-primary/40 bg-primary/5 hover:border-primary active:scale-[0.995] transition-all p-5"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
              <UsersRound className="w-6 h-6 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xl font-bold leading-snug">
                Everyone's outstanding forms{others > 0 ? ` (${others})` : ""} → People
              </p>
              <p className="text-base text-muted-foreground mt-0.5">
                {others > 0
                  ? "Each person's forms, absences and reviews are on their record."
                  : "Nobody else owes a form right now. Each person's record is in People."}
              </p>
            </div>
            <ChevronRight className="w-6 h-6 text-muted-foreground shrink-0" />
          </div>
        </Link>
      )}

      {due.map(spell => (
        <div key={spell.start} className="rounded-2xl border-2 border-amber-400 dark:border-amber-700 bg-amber-50/80 dark:bg-amber-950/30 p-4 space-y-2">
          <p className="font-bold text-amber-900 dark:text-amber-100">
            You were {absencePhrase(spell.types.join(" + "))} {fmtRange(spell.start, spell.end)} ({spell.days} day{spell.days !== 1 ? "s" : ""})
          </p>
          <p className="text-sm text-amber-800/90 dark:text-amber-200/90">
            Grab a manager and fill in the short return-to-work form together — it takes two minutes.
          </p>
          <button onClick={() => startForm(spell)} disabled={starting}
            className="h-12 px-5 rounded-xl bg-amber-600 text-white font-bold flex items-center gap-2 disabled:opacity-50">
            {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <PenLine className="w-4 h-4" />} Start the form
          </button>
        </div>
      ))}

      {forms.length === 0 && due.length === 0 && (
        <p className="text-muted-foreground">Nothing here — no absence of yours needing a form.</p>
      )}

      {forms.map(form => (
        <button key={form.id} onClick={() => openExisting(form.id)}
          className="w-full text-left rounded-2xl border-2 border-border bg-card p-4 hover:border-primary/50 transition-colors flex items-center gap-3">
          <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0",
            form.status === "complete" ? "bg-emerald-100 dark:bg-emerald-950/40" : "bg-amber-100 dark:bg-amber-950/40")}>
            {form.status === "complete" ? <CheckCircle2 className="w-5 h-5 text-emerald-600" /> : <PenLine className="w-5 h-5 text-amber-600" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{fmtRange(form.absenceStart, form.absenceEnd)}{form.reasonCategory ? ` — ${form.reasonCategory}` : ""}</p>
            {form.absenceType && <p className="text-sm text-muted-foreground">{form.absenceType}</p>}
            {/* The note shows inline so a scan down the list reads the
                actual reasons, not just the category. */}
            {form.reasonDetails && (
              <p className="text-sm text-foreground/80 line-clamp-2">{form.reasonDetails}</p>
            )}
            <p className="text-sm text-muted-foreground truncate">
              {form.status === "complete" ? `Signed${form.managerName ? ` with ${form.managerName}` : ""}` : "Draft — finish and sign with a manager"}
            </p>
          </div>
        </button>
      ))}
    </div>
  );
}
