/**
 * People — the one front door to staff records, for the named RTW managers
 * (Graeme and Lorna) ONLY. Born from 2026-09-16 feedback: reaching the
 * Employee Records report meant remembering "Analytics → Employee Records →
 * the little button", and return-to-work forms lived somewhere else again.
 *
 * Everything behind this page is people-data, so entry asks for the PIN
 * every time, admins included — same posture as the Employee Hub. The page
 * itself holds nothing sensitive (it's a signpost); each destination keeps
 * its own server-side guards.
 */
import { Link } from "wouter";
import { Loader2, HeartPulse, UserCog, ClipboardList, ChevronRight, Lock } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useIsRtwManager } from "@/hooks/use-rtw-manager";
import { useSensitivePinGate } from "@/hooks/use-sensitive-pin-gate";

const CARDS = [
  {
    href: "/reports?tab=employees",
    icon: UserCog,
    title: "Employee Records",
    blurb: "Attendance, lateness and sick-leave numbers from Planday — the full report, per person.",
  },
  {
    href: "/return-to-work",
    icon: HeartPulse,
    title: "Return-to-work forms",
    blurb: "Sick-leave forms and their documents — fit notes, appointment letters. You and Lorna only.",
  },
  {
    // ?section=reviews, NOT bare /hub: the hub opens on My To-dos by default,
    // so this card used to land on your own to-do list and the "Whose record?"
    // people list was never reached (Graeme, 2026-09-17).
    href: "/hub?section=reviews",
    icon: ClipboardList,
    title: "Reviews & Record",
    blurb: "Pick a person and see their whole record — probation meetings, reviews, 1:1s and notes.",
  },
];

export default function PeopleRecordsPage() {
  const { state } = useAuth();
  const isRtwManager = useIsRtwManager();
  // The PIN is asked for HERE, at the front door of the people area: the
  // scenario is picking up Lorna's logged-in tablet and tapping People, and
  // the signpost itself already names who has records on file. `fresh`, so
  // it asks on every entry however recently the PIN was typed elsewhere
  // (Graeme, 2026-09-17). The three destinations keep their own gates on the
  // 5-minute unlock window, so walking through from here is one PIN, not two,
  // while deep-linking straight to one of them still asks.
  // Waits for the access flag so nobody who is about to be turned away is
  // asked for a PIN first.
  useSensitivePinGate({ enabled: isRtwManager, includeAdmins: true, fresh: true, entryKey: "people-records", scope: "people" });

  if (state.status !== "authenticated") {
    return <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }

  if (!isRtwManager) {
    return (
      <div className="max-w-lg mx-auto text-center py-16 space-y-3">
        <Lock className="w-8 h-8 mx-auto text-muted-foreground" />
        <p className="text-2xl font-bold">Nothing here for you</p>
        <p className="text-base text-muted-foreground">Staff records are only open to people Graeme has given People access.</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="font-display text-3xl font-bold">People</h1>
        <p className="text-base text-muted-foreground mt-1">
          Staff records in one place — visible only to people Graeme has given People access.
        </p>
      </div>

      <div className="space-y-4">
        {CARDS.map(c => (
          <Link
            key={c.href}
            href={c.href}
            className="block rounded-2xl border-2 border-border bg-card hover:border-primary/50 active:scale-[0.995] transition-all p-5"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
                <c.icon className="w-6 h-6 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xl font-bold leading-snug">{c.title}</p>
                <p className="text-base text-muted-foreground mt-0.5">{c.blurb}</p>
              </div>
              <ChevronRight className="w-6 h-6 text-muted-foreground shrink-0" />
            </div>
          </Link>
        ))}
      </div>

      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
        <Lock className="w-3.5 h-3.5" /> Every page here asks for your PIN on entry and keeps its own server-side privacy rules.
      </p>
    </div>
  );
}
