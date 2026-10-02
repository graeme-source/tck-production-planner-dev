/**
 * Contacts where people work (Graeme, 2026-10-02):
 *  - StationPinnedContacts: the always-visible tap-to-call chip(s) for a
 *    station's pinned contacts — on packing, "APC 01908 586999".
 *  - StationContactsDialog: everything ticked for that station, opened from
 *    the station's Contacts button.
 * Both read the one "contacts" query, so edits show everywhere at once.
 */
import { createPortal } from "react-dom";
import { Link } from "wouter";
import { Phone, X, BookUser, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { chipLabel, contactsForStation, telHref, useContacts } from "./contacts-api";
import { ContactCard } from "./contact-card";
import { TeamEmergencyContacts } from "@/components/emergency-contacts/team-emergency-contacts";

export function StationPinnedContacts({ stationKeys, className }: { stationKeys: readonly string[]; className?: string }) {
  const { data } = useContacts();
  const pinned = contactsForStation(data?.contacts ?? [], stationKeys).filter(c => c.pinned && c.phone);
  if (pinned.length === 0) return null;
  return (
    <div className={cn("flex items-center gap-1.5 flex-shrink-0", className)}>
      {pinned.map(c => (
        <a
          key={c.id}
          href={telHref(c.phone!)}
          className="inline-flex items-center gap-1.5 h-9 px-2.5 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-900 dark:text-indigo-200 text-sm font-semibold whitespace-nowrap hover:bg-indigo-100 dark:hover:bg-indigo-900/50 flex-shrink-0"
          title={`Call ${c.name} — ${c.phone}`}
          aria-label={`Call ${c.name} on ${c.phone}`}
        >
          <Phone className="w-3.5 h-3.5 shrink-0" />
          <span>{chipLabel(c)}</span>
          {/* The number itself on iPad and up; a phone taps to dial anyway. */}
          <span className="hidden md:inline font-mono font-medium tabular-nums">{c.phone}</span>
        </a>
      ))}
    </div>
  );
}

export function StationContactsButton({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <button
      onClick={onClick}
      className={cn("hidden sm:flex items-center gap-1.5 h-9 px-2.5 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 flex-shrink-0", className)}
      title="Contacts for this station"
    >
      <BookUser className="w-4 h-4" />
      <span className="hidden xl:inline">Contacts</span>
    </button>
  );
}

export function StationContactsDialog({ stationKeys, stationLabel, onClose }: {
  stationKeys: readonly string[];
  stationLabel: string;
  onClose: () => void;
}) {
  const { data, isLoading, error } = useContacts();
  const list = contactsForStation(data?.contacts ?? [], stationKeys);
  // Emergency numbers first, then pinned, then the rest in directory order.
  const sorted = [...list].sort((a, b) =>
    Number(b.category === "emergency") - Number(a.category === "emergency") || Number(b.pinned) - Number(a.pinned));
  return createPortal(
    <div className="fixed inset-0 z-[120] bg-black/60 flex items-center justify-center p-2 sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Contacts for ${stationLabel}`}
        onClick={e => e.stopPropagation()}
        className="bg-background border-2 border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92dvh] flex flex-col overflow-hidden"
      >
        <div className="flex items-center gap-3 px-4 sm:px-5 py-3 border-b border-border shrink-0">
          <BookUser className="w-6 h-6 text-primary shrink-0" />
          <h2 className="flex-1 font-display font-bold text-xl truncate">Contacts · {stationLabel}</h2>
          <button onClick={onClose} className="w-10 h-10 rounded-lg flex items-center justify-center hover:bg-secondary" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 space-y-3">
          {isLoading && <p className="text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</p>}
          {error && <p className="text-red-700 dark:text-red-300">Couldn't load contacts — {(error as Error).message}</p>}
          {!isLoading && !error && sorted.length === 0 && (
            <p className="text-muted-foreground">No contacts are set to show on {stationLabel} yet.</p>
          )}
          {sorted.map(c => <ContactCard key={c.id} contact={c} />)}
          {/* Managers and admins: the team's emergency contacts, right here on
              the floor (renders nothing for anyone else; every look logged). */}
          <TeamEmergencyContacts source="station" className="pt-3 border-t border-border" />
        </div>
        <div className="px-4 sm:px-5 py-3 border-t border-border shrink-0">
          <Link href="/contacts" onClick={onClose} className="h-12 w-full rounded-xl border-2 border-border font-semibold flex items-center justify-center gap-2 hover:bg-secondary/60">
            <BookUser className="w-5 h-5" /> All contacts
          </Link>
        </div>
      </div>
    </div>,
    document.body,
  );
}
