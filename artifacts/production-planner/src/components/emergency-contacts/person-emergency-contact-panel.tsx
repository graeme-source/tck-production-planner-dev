/**
 * The emergency contact on a People record (Graeme, 2026-10-02). The record
 * is already behind People access + the private PIN; this panel adds
 * nothing to who can open it. The contact itself is fetched only when
 * "Show emergency contact" is tapped, through a route the server logs
 * (/api/staff-emergency-contacts/people/:userId/view) — the onboarding form
 * card no longer carries it. Managers and admins can correct it here too.
 */
import { useState } from "react";
import { AlertTriangle, EyeOff, HeartPulse, Loader2, Lock, Pencil } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useRevealEmergencyContact, type Revealed } from "./emergency-contacts-api";
import { CorrectContact, RevealedContact, useCanSeeTeamEmergencyContacts } from "./team-emergency-contacts";

export function PersonEmergencyContactPanel({ userId, personName }: { userId: number; personName: string }) {
  const reveal = useRevealEmergencyContact();
  const canCorrect = useCanSeeTeamEmergencyContacts();
  const [shown, setShown] = useState<Revealed | null>(null);
  const [editing, setEditing] = useState(false);
  const first = personName.split(" ")[0];

  const show = async () => {
    try { setShown(await reveal.mutateAsync({ userId, source: "people_record" })); } catch { /* shown below via reveal.error */ }
  };

  return (
    <section className="rounded-3xl border-2 border-border bg-card p-4 sm:p-5 space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="flex-1 min-w-0 text-xl font-bold flex items-center gap-2">
          <HeartPulse className="w-5 h-5 text-red-600 dark:text-red-400" /> Emergency contact
        </h2>
        {shown ? (
          <button onClick={() => { setShown(null); setEditing(false); }}
            className="h-12 px-4 rounded-xl border-2 border-border font-bold flex items-center gap-2 hover:bg-secondary/50">
            <EyeOff className="w-5 h-5" /> Hide
          </button>
        ) : (
          <button onClick={show} disabled={reveal.isPending}
            className="h-12 px-4 rounded-xl bg-primary text-primary-foreground font-bold flex items-center gap-2 hover:opacity-90 disabled:opacity-60">
            {reveal.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <HeartPulse className="w-5 h-5" />} Show emergency contact
          </button>
        )}
      </div>
      {reveal.isError && !shown && (
        <p className="text-base text-destructive flex items-center gap-1.5">
          <AlertTriangle className="w-5 h-5 shrink-0" /> {(reveal.error as Error).message}
        </p>
      )}
      {shown && (editing ? (
        <CorrectContact person={{ userId, name: personName }} contact={shown.contact} source="people_record"
          onDone={c => { setShown({ ...shown, contact: c }); setEditing(false); toast({ title: "Saved", description: `${first}'s emergency contact is updated.` }); }}
          onCancel={() => setEditing(false)} />
      ) : (
        <>
          <RevealedContact contact={shown.contact} personName={personName} />
          {canCorrect && (
            <button onClick={() => setEditing(true)}
              className="h-11 px-3.5 rounded-xl border-2 border-border text-sm font-semibold inline-flex items-center gap-1.5 hover:bg-secondary/60">
              <Pencil className="w-4 h-4" /> {shown.contact ? "Correct it" : "Add one for them"}
            </button>
          )}
        </>
      ))}
      <p className="text-sm text-muted-foreground flex items-center gap-1.5">
        <Lock className="w-4 h-4 shrink-0" /> Every look is recorded with your name. {first} can update it from their account menu.
      </p>
    </section>
  );
}
