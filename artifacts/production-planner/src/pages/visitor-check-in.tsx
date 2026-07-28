/**
 * Visitor Check-In — the digital visitor book, kiosk side.
 *
 * Full-screen with no app nav (like /meeting) because the iPad gets handed to
 * a visitor: they should see the form and nothing else. Two steps, big touch
 * targets, iPad-portrait first.
 *
 *   Step 1  who they are — name (required), company, who they're seeing, why
 *   Step 2  the food-safety declarations:
 *             · sickness or diarrhoea in the last 48 hours?  (blocks entry)
 *             · loose jewellery and watches removed
 *             · will wear the PPE provided
 *   Done    the server's timestamp read back to them, or the refusal screen
 *
 * The date and time are never typed — POST /api/visitors stamps signed_in_at
 * server-side so the log stands up as HACCP evidence.
 *
 * Visitors leaving tap themselves out of the "On site now" list, which is the
 * fire roll-call. Retrievable log lives at Analytics → HACCP → Visitor Book.
 */
import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  UserPlus, ShieldCheck, AlertTriangle, ArrowRight, ArrowLeft, Check,
  Loader2, LogOut, Users, X, Watch, HardHat, Home,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface VisitorEntry {
  id: number;
  visitorName: string;
  company: string | null;
  visiting: string | null;
  purpose: string | null;
  illnessLast48h: boolean;
  jewelleryRemoved: boolean;
  ppeAgreed: boolean;
  entryPermitted: boolean;
  signedInAt: string;
  signedOutAt: string | null;
}

type Step = "details" | "declarations" | "done";

