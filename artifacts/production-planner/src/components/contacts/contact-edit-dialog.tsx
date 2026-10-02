/**
 * Add / edit a contact (managers and admins). Modal rules: X and backdrop
 * close, card capped at 92dvh with internal scroll so Save stays reachable,
 * full-width on a phone. Save state is unmissable: the Save button says
 * Saving… / the error shows in red above it, and closing with unsaved
 * changes asks first.
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { X, Loader2, Trash2, Save, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { STATIONS } from "@/pages/station/shared/constants";
import {
  CATEGORY_LABELS, USE_FOR_LABELS, useDeleteContact, useRestoreContact, useSaveContact,
  type Contact, type ContactCategory, type ContactInput,
} from "./contacts-api";

const EMPTY: ContactInput = {
  name: "", organisation: "", role: "", phone: "", email: "", notes: "",
  category: "other", stationKeys: [], pinned: false, sortOrder: 0,
};

function fromContact(c: Contact): ContactInput {
  return {
    name: c.name, organisation: c.organisation ?? "", role: c.role ?? "", phone: c.phone ?? "",
    email: c.email ?? "", notes: c.notes ?? "", category: c.category, stationKeys: c.stationKeys,
    pinned: c.pinned, sortOrder: c.sortOrder,
  };
}

const inputCls = "w-full h-12 rounded-xl border-2 border-border bg-background px-3 text-base focus:outline-none focus:border-primary";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-semibold">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

export function ContactEditDialog({ contact, defaultCategory, onClose }: {
  contact: Contact | null;
  defaultCategory?: ContactCategory;
  onClose: () => void;
}) {
  const initial = contact ? fromContact(contact) : { ...EMPTY, category: defaultCategory ?? "other" };
  const [form, setForm] = useState<ContactInput>(initial);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const save = useSaveContact();
  const del = useDeleteContact();
  const restore = useRestoreContact();
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  const set = <K extends keyof ContactInput>(k: K, v: ContactInput[K]) => setForm(f => ({ ...f, [k]: v }));

  function close() {
    if (dirty && !save.isSuccess && !window.confirm("You have unsaved changes to this contact. Close without saving?")) return;
    onClose();
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    save.mutate({ id: contact?.id ?? null, data: form }, {
      onSuccess: () => {
        toast({ title: contact ? "Contact saved" : "Contact added", description: form.name });
        onClose();
      },
    });
  }

  function remove() {
    if (!contact) return;
    del.mutate(contact.id, {
      onSuccess: () => {
        toast({
          title: "Contact deleted",
          description: contact.name,
          action: (
            <ToastAction
              altText="Undo"
              onClick={() => restore.mutate(contact.id, {
                onError: (err) => toast({ title: "Couldn't undo", description: (err as Error).message, variant: "destructive" }),
              })}
            >Undo</ToastAction>
          ),
        });
        onClose();
      },
      onError: (err) => toast({ title: "Couldn't delete", description: (err as Error).message, variant: "destructive" }),
    });
  }

  const toggleStation = (key: string) =>
    set("stationKeys", form.stationKeys.includes(key) ? form.stationKeys.filter(k => k !== key) : [...form.stationKeys, key]);

  return createPortal(
    <div className="fixed inset-0 z-[120] bg-black/60 flex items-center justify-center p-2 sm:p-4" onClick={close}>
      <form
        role="dialog"
        aria-modal="true"
        aria-label={contact ? "Edit contact" : "Add a contact"}
        onSubmit={submit}
        onClick={e => e.stopPropagation()}
        className="bg-background border-2 border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92dvh] flex flex-col overflow-hidden"
      >
        <div className="flex items-center gap-3 px-4 sm:px-5 py-3 border-b border-border shrink-0">
          <h2 className="flex-1 font-display font-bold text-xl">{contact ? "Edit contact" : "Add a contact"}</h2>
          <button type="button" onClick={close} className="w-10 h-10 rounded-lg flex items-center justify-center hover:bg-secondary" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 space-y-4">
          {contact?.useFor && USE_FOR_LABELS[contact.useFor] && (
            <p className="rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-900 dark:text-blue-200 text-sm px-3 py-2">
              {USE_FOR_LABELS[contact.useFor]} — the app finds this contact by its job, so the name and number can be changed here freely.
            </p>
          )}
          <Field label="Name">
            <input className={inputCls} value={form.name} onChange={e => set("name", e.target.value)} required autoFocus={!contact} />
          </Field>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Organisation">
              <input className={inputCls} value={form.organisation ?? ""} onChange={e => set("organisation", e.target.value)} placeholder="e.g. APC" />
            </Field>
            <Field label="Role / what they're for">
              <input className={inputCls} value={form.role ?? ""} onChange={e => set("role", e.target.value)} placeholder="e.g. Fridge engineer" />
            </Field>
            <Field label="Phone">
              <input className={inputCls} type="tel" inputMode="tel" value={form.phone ?? ""} onChange={e => set("phone", e.target.value)} />
            </Field>
            <Field label="Email">
              <input className={inputCls} type="email" inputMode="email" value={form.email ?? ""} onChange={e => set("email", e.target.value)} />
            </Field>
          </div>
          <Field label="Type">
            <div className="flex flex-wrap gap-2">
              {(Object.keys(CATEGORY_LABELS) as ContactCategory[]).map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => set("category", c)}
                  className={cn(
                    "h-11 px-4 rounded-xl border-2 text-sm font-semibold",
                    form.category === c ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-secondary/60",
                  )}
                >{CATEGORY_LABELS[c]}</button>
              ))}
            </div>
          </Field>
          <Field label="Notes">
            <textarea className={cn(inputCls, "h-24 py-2")} value={form.notes ?? ""} onChange={e => set("notes", e.target.value)} placeholder="When to call, account number, opening hours…" />
          </Field>
          <Field label="Show on these stations" hint="It appears behind the Contacts button on each station ticked.">
            <div className="flex flex-wrap gap-2">
              {STATIONS.map(s => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => toggleStation(s.key)}
                  className={cn(
                    "h-10 px-3 rounded-full border-2 text-sm font-medium",
                    form.stationKeys.includes(s.key) ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-secondary/60",
                  )}
                  aria-pressed={form.stationKeys.includes(s.key)}
                >{s.label}</button>
              ))}
            </div>
          </Field>
          <label className="flex items-start gap-3 rounded-xl border-2 border-border p-3 cursor-pointer">
            <input type="checkbox" className="mt-1 w-5 h-5 accent-primary" checked={form.pinned} onChange={e => set("pinned", e.target.checked)} />
            <span className="text-sm">
              <span className="font-semibold block">Always show on those stations</span>
              A small tap-to-call chip in the station's top bar, without opening anything. Keep it to the one or two numbers a station really needs.
            </span>
          </label>

          {contact && (
            <div className="pt-2 border-t border-border">
              {!confirmDelete ? (
                <button type="button" onClick={() => setConfirmDelete(true)} className="h-11 px-4 rounded-xl border-2 border-red-300 text-red-700 dark:text-red-300 text-sm font-semibold inline-flex items-center gap-2 hover:bg-red-50 dark:hover:bg-red-950/30">
                  <Trash2 className="w-4 h-4" /> Delete contact
                </button>
              ) : (
                <div className="rounded-xl border-2 border-red-300 bg-red-50 dark:bg-red-950/30 p-3 space-y-2">
                  <p className="text-sm font-semibold text-red-900 dark:text-red-200">
                    Delete {contact.name}?{contact.useFor ? " The app uses this contact — without it, people are told to look in Contacts instead." : ""} You can undo straight after.
                  </p>
                  <div className="flex gap-2">
                    <button type="button" onClick={remove} disabled={del.isPending} className="h-11 px-4 rounded-xl bg-red-600 text-white text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50">
                      {del.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Yes, delete
                    </button>
                    <button type="button" onClick={() => setConfirmDelete(false)} className="h-11 px-4 rounded-xl border-2 border-border text-sm font-semibold">Keep it</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-4 sm:px-5 py-3 border-t border-border shrink-0 space-y-2">
          {save.isError && (
            <p className="text-sm text-red-700 dark:text-red-300 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> Not saved — {(save.error as Error).message}
            </p>
          )}
          <div className="flex items-center gap-2">
            <span className="flex-1 text-sm text-muted-foreground">{dirty ? "Unsaved changes" : contact ? "No changes" : ""}</span>
            <button type="button" onClick={close} className="h-12 px-4 rounded-xl border-2 border-border font-semibold">Cancel</button>
            <button type="submit" disabled={save.isPending || !form.name.trim() || (!!contact && !dirty)} className="h-12 px-5 rounded-xl bg-primary text-primary-foreground font-semibold inline-flex items-center gap-2 disabled:opacity-50">
              {save.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
              {save.isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </form>
    </div>,
    document.body,
  );
}
