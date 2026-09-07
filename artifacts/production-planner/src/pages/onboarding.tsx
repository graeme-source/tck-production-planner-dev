// New-starter onboarding form — shown once, right after a colleague accepts
// their invite and sets their name + password. Collects the details they can
// give before their first shift. Rendered full-screen by AuthGate while
// `onboardingRequired && !onboardingCompletedAt`.

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { Loader2, Phone, MapPin, Heart, FileText, Upload, Check, X, ShieldCheck, ArrowRight, LogOut } from "lucide-react";
import { StarterFormsList } from "@/components/starter-forms";
import { MyContractSection } from "@/components/my-contract";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type DocMeta = { id: number; kind: string; fileName: string | null; fileSizeBytes: number | null };
type Submission = {
  phone: string | null; address: string | null;
  emergencyContactName: string | null; emergencyContactPhone: string | null; emergencyContactRelationship: string | null;
  submittedAt: string | null;
} | null;

const DOC_SLOTS: { kind: string; label: string; hint: string }[] = [
  { kind: "right_to_work", label: "Right to work / ID", hint: "Passport, BRP or share code screenshot" },
  { kind: "food_hygiene", label: "Food Hygiene certificate", hint: "If you already have one" },
  { kind: "p45", label: "P45 from your last job", hint: "Optional — helps payroll get your tax code right" },
];

interface GateStatus {
  detailsSubmitted: boolean;
  forms: { type: string; title: string; signed: boolean }[];
  contractIssued: boolean;
  contractSigned: boolean;
  startDate: string | null;
  firstDayReached: boolean;
  paperworkComplete: boolean;
  complete: boolean;
}

