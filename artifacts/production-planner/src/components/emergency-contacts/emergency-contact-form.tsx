/**
 * The emergency-contact form — used for your own (the sign-in card and
 * Account → My emergency contact) and for a manager correcting a
 * colleague's. Big fields for the iPad, and a save state you can't miss:
 * "Not saved yet" while anything differs from what's on file, "Saving…",
 * then "Saved"; a refusal shows the server's reason in red and keeps
 * everything typed.
 */
import { useEffect, useState } from "react";
import { AlertTriangle, Check, Loader2, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { EmergencyContactInput } from "./emergency-contacts-api";

const FIELD = "w-full h-14 px-4 rounded-2xl border-2 border-border bg-card text-lg font-semibold focus:outline-none focus:border-primary";
const RELATIONSHIPS = ["Mum", "Dad", "Partner", "Husband", "Wife", "Sister", "Brother", "Friend"];

function same(a: EmergencyContactInput, b: EmergencyContactInput): boolean {
  return (Object.keys(a) as Array<keyof EmergencyContactInput>).every(k => (a[k] ?? "").trim() === (b[k] ?? "").trim());
}

export function EmergencyContactForm({ initial, onSave, whose, submitLabel = "Save", autoFocus, className }: {
  initial: EmergencyContactInput;
  onSave: (data: EmergencyContactInput) => Promise<unknown>;
  /** "your" for your own, or the colleague's first name ("Sam's"). */
  whose: string;
  submitLabel?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  const [form, setForm] = useState<EmergencyContactInput>(initial);
  const [saved, setSaved] = useState<EmergencyContactInput>(initial);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [showSecond, setShowSecond] = useState(!!(initial.secondName || initial.secondPhone));

  // A fresh record from the server (e.g. after a reveal) resets the form.
  useEffect(() => { setForm(initial); setSaved(initial); setShowSecond(!!(initial.secondName || initial.secondPhone)); }, [initial]);

  const dirty = !same(form, saved);
  const set = (k: keyof EmergencyContactInput) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm(f => ({ ...f, [k]: e.target.value }));
    if (state !== "saving") setState("idle");
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.phone.trim() || !form.relationship.trim()) {
      setState("error");
      setError("Name, phone number and who they are are all needed");
      return;
    }
    setState("saving");
    setError(null);
    try {
      await onSave(form);
      setSaved(form);
      setState("saved");
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : "Couldn't save — try again");
    }
  }

  const removeSecond = () => {
    setShowSecond(false);
    setForm(f => ({ ...f, secondName: "", secondPhone: "", secondRelationship: "" }));
  };

  return (
    <form onSubmit={submit} className={cn("space-y-4", className)} noValidate>
      <label className="block space-y-1.5">
        <span className="text-base font-bold">Who should we call?</span>
        <input value={form.name} onChange={set("name")} className={FIELD} placeholder="Their name" autoComplete="off" autoFocus={autoFocus} />
      </label>
      <label className="block space-y-1.5">
        <span className="text-base font-bold">Their phone number</span>
        <input value={form.phone} onChange={set("phone")} className={FIELD} placeholder="e.g. 07700 900123" inputMode="tel" type="tel" autoComplete="off" />
      </label>
      <div className="space-y-1.5">
        <label className="block space-y-1.5">
          <span className="text-base font-bold">Who are they to {whose === "your" ? "you" : whose.replace(/'s$/, "")}?</span>
          <input value={form.relationship} onChange={set("relationship")} className={FIELD} placeholder="e.g. Mum, partner, friend" autoComplete="off" />
        </label>
        <div className="flex flex-wrap gap-2">
          {RELATIONSHIPS.map(r => (
            <button key={r} type="button" onClick={() => { setForm(f => ({ ...f, relationship: r })); setState("idle"); }}
              className={cn("h-10 px-3.5 rounded-full border-2 text-sm font-semibold",
                form.relationship === r ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground")}>
              {r}
            </button>
          ))}
        </div>
      </div>

      {showSecond ? (
        <div className="rounded-2xl border-2 border-dashed border-border p-4 space-y-3">
          <div className="flex items-center gap-2">
            <p className="flex-1 text-base font-bold">A second person to try <span className="font-normal text-muted-foreground">(optional)</span></p>
            <button type="button" onClick={removeSecond} className="w-10 h-10 rounded-lg flex items-center justify-center hover:bg-secondary" aria-label="Remove the second person">
              <X className="w-5 h-5" />
            </button>
          </div>
          <input value={form.secondName} onChange={set("secondName")} className={FIELD} placeholder="Their name" autoComplete="off" />
          <input value={form.secondPhone} onChange={set("secondPhone")} className={FIELD} placeholder="Their phone number" inputMode="tel" type="tel" autoComplete="off" />
          <input value={form.secondRelationship} onChange={set("secondRelationship")} className={FIELD} placeholder="Who they are (optional)" autoComplete="off" />
        </div>
      ) : (
        <button type="button" onClick={() => setShowSecond(true)}
          className="h-12 px-4 rounded-xl border-2 border-border text-base font-semibold inline-flex items-center gap-2 hover:bg-secondary/60">
          <Plus className="w-5 h-5" /> Add a second person (optional)
        </button>
      )}

      <div className="space-y-2">
        <button type="submit" disabled={state === "saving"}
          className="w-full h-14 rounded-2xl bg-primary text-primary-foreground text-lg font-bold flex items-center justify-center gap-2 disabled:opacity-60">
          {state === "saving" ? <><Loader2 className="w-5 h-5 animate-spin" /> Saving…</> : submitLabel}
        </button>
        <p className="text-sm font-semibold min-h-5 text-center" aria-live="polite">
          {state === "error" && error && <span className="text-destructive inline-flex items-center gap-1"><AlertTriangle className="w-4 h-4 shrink-0" /> {error} — not saved</span>}
          {state !== "error" && state !== "saving" && dirty && <span className="text-amber-700 dark:text-amber-400">Not saved yet</span>}
          {state === "saved" && !dirty && <span className="text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1"><Check className="w-4 h-4" /> Saved</span>}
        </p>
      </div>
    </form>
  );
}
