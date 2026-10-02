/**
 * "Our team — emergency contacts" (Graeme, 2026-10-02). Managers and admins
 * only — on the Contacts page and in every station's "Contacts for this
 * station" pop-up (in an emergency on the floor, that's where they'll be).
 *
 * A big card per active team member. The list carries names only; tapping
 * a card REVEALS that person's emergency contact — a fresh request the
 * server logs (who looked, whose, when, from where) before answering — with
 * a big tap-to-call button. Hiding it and tapping again is another logged
 * look. People with nothing on file say so, and that they'll be asked at
 * their next sign-in. A manager can correct what's on file (also logged).
 *
 * Renders nothing for anyone else; the server refuses them regardless.
 */
import { useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, HeartPulse, Loader2, Lock, Pencil, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth-context";
import { UserAvatar } from "@/components/user-avatar";
import { CallButton } from "@/components/contacts/contact-card";
import { fmtDay } from "@/lib/people-api";
import { filterTeam, onFileSummary } from "@/lib/emergency-contacts";
import {
  useTeamEmergencyContacts, useRevealEmergencyContact, useCorrectEmergencyContact, toInput,
  type TeamMember, type Revealed, type RevealSource, type EmergencyContact,
} from "./emergency-contacts-api";
import { EmergencyContactForm } from "./emergency-contact-form";

export function useCanSeeTeamEmergencyContacts(): boolean {
  const { state } = useAuth();
  const role = state.status === "authenticated" ? state.user.role : null;
  return role === "admin" || role === "manager";
}

export function TeamEmergencyContacts({ source, className }: { source: Exclude<RevealSource, "people_record">; className?: string }) {
  const allowed = useCanSeeTeamEmergencyContacts();
  const { data, isLoading, error } = useTeamEmergencyContacts(allowed);
  const [search, setSearch] = useState("");
  const people = useMemo(() => filterTeam(data?.people ?? [], search), [data, search]);
  if (!allowed) return null;

  return (
    <section className={cn("space-y-3", className)} aria-labelledby={`team-ec-${source}`}>
      <div className="flex items-center gap-3 flex-wrap">
        <h2 id={`team-ec-${source}`} className="font-display font-bold text-xl flex-1 flex items-center gap-2 min-w-0">
          <HeartPulse className="w-6 h-6 text-red-600 dark:text-red-400 shrink-0" /> Our team — emergency contacts
        </h2>
        {data && <span className="text-sm font-semibold text-muted-foreground">{onFileSummary(data.people)}</span>}
      </div>
      <p className="text-sm text-muted-foreground flex items-start gap-1.5">
        <Lock className="w-4 h-4 shrink-0 mt-0.5" />
        Managers and admins only. Tap a person to see who to call — every look is recorded with your name.
      </p>
      <div className="relative">
        <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Find a team member…"
          className="w-full h-14 rounded-2xl border-2 border-border bg-card pl-12 pr-12 text-base focus:outline-none focus:border-primary"
          aria-label="Search the team"
        />
        {search && (
          <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-lg flex items-center justify-center hover:bg-secondary" aria-label="Clear search">
            <X className="w-5 h-5" />
          </button>
        )}
      </div>
      {isLoading && <p className="text-muted-foreground flex items-center gap-2"><Loader2 className="w-5 h-5 animate-spin" /> Loading the team…</p>}
      {error && <p className="text-red-700 dark:text-red-300">Couldn't load the team — {(error as Error).message}</p>}
      {data && people.length === 0 && <p className="text-muted-foreground">Nobody matches “{search}”.</p>}
      <div className={cn("grid gap-3", source === "contacts_page" && "md:grid-cols-2")}>
        {people.map(p => <TeamMemberCard key={p.userId} person={p} source={source} />)}
      </div>
    </section>
  );
}

function TeamMemberCard({ person, source }: { person: TeamMember; source: Exclude<RevealSource, "people_record"> }) {
  const reveal = useRevealEmergencyContact();
  const [shown, setShown] = useState<Revealed | null>(null);
  const [editing, setEditing] = useState(false);

  const open = async () => {
    if (shown) { setShown(null); setEditing(false); return; }
    try { setShown(await reveal.mutateAsync({ userId: person.userId, source })); } catch { /* error shown below */ }
  };

  return (
    <div className={cn("rounded-2xl border-2 bg-card shadow-sm min-w-0", shown ? "border-primary/50" : "border-border")}>
      <button onClick={open} className="w-full text-left p-4 flex items-center gap-3 min-w-0" aria-expanded={!!shown}>
        <UserAvatar name={person.name} avatarUrl={person.avatarUrl} size="lg" />
        <div className="flex-1 min-w-0">
          <p className="font-display font-bold text-lg leading-tight truncate">{person.name}</p>
          {person.jobTitle && <p className="text-sm text-muted-foreground truncate">{person.jobTitle}</p>}
          {person.hasContact && !shown && <p className="text-sm text-muted-foreground">Tap to see who to call</p>}
        </div>
        {reveal.isPending ? <Loader2 className="w-6 h-6 animate-spin text-muted-foreground shrink-0" />
          : shown ? <ChevronUp className="w-6 h-6 text-muted-foreground shrink-0" />
          : <ChevronDown className="w-6 h-6 text-muted-foreground shrink-0" />}
      </button>
      {!person.hasContact && !shown && (
        <p className="mx-4 mb-4 -mt-1 rounded-xl bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 px-3 py-2 text-sm font-semibold">
          No emergency contact on file — they'll be asked next time they sign in
        </p>
      )}
      {reveal.isError && !shown && (
        <p className="px-4 pb-4 text-sm text-destructive flex items-center gap-1.5">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {(reveal.error as Error).message}
        </p>
      )}
      {shown && (
        <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
          {editing ? (
            <CorrectContact person={person} contact={shown.contact} source={source}
              onDone={c => { setShown({ ...shown, contact: c }); setEditing(false); toast({ title: "Saved", description: `${person.name.split(" ")[0]}'s emergency contact is updated.` }); }} onCancel={() => setEditing(false)} />
          ) : (
            <>
              <RevealedContact contact={shown.contact} personName={person.name} />
              <button onClick={() => setEditing(true)}
                className="h-11 px-3.5 rounded-xl border-2 border-border text-sm font-semibold inline-flex items-center gap-1.5 hover:bg-secondary/60">
                <Pencil className="w-4 h-4" /> {shown.contact ? "Correct it" : "Add one for them"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** One revealed contact: who, what they are to the person, a big call
 *  button; the second person if there is one. Shared with the People record. */
export function RevealedContact({ contact, personName }: { contact: EmergencyContact | null; personName: string }) {
  const first = personName.split(" ")[0];
  if (!contact) {
    return <p className="text-base font-semibold text-amber-700 dark:text-amber-400">No emergency contact on file for {first} — they'll be asked next time they sign in.</p>;
  }
  return (
    <div className="space-y-3">
      <div>
        <p className="text-xl font-bold break-words">{contact.name}</p>
        {contact.relationship && <p className="text-base text-muted-foreground">{first}'s {contact.relationship.toLowerCase()}</p>}
      </div>
      <CallButton phone={contact.phone} label={`Call ${contact.phone}`} className="w-full h-14 text-lg" />
      {contact.secondName && contact.secondPhone && (
        <div className="rounded-xl bg-secondary/40 p-3 space-y-2">
          <p className="text-sm text-muted-foreground">If no answer, try</p>
          <p className="text-lg font-bold break-words">
            {contact.secondName}{contact.secondRelationship && <span className="font-normal text-muted-foreground"> · {contact.secondRelationship}</span>}
          </p>
          <CallButton phone={contact.secondPhone} label={`Call ${contact.secondPhone}`} className="w-full" />
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Updated {fmtDay(contact.updatedAt, true)}
        {contact.source === "onboarding" ? " — from their new-starter form" : contact.source === "manager" && contact.updatedByName ? ` by ${contact.updatedByName}` : ` by ${first}`}
      </p>
    </div>
  );
}

export function CorrectContact({ person, contact, source, onDone, onCancel }: {
  person: Pick<TeamMember, "userId" | "name">;
  contact: EmergencyContact | null;
  source: RevealSource;
  onDone: (c: EmergencyContact) => void;
  onCancel: () => void;
}) {
  const correct = useCorrectEmergencyContact();
  const initial = useMemo(() => toInput(contact), [contact]);
  const first = person.name.split(" ")[0];
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <p className="flex-1 text-base font-bold">{contact ? `Correct ${first}'s emergency contact` : `Add ${first}'s emergency contact`}</p>
        <button onClick={onCancel} className="w-10 h-10 rounded-lg flex items-center justify-center hover:bg-secondary" aria-label="Stop editing">
          <X className="w-5 h-5" />
        </button>
      </div>
      <EmergencyContactForm
        initial={initial}
        whose={`${first}'s`}
        onSave={async data => { const out = await correct.mutateAsync({ userId: person.userId, source, data }); onDone(out.contact); }}
      />
    </div>
  );
}