export default function VisitorCheckIn() {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>("details");

  const [visitorName, setVisitorName] = useState("");
  const [company, setCompany] = useState("");
  const [visiting, setVisiting] = useState("");
  const [purpose, setPurpose] = useState("");
  // null until answered, so neither Yes nor No is pre-selected — a visitor
  // must actively answer the illness question.
  const [illness, setIllness] = useState<boolean | null>(null);
  const [jewellery, setJewellery] = useState(false);
  const [ppe, setPpe] = useState(false);

  const [result, setResult] = useState<VisitorEntry | null>(null);

  const { data: onSite } = useQuery<VisitorEntry[]>({
    queryKey: ["visitors-on-site"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/visitors/on-site`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load visitors on site");
      return res.json();
    },
    refetchInterval: 60_000,
  });

  const checkIn = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}/api/visitors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          visitorName: visitorName.trim(),
          company: company.trim() || undefined,
          visiting: visiting.trim() || undefined,
          purpose: purpose.trim() || undefined,
          illnessLast48h: illness === true,
          jewelleryRemoved: jewellery,
          ppeAgreed: ppe,
        }),
      });
      if (!res.ok) throw new Error("Check-in failed");
      return res.json() as Promise<VisitorEntry>;
    },
    onSuccess: (entry) => {
      setResult(entry);
      setStep("done");
      queryClient.invalidateQueries({ queryKey: ["visitors-on-site"] });
    },
    onError: () => {
      toast({ title: "Check-in failed", description: "Please try again, or ask a member of staff.", variant: "destructive" });
    },
  });

  const signOut = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${BASE}/api/visitors/${id}/sign-out`, {
        method: "PATCH",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Sign-out failed");
      return res.json();
    },
    onSuccess: (entry: VisitorEntry) => {
      toast({ title: `${entry.visitorName} signed out`, description: format(new Date(entry.signedOutAt!), "HH:mm") });
      queryClient.invalidateQueries({ queryKey: ["visitors-on-site"] });
    },
    onError: () => {
      toast({ title: "Sign-out failed", description: "Please try again.", variant: "destructive" });
    },
  });

  function reset() {
    setVisitorName("");
    setCompany("");
    setVisiting("");
    setPurpose("");
    setIllness(null);
    setJewellery(false);
    setPpe(false);
    setResult(null);
    setStep("details");
  }

  const nameValid = visitorName.trim().length > 1;
  // Illness must be answered either way; the hygiene declarations must be
  // ticked. A visitor answering "yes" to illness skips them — they're not
  // going in, so there's nothing to declare.
  const canSubmit = illness === true || (illness === false && jewellery && ppe);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header — the only staff affordance is the small exit link, kept away
          from the form so a visitor doesn't wander into the app. */}
      <header className="border-b border-border bg-card/60 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-primary/10 text-primary">
            <UserPlus className="w-6 h-6" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="font-display font-bold text-xl leading-tight">Visitor Check-In</h1>
            <p className="text-xs text-muted-foreground">The Calzone Kitchen · {format(new Date(), "EEEE d MMMM yyyy")}</p>
          </div>
          <Link
            href="/"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-2 hover:bg-secondary transition-colors flex-shrink-0"
          >
            <Home className="w-3.5 h-3.5" /> Staff exit
          </Link>
        </div>
      </header>

      <main className="flex-1 w-full max-w-3xl mx-auto px-6 py-8 space-y-6">
        {step === "details" && (
          <section className="glass-panel rounded-2xl p-6 space-y-5">
            <div>
              <h2 className="font-display font-bold text-2xl">Welcome</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Please sign in before entering. It takes about 30 seconds.
              </p>
            </div>

            <div className="space-y-4">
              <KioskField label="Your name" required>
                <input
                  autoFocus
                  value={visitorName}
                  onChange={e => setVisitorName(e.target.value)}
                  placeholder="First and last name"
                  autoCapitalize="words"
                  className="w-full px-4 py-4 text-lg border border-border rounded-xl bg-background focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </KioskField>

              <KioskField label="Company" hint="Leave blank if not visiting for work">
                <input
                  value={company}
                  onChange={e => setCompany(e.target.value)}
                  placeholder="e.g. Brakes, EHO, Pest Control"
                  className="w-full px-4 py-4 text-lg border border-border rounded-xl bg-background focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </KioskField>

              <KioskField label="Who are you here to see?">
                <input
                  value={visiting}
                  onChange={e => setVisiting(e.target.value)}
                  placeholder="Name of the person you're visiting"
                  className="w-full px-4 py-4 text-lg border border-border rounded-xl bg-background focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </KioskField>

              <KioskField label="Reason for visit">
                <input
                  value={purpose}
                  onChange={e => setPurpose(e.target.value)}
                  placeholder="e.g. Delivery, maintenance, inspection, meeting"
                  className="w-full px-4 py-4 text-lg border border-border rounded-xl bg-background focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </KioskField>
            </div>

            <button
              onClick={() => setStep("declarations")}
              disabled={!nameValid}
              className="w-full flex items-center justify-center gap-2 px-6 py-5 rounded-xl bg-primary text-primary-foreground font-semibold text-lg shadow-sm hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              Continue <ArrowRight className="w-5 h-5" />
            </button>
          </section>
        )}

        {step === "declarations" && (
          <section className="space-y-5">
            {/* The illness question — the one that can stop a visit. */}
            <div className="glass-panel rounded-2xl p-6 space-y-4">
              <div className="flex items-start gap-3">
                <ShieldCheck className="w-6 h-6 text-primary flex-shrink-0 mt-0.5" />
                <div>
                  <h2 className="font-display font-bold text-xl leading-snug">
                    Have you had sickness or diarrhoea in the last 48 hours?
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    This includes vomiting or an upset stomach. We make food here, so we have to ask everyone.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setIllness(false)}
                  className={cn(
                    "px-4 py-6 rounded-xl border-2 font-semibold text-lg transition-colors",
                    illness === false
                      ? "border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                      : "border-border bg-card hover:bg-secondary/50"
                  )}
                >
                  No
                </button>
                <button
                  onClick={() => { setIllness(true); setJewellery(false); setPpe(false); }}
                  className={cn(
                    "px-4 py-6 rounded-xl border-2 font-semibold text-lg transition-colors",
                    illness === true
                      ? "border-red-500 bg-red-500/10 text-red-700 dark:text-red-300"
                      : "border-border bg-card hover:bg-secondary/50"
                  )}
                >
                  Yes
                </button>
              </div>

              {illness === true && (
                <div className="rounded-xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-4 flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-800 dark:text-red-300">
                    <span className="font-semibold">Please do not enter the production area.</span>{" "}
                    Speak to a member of staff — they'll help you from the office or reception. Tap
                    below and we'll record that you visited.
                  </p>
                </div>
              )}
            </div>

            {/* Hygiene declarations — only relevant if they're going in. */}
            {illness === false && (
              <div className="glass-panel rounded-2xl p-6 space-y-4">
                <div>
                  <h2 className="font-display font-bold text-xl">Before you come in</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Please tick both to confirm. A member of staff will give you what you need.
                  </p>
                </div>

                <DeclarationToggle
                  icon={<Watch className="w-5 h-5" />}
                  checked={jewellery}
                  onChange={setJewellery}
                  title="I have removed loose jewellery and my watch"
                  detail="Rings (except a plain wedding band), earrings, watches, bracelets and necklaces must come off — they can fall into food."
                />
                <DeclarationToggle
                  icon={<HardHat className="w-5 h-5" />}
                  checked={ppe}
                  onChange={setPpe}
                  title="I will wear the PPE provided"
                  detail="Hairnet, beard snood if needed, white coat and shoe covers, worn for the whole visit."
                />
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setStep("details")}
                className="flex items-center justify-center gap-2 px-5 py-5 rounded-xl border border-border bg-card font-medium hover:bg-secondary/50 transition-colors"
              >
                <ArrowLeft className="w-5 h-5" /> Back
              </button>
              <button
                onClick={() => checkIn.mutate()}
                disabled={!canSubmit || checkIn.isPending}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 px-6 py-5 rounded-xl font-semibold text-lg shadow-sm transition-opacity disabled:opacity-40",
                  illness === true
                    ? "bg-red-600 text-white hover:opacity-90"
                    : "bg-primary text-primary-foreground hover:opacity-90"
                )}
              >
                {checkIn.isPending
                  ? <><Loader2 className="w-5 h-5 animate-spin" /> Signing in…</>
                  : illness === true
                    ? <>Record my visit</>
                    : <><Check className="w-5 h-5" /> Sign me in</>}
              </button>
            </div>
          </section>
        )}

        {step === "done" && result && (
          <section
            className={cn(
              "glass-panel rounded-2xl p-8 text-center space-y-4",
              !result.entryPermitted && "border-2 border-red-300 dark:border-red-800"
            )}
          >
            {result.entryPermitted ? (
              <>
                <div className="mx-auto w-16 h-16 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                  <Check className="w-8 h-8" />
                </div>
                <h2 className="font-display font-bold text-2xl">Thanks, {result.visitorName.split(" ")[0]} — you're signed in</h2>
                <p className="text-muted-foreground">
                  Signed in at <span className="font-semibold text-foreground tabular-nums">{format(new Date(result.signedInAt), "HH:mm")}</span>{" "}
                  on {format(new Date(result.signedInAt), "d MMMM yyyy")}.
                </p>
                <p className="text-sm text-muted-foreground">
                  Please sign out on this iPad when you leave. Hand it back to a member of staff.
                </p>
              </>
            ) : (
              <>
                <div className="mx-auto w-16 h-16 rounded-full bg-red-500/10 text-red-600 dark:text-red-400 flex items-center justify-center">
                  <AlertTriangle className="w-8 h-8" />
                </div>
                <h2 className="font-display font-bold text-2xl">Visit recorded — please don't enter production</h2>
                <p className="text-muted-foreground">
                  Because of the last 48 hours, you can't go into the food areas today. A member of
                  staff will come and help you. Recorded at{" "}
                  <span className="font-semibold text-foreground tabular-nums">{format(new Date(result.signedInAt), "HH:mm")}</span>.
                </p>
              </>
            )}
            <button
              onClick={reset}
              className="w-full px-6 py-4 rounded-xl border border-border bg-card font-medium hover:bg-secondary/50 transition-colors"
            >
              Done — next visitor
            </button>
          </section>
        )}

        {/* On site now — the fire roll-call, and how a visitor signs out. */}
        <section className="glass-panel rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Users className="w-5 h-5 text-muted-foreground" />
            <h3 className="font-display font-bold text-lg">On site now</h3>
            <span className="text-xs text-muted-foreground ml-auto">
              {onSite?.length ?? 0} visitor{(onSite?.length ?? 0) !== 1 ? "s" : ""}
            </span>
          </div>
          {(onSite?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">No visitors currently signed in.</p>
          ) : (
            <ul className="divide-y divide-border">
              {onSite!.map(v => (
                <li key={v.id} className="flex items-center gap-3 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">
                      {v.visitorName}
                      {v.company ? <span className="text-muted-foreground font-normal"> · {v.company}</span> : null}
                    </p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      In at {format(new Date(v.signedInAt), "HH:mm")}
                      {v.visiting ? ` · seeing ${v.visiting}` : ""}
                    </p>
                  </div>
                  <button
                    onClick={() => signOut.mutate(v.id)}
                    disabled={signOut.isPending}
                    className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-border bg-card text-sm font-medium hover:bg-secondary/50 transition-colors disabled:opacity-50 flex-shrink-0"
                  >
                    <LogOut className="w-4 h-4" /> Sign out
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

function KioskField({ label, hint, required, children }: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-semibold">
        {label}
        {required ? <span className="text-red-500 ml-0.5">*</span> : <span className="text-muted-foreground font-normal ml-1.5">(optional)</span>}
      </span>
      {hint && <span className="block text-xs text-muted-foreground mt-0.5">{hint}</span>}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

/** Big tap-anywhere declaration row — the whole card toggles, not just a
 *  12px checkbox, because this is used on a handed-over iPad. */
function DeclarationToggle({ icon, checked, onChange, title, detail }: {
  icon: React.ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  detail: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      className={cn(
        "w-full flex items-start gap-3 text-left p-4 rounded-xl border-2 transition-colors",
        checked
          ? "border-emerald-500 bg-emerald-500/5"
          : "border-border bg-card hover:bg-secondary/40"
      )}
    >
      <span className={cn(
        "w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5",
        checked ? "bg-emerald-500 text-white" : "bg-secondary text-muted-foreground"
      )}>
        {checked ? <Check className="w-4 h-4" /> : <X className="w-4 h-4 opacity-40" />}
      </span>
      <span className="flex-1">
        <span className="flex items-center gap-2 font-semibold">
          <span className="text-muted-foreground">{icon}</span>
          {title}
        </span>
        <span className="block text-sm text-muted-foreground mt-1">{detail}</span>
      </span>
    </button>
  );
}
