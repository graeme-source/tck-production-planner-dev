/**
 * One contact as a big card (Graeme's Spotify-style rule): name large, who
 * they are underneath, and tap-to-call / email as big buttons — on an iPad
 * or phone a tap on "Call" dials. Supplier cards are the same shape but
 * read from the supplier record, and link there for editing.
 */
import { Link } from "wouter";
import {
  Phone, Mail, Pencil, Siren, Truck, Wrench, Building2, UserRound, Pin, MessageCircle, ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { STATIONS } from "@/pages/station/shared/constants";
import { telHref, USE_FOR_LABELS, type Contact, type ContactCategory, type SupplierContact } from "./contacts-api";

const CATEGORY_STYLE: Record<ContactCategory, { icon: React.ComponentType<{ className?: string }>; tint: string }> = {
  emergency: { icon: Siren, tint: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300" },
  carrier: { icon: Truck, tint: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300" },
  service: { icon: Wrench, tint: "bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300" },
  supplier: { icon: Building2, tint: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" },
  other: { icon: UserRound, tint: "bg-secondary text-muted-foreground" },
};

function stationLabel(key: string): string {
  return STATIONS.find(s => s.key === key)?.label ?? key.replace(/_/g, " ");
}

export function CallButton({ phone, label, className }: { phone: string; label?: string; className?: string }) {
  return (
    <a
      href={telHref(phone)}
      className={cn(
        "inline-flex items-center justify-center gap-2 h-12 px-4 rounded-xl bg-primary text-primary-foreground font-semibold text-base shadow-sm hover:bg-primary/90 active:scale-[0.98] transition-all",
        className,
      )}
    >
      <Phone className="w-5 h-5 shrink-0" />
      <span className="truncate">{label ?? phone}</span>
    </a>
  );
}

function EmailButton({ email }: { email: string }) {
  return (
    <a
      href={`mailto:${email}`}
      className="inline-flex items-center justify-center gap-2 h-12 px-4 rounded-xl border-2 border-border bg-background font-semibold text-sm hover:bg-secondary/60 transition-colors min-w-0"
      title={email}
    >
      <Mail className="w-5 h-5 shrink-0" />
      <span className="truncate">{email}</span>
    </a>
  );
}

export function ContactCard({ contact, onEdit, children, compact }: {
  contact: Contact;
  /** Shown only to people who may edit. */
  onEdit?: () => void;
  /** Extra content under the card body (e.g. the APC overrides list). */
  children?: React.ReactNode;
  compact?: boolean;
}) {
  const style = CATEGORY_STYLE[contact.category] ?? CATEGORY_STYLE.other;
  const Icon = style.icon;
  const subtitle = [contact.organisation && contact.organisation !== contact.name ? contact.organisation : null, contact.role]
    .filter(Boolean).join(" · ");
  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm p-4 flex flex-col gap-3 min-w-0">
      <div className="flex items-start gap-3 min-w-0">
        <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center shrink-0", style.tint)}>
          <Icon className="w-6 h-6" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-display font-bold text-lg leading-tight break-words">{contact.name}</h3>
          {subtitle && <p className="text-sm text-muted-foreground break-words">{subtitle}</p>}
        </div>
        {onEdit && (
          <button
            onClick={onEdit}
            className="w-10 h-10 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary/60 shrink-0"
            title="Edit contact"
            aria-label={`Edit ${contact.name}`}
          >
            <Pencil className="w-4 h-4" />
          </button>
        )}
      </div>

      {contact.notes && !compact && <p className="text-sm text-foreground/80 whitespace-pre-line">{contact.notes}</p>}

      {(contact.phone || contact.email) && (
        <div className="flex flex-wrap gap-2">
          {contact.phone && <CallButton phone={contact.phone} className="flex-1 min-w-[12rem]" />}
          {contact.email && <EmailButton email={contact.email} />}
        </div>
      )}

      {!compact && (contact.stationKeys.length > 0 || contact.useFor) && (
        <div className="flex flex-wrap gap-1.5 text-xs">
          {contact.stationKeys.map(k => (
            <span key={k} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-muted-foreground">
              {contact.pinned && <Pin className="w-3 h-3" />}
              {stationLabel(k)}
            </span>
          ))}
          {contact.useFor && USE_FOR_LABELS[contact.useFor] && (
            <span className="rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-800 dark:text-blue-300 px-2.5 py-1">
              {USE_FOR_LABELS[contact.useFor]}
            </span>
          )}
        </div>
      )}
      {children}
    </div>
  );
}

export function SupplierContactCard({ supplier, canEdit }: { supplier: SupplierContact; canEdit: boolean }) {
  const style = CATEGORY_STYLE.supplier;
  const Icon = style.icon;
  // WhatsApp ordering numbers are stored international (+44…) for wa.me.
  const wa = supplier.orderingPhone?.replace(/[^\d]/g, "");
  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm p-4 flex flex-col gap-3 min-w-0">
      <div className="flex items-start gap-3 min-w-0">
        <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center shrink-0", style.tint)}>
          <Icon className="w-6 h-6" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-display font-bold text-lg leading-tight break-words">{supplier.name}</h3>
          {supplier.contactName && <p className="text-sm text-muted-foreground break-words">{supplier.contactName}</p>}
        </div>
        {canEdit && (
          <Link
            href={`/suppliers?edit=${supplier.id}`}
            className="h-10 px-3 rounded-lg border border-border flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/60 shrink-0"
            title="Edit on the supplier's record"
          >
            <ExternalLink className="w-4 h-4" /> <span className="hidden sm:inline">Supplier record</span>
          </Link>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {supplier.phone && <CallButton phone={supplier.phone} className="flex-1 min-w-[12rem]" />}
        {wa && (
          <a
            href={`https://wa.me/${wa}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 h-12 px-4 rounded-xl border-2 border-border bg-background font-semibold text-sm hover:bg-secondary/60"
            title="Orders by WhatsApp"
          >
            <MessageCircle className="w-5 h-5" /> WhatsApp orders
          </a>
        )}
        {supplier.email && <EmailButton email={supplier.email} />}
      </div>
    </div>
  );
}
