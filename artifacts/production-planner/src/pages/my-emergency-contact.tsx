/**
 * My emergency contact (Graeme, 2026-10-02) — /account/emergency-contact,
 * from the account menu. Everyone can see and update their own here at any
 * time; managers and admins can see it in an emergency, and every time they
 * do it's recorded.
 */
import { useMemo } from "react";
import { Link } from "wouter";
import { ChevronLeft, HeartPulse, Loader2, ShieldCheck } from "lucide-react";
import { useMyEmergencyContact, useSaveMyEmergencyContact, toInput } from "@/components/emergency-contacts/emergency-contacts-api";
import { EmergencyContactForm } from "@/components/emergency-contacts/emergency-contact-form";
import { fmtDay } from "@/lib/people-api";
import { PageHeader } from "@/components/page-header";

const SOURCE_WORDS: Record<string, string> = {
  self: "you",
  onboarding: "you, on your new-starter form",
};

export default function MyEmergencyContactPage() {
  const mine = useMyEmergencyContact();
  const save = useSaveMyEmergencyContact();
  const contact = mine.data?.contact ?? null;
  const initial = useMemo(() => toInput(contact), [contact]);
  const by = contact ? (SOURCE_WORDS[contact.source] ?? contact.updatedByName ?? "a manager") : null;

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <PageHeader title="My emergency contact" description="Who we call if something happens to you" />
      <div>
        <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ChevronLeft className="w-4 h-4" /> Back</Link>
        <h1 className="text-3xl font-display font-bold mt-1 flex items-center gap-2">
          <HeartPulse className="w-7 h-7 text-red-600 dark:text-red-400" /> My emergency contact
        </h1>
        <p className="text-base text-muted-foreground mt-1">
          Who we call if something happens to you at work. Keep it up to date — change it here whenever you need to.
        </p>
      </div>

      <div className="rounded-2xl border-2 border-border p-4 flex items-start gap-3">
        <ShieldCheck className="w-6 h-6 text-primary shrink-0 mt-0.5" />
        <p className="text-base">
          Only managers can see it, to use in an emergency. Every time anyone looks, it's recorded — who and when.
        </p>
      </div>

      {mine.isLoading ? (
        <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /> Loading…</p>
      ) : mine.error ? (
        <p className="text-destructive">Couldn't load your emergency contact — {(mine.error as Error).message}</p>
      ) : (
        <section className="rounded-3xl border-2 border-border bg-card p-4 sm:p-6 space-y-3">
          {contact ? (
            <p className="text-sm text-muted-foreground">Last updated {fmtDay(contact.updatedAt, true)} by {by}.</p>
          ) : (
            <p className="text-base font-semibold text-amber-700 dark:text-amber-400">We don't have an emergency contact for you yet.</p>
          )}
          <EmergencyContactForm initial={initial} whose="your" onSave={data => save.mutateAsync(data)} />
        </section>
      )}
    </div>
  );
}
