// New-starter onboarding form — shown once, right after a colleague accepts
// their invite and sets their name + password. Collects the details they can
// give before their first shift. Rendered full-screen by AuthGate while
// `onboardingRequired && !onboardingCompletedAt`.

import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Loader2, Phone, MapPin, Heart, FileText, Upload, Check, X, ShieldCheck } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type DocMeta = { id: number; kind: string; fileName: string | null; fileSizeBytes: number | null };
type Submission = {
  phone: string | null; address: string | null;
  emergencyContactName: string | null; emergencyContactPhone: string | null; emergencyContactRelationship: string | null;
} | null;

const DOC_SLOTS: { kind: string; label: string; hint: string }[] = [
  { kind: "right_to_work", label: "Right to work / ID", hint: "Passport, BRP or share code screenshot" },
  { kind: "food_hygiene", label: "Food Hygiene certificate", hint: "If you already have one" },
];

export default function Onboarding({ onComplete }: { onComplete?: () => void | Promise<void> }) {
  const [, setLocation] = useLocation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [documents, setDocuments] = useState<DocMeta[]>([]);
  const [form, setForm] = useState({
    phone: "", address: "",
    emergencyContactName: "", emergencyContactPhone: "", emergencyContactRelationship: "",
  });

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
      }
      setDocuments(data.documents ?? []);
    }
  };

  useEffect(() => { refresh().finally(() => setLoading(false)); }, []);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${BASE}/api/onboarding/me`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error();
      if (onComplete) await onComplete();
      else setLocation("/");
    } catch {
      setSaving(false);
    }
  };

  const inputCls = "w-full px-3 py-2.5 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
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
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Mobile number</label>
                  <input value={form.phone} onChange={set("phone")} inputMode="tel" placeholder="07…" className={inputCls} />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block flex items-center gap-1"><MapPin className="w-3 h-3" /> Home address</label>
                  <input value={form.address} onChange={set("address")} placeholder="Street, town, postcode" className={inputCls} />
                </div>
              </section>

              {/* Emergency contact */}
              <section className="space-y-3">
                <h2 className="text-sm font-semibold flex items-center gap-2"><Heart className="w-4 h-4 text-primary" /> Emergency contact</h2>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Name</label>
                  <input value={form.emergencyContactName} onChange={set("emergencyContactName")} placeholder="Full name" className={inputCls} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">Phone</label>
                    <input value={form.emergencyContactPhone} onChange={set("emergencyContactPhone")} inputMode="tel" placeholder="Phone" className={inputCls} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">Relationship</label>
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

              <button
                onClick={submit}
                disabled={saving}
                className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {saving ? "Saving…" : "Save & continue"}
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