function firstDayLabel(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso
    : d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

// onComplete is legacy: AuthGate re-renders on refreshUser, so the poll gets
// a granted starter into the app without this ever firing.
export default function Onboarding(_props: { onComplete?: () => void | Promise<void> }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [documents, setDocuments] = useState<DocMeta[]>([]);
  // Two phases (Graeme, 2026-09-07): pre-arrival details first, then the
  // paperwork — three starter forms plus the contract when one is issued.
  // The app stays gated until the server says everything is signed.
  const [phase, setPhase] = useState<"details" | "paperwork">("details");
  const [gate, setGate] = useState<GateStatus | null>(null);
  const [form, setForm] = useState({
    phone: "", address: "",
    emergencyContactName: "", emergencyContactPhone: "", emergencyContactRelationship: "",
  });

  const refreshGate = async () => {
    const res = await fetch(`${BASE}/api/onboarding/me/gate`, { credentials: "include" });
    if (res.ok) {
      const g: GateStatus = await res.json();
      setGate(g);
      return g;
    }
    return null;
  };

  const refresh = async () => {
    const res = await fetch(`${BASE}/api/onboarding/me`, { credentials: "include" });
    if (res.ok) {
      const data = await res.json();
      const s: Submission = data.submission;
      if (s) {
        setForm({
          phone: s.phone ?? "", address: s.address ?? "",
          emergencyContactName: s.emergencyContactName ?? "",
          emergencyContactPhone: s.emergencyContactPhone ?? "",
          emergencyContactRelationship: s.emergencyContactRelationship ?? "",
        });
        if (s.submittedAt) setPhase("paperwork");
      }
      setDocuments(data.documents ?? []);
    }
    await refreshGate();
  };

  useEffect(() => { refresh().finally(() => setLoading(false)); }, []);

  // While on the paperwork step, keep the checklist fresh — signatures land
  // from the sheets below. refreshUser too: when the founder grants access
  // on the first day, this screen flows into the app within a few seconds.
  // logout: gated users never see the app shell's sidebar, so this screen
  // carries its own log out (Graeme, 2026-09-07).
  const { refreshUser, logout } = useAuth();

  const logoutButton = (
    <button
      onClick={() => void logout()}
      className="absolute top-4 right-4 flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
    >
      <LogOut className="w-4 h-4" /> Log out
    </button>
  );
  useEffect(() => {
    if (phase !== "paperwork") return;
    const t = setInterval(() => { void refreshGate(); void refreshUser(); }, 4000);
    return () => clearInterval(t);
  }, [phase, refreshUser]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [k]: e.target.value }));

  const [submitError, setSubmitError] = useState<string | null>(null);
  // Everything on this form is required — the emergency contact especially
  // (Graeme, 2026-09-07). The server refuses blanks too; this just saves a
  // round trip and enables/disables the button honestly.
  const detailsComplete = Object.values(form).every(v => v.trim() !== "");

  const submit = async () => {
    setSaving(true);
    setSubmitError(null);
    try {
      const res = await fetch(`${BASE}/api/onboarding/me`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Couldn't save — try again");
      }
      await refreshGate();
      // Always on to the paperwork step — the app itself only opens when
      // the founder grants access on their first day.
      setPhase("paperwork");
      setSaving(false);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Couldn't save — try again");
      setSaving(false);
    }
  };

  const inputCls = "w-full px-3 py-2.5 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";

  if (phase === "paperwork" && !loading) {
    const firstDay = firstDayLabel(gate?.startDate ?? null);
    const checklist: { label: string; done: boolean }[] = [
      { label: "Your contact & emergency details", done: gate?.detailsSubmitted ?? false },
      ...(gate?.forms ?? []).map(f => ({ label: f.title, done: f.signed })),
      {
        label: gate?.contractIssued ? "Your employment contract" : "Your employment contract (on its way from Graeme)",
        done: gate?.contractSigned ?? false,
      },
    ];
    const doneCount = checklist.filter(c => c.done).length;
    return (
      <div className="min-h-screen bg-background flex justify-center p-4 relative">
        {logoutButton}
        <div className="w-full max-w-2xl my-8 space-y-6">
          <div className="flex flex-col items-center gap-2">
            <img src={`${BASE}/tck-logo-dark.png`} alt="TCK" className="h-16 w-auto object-contain dark:invert" />
            <span className="text-xs text-muted-foreground tracking-widest uppercase font-medium">Production Planner</span>
          </div>

          {/* The welcome — this is somebody's first look inside TCK. */}
          <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-3">
            <h1 className="text-2xl font-bold font-display">Welcome to The Calzone Kitchen! 👋</h1>
            <p className="text-base text-muted-foreground leading-relaxed">
              We're really glad you're joining us. This app is where the whole team works — plans, checklists,
              improvements, your own hub. Before your first day there's a bit of paperwork to get out of the way,
              and you can do all of it right here, from home, whenever suits.
              Everything autosaves, and what you enter is seen only by you and Graeme.
            </p>
            {firstDay && (
              <p className="text-base font-semibold">
                Your first day is {firstDay} — the rest of the app opens up then.
              </p>
            )}
          </div>

          {/* The checklist — what's done, what's left, at a glance. */}
          <div className="bg-card border border-border rounded-2xl p-5 space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Your onboarding checklist</h2>
              <span className="text-sm font-bold tabular-nums text-muted-foreground">{doneCount}/{checklist.length}</span>
            </div>
            {checklist.map(c => (
              <div key={c.label} className="flex items-center gap-2.5 py-1">
                <span className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${c.done ? "bg-emerald-500 text-white" : "border-2 border-border"}`}>
                  {c.done && <Check className="w-4 h-4" />}
                </span>
                <span className={`text-base ${c.done ? "text-muted-foreground line-through" : "font-medium"}`}>{c.label}</span>
              </div>
            ))}
          </div>

          {/* The saved details, visible and editable — a ticked step you
              can't see or fix isn't a record (Graeme, 2026-09-07). */}
          <div className="bg-card border border-border rounded-2xl p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <h2 className="text-base font-semibold flex items-center gap-2"><Heart className="w-4 h-4 text-primary" /> Your contact &amp; emergency details</h2>
                <p className="text-sm"><span className="text-muted-foreground">Mobile:</span> {form.phone || "—"}</p>
                <p className="text-sm"><span className="text-muted-foreground">Address:</span> {form.address || "—"}</p>
                <p className="text-sm">
                  <span className="text-muted-foreground">Emergency contact:</span>{" "}
                  {form.emergencyContactName
                    ? `${form.emergencyContactName} (${form.emergencyContactRelationship || "—"}) · ${form.emergencyContactPhone || "—"}`
                    : "— not filled in yet"}
                </p>
              </div>
              <button
                onClick={() => setPhase("details")}
                className="flex-shrink-0 px-4 h-10 rounded-xl border border-border text-sm font-semibold hover:bg-secondary/50"
              >
                Edit
              </button>
            </div>
          </div>

          <section className="space-y-3">
            <h2 className="text-base font-semibold">1 · Starter forms</h2>
            <StarterFormsList />
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold">2 · Your employment contract</h2>
            {gate?.contractIssued ? (
              <MyContractSection />
            ) : (
              <p className="text-sm text-muted-foreground bg-card border border-border rounded-2xl p-4">
                Graeme hasn't issued your contract yet — it will appear right here (and in your Employee Hub) the moment he does.
              </p>
            )}
          </section>

          {/* No enter button, ever: the founder opens the app in person on
              their first day (Graeme, 2026-09-07). The poll above lets that
              grant flow this screen straight into the app. */}
          {gate?.paperworkComplete ? (
            <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/30 p-6 text-center space-y-1">
              <p className="text-xl font-bold">Thanks — that's it for now! 🎉</p>
              <p className="text-base text-muted-foreground">
                {firstDay
                  ? `See you on ${firstDay}. We'll open the rest of the app up for you when you come in.`
                  : "We'll open the rest of the app up for you when you come in on your first day."}
              </p>
              <p className="text-sm text-muted-foreground">
                You can log back in here any time to read or print anything you've signed.
              </p>
            </div>
          ) : (
            <div className="rounded-2xl border border-border bg-card p-4 text-center">
              <p className="text-base text-muted-foreground flex items-center justify-center gap-2">
                <ArrowRight className="w-4 h-4" /> Work through the checklist above — everything autosaves as you go.
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 relative">
      {logoutButton}
      <div className="w-full max-w-md my-8">
        <div className="flex flex-col items-center gap-2 mb-6">
          <img src={`${BASE}/tck-logo-dark.png`} alt="TCK" className="h-16 w-auto object-contain" />
          <span className="text-xs text-muted-foreground tracking-widest uppercase font-medium">Production Planner</span>
        </div>

        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-6">
          <div>
            <h1 className="text-xl font-semibold">Welcome to the team! 👋</h1>
            <p className="text-sm text-muted-foreground mt-1">
              A few details before your first shift. Fill in what you can now — your manager will go through the rest with you in person.
            </p>
          </div>

          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary/50" /></div>
          ) : (
            <>
              {/* Contact details */}
              <section className="space-y-3">
                <h2 className="text-sm font-semibold flex items-center gap-2"><Phone className="w-4 h-4 text-primary" /> Your contact details</h2>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Mobile number <span className="text-destructive">*</span></label>
                  <input value={form.phone} onChange={set("phone")} inputMode="tel" placeholder="07…" className={inputCls} />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block flex items-center gap-1"><MapPin className="w-3 h-3" /> Home address <span className="text-destructive">*</span></label>
                  <input value={form.address} onChange={set("address")} placeholder="Street, town, postcode" className={inputCls} />
                </div>
              </section>

              {/* Emergency contact */}
              <section className="space-y-3">
                <h2 className="text-sm font-semibold flex items-center gap-2"><Heart className="w-4 h-4 text-primary" /> Emergency contact</h2>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Name <span className="text-destructive">*</span></label>
                  <input value={form.emergencyContactName} onChange={set("emergencyContactName")} placeholder="Full name" className={inputCls} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">Phone <span className="text-destructive">*</span></label>
                    <input value={form.emergencyContactPhone} onChange={set("emergencyContactPhone")} inputMode="tel" placeholder="Phone" className={inputCls} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">Relationship <span className="text-destructive">*</span></label>
                    <input value={form.emergencyContactRelationship} onChange={set("emergencyContactRelationship")} placeholder="e.g. Partner" className={inputCls} />
                  </div>
                </div>
              </section>

              {/* Documents */}
              <section className="space-y-3">
                <h2 className="text-sm font-semibold flex items-center gap-2"><FileText className="w-4 h-4 text-primary" /> Documents</h2>
                {DOC_SLOTS.map(slot => (
                  <DocSlot
                    key={slot.kind}
                    slot={slot}
                    docs={documents.filter(d => d.kind === slot.kind)}
                    onChanged={refresh}
                  />
                ))}
                <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3 flex-shrink-0" /> Only managers can see these. PDF, JPG or PNG.
                </p>
              </section>

              {submitError && (
                <p className="text-sm text-destructive font-medium">{submitError}</p>
              )}
              <button
                onClick={submit}
                disabled={saving || !detailsComplete}
                className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {saving ? "Saving…" : detailsComplete ? "Save & continue" : "Fill in every field to continue"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function DocSlot({ slot, docs, onChanged }: {
  slot: { kind: string; label: string; hint: string };
  docs: DocMeta[];
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", slot.kind);
      await fetch(`${BASE}/api/onboarding/me/documents`, { method: "POST", credentials: "include", body: fd });
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    setBusy(true);
    try {
      await fetch(`${BASE}/api/onboarding/me/documents/${id}`, { method: "DELETE", credentials: "include" });
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border border-border rounded-xl p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">{slot.label}</p>
          <p className="text-[11px] text-muted-foreground">{slot.hint}</p>
        </div>
        <label className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary text-foreground text-xs font-medium hover:bg-secondary/70 transition-colors border border-border cursor-pointer">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          {docs.length ? "Add another" : "Upload"}
          <input type="file" accept="application/pdf,image/jpeg,image/png" className="hidden" onChange={onPick} disabled={busy} />
        </label>
      </div>
      {docs.length > 0 && (
        <ul className="mt-2 space-y-1">
          {docs.map(d => (
            <li key={d.id} className="flex items-center justify-between gap-2 text-xs bg-secondary/40 rounded-md px-2 py-1.5">
              <span className="flex items-center gap-1.5 min-w-0"><FileText className="w-3.5 h-3.5 flex-shrink-0 text-primary" /><span className="truncate">{d.fileName}</span></span>
              <button onClick={() => remove(d.id)} disabled={busy} className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0" aria-label="Remove">
                <X className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
