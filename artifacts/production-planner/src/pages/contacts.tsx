/**
 * Contacts (Graeme, 2026-10-02) — the one place the team's phone numbers
 * live: emergency contacts, carriers and service engineers, plus every
 * supplier's details read straight from the supplier records. Big cards,
 * tap-to-call. Managers and admins add and edit; each contact can be shown
 * on chosen stations (and pinned there as an always-visible chip).
 * Objective D (despatch) and safety.
 */
import { useMemo, useState } from "react";
import { Plus, Search, X, Loader2, BookUser } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { useAuth } from "@/contexts/auth-context";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { CATEGORY_GROUPS, useContacts, type Contact, type ContactCategory, type SupplierContact } from "@/components/contacts/contacts-api";
import { ContactCard, SupplierContactCard } from "@/components/contacts/contact-card";
import { ContactEditDialog } from "@/components/contacts/contact-edit-dialog";
import { ApcPostcodeOverridesList } from "@/components/apc-postcode-overrides";

/** The contact the APC booking-failure flow uses; its recorded postcode
 *  answers are listed under its card. Matched on the machine key, not on
 *  a name. */
const APC_USE_FOR = "apc_customer_service";

function matches(text: string, ...fields: Array<string | null | undefined>): boolean {
  return fields.some(f => f?.toLowerCase().includes(text));
}

export default function ContactsPage() {
  const { state } = useAuth();
  const role = state.status === "authenticated" ? state.user.role : "viewer";
  const canEdit = role === "admin" || role === "manager";
  const { data, isLoading, error } = useContacts();
  const [search, setSearch] = useState("");
  const q = useDebouncedValue(search).trim().toLowerCase();
  const [editing, setEditing] = useState<{ contact: Contact | null; category?: ContactCategory } | null>(null);

  const contacts = useMemo(
    () => (data?.contacts ?? []).filter(c => !q || matches(q, c.name, c.organisation, c.role, c.notes, c.phone, c.email)),
    [data, q],
  );
  const suppliers = useMemo(
    () => (data?.suppliers ?? []).filter((s: SupplierContact) => !q || matches(q, s.name, s.contactName, s.phone, s.email)),
    [data, q],
  );

  return (
    <div className="space-y-6 max-w-6xl">
      <PageHeader
        title="Contacts"
        description="Tap a number to call"
        action={canEdit ? (
          <button
            onClick={() => setEditing({ contact: null })}
            className="h-10 px-4 bg-primary text-primary-foreground rounded-xl font-semibold flex items-center gap-2 hover:bg-primary/90"
          >
            <Plus className="w-5 h-5" /> <span className="hidden sm:inline">Add contact</span>
          </button>
        ) : undefined}
      />

      <div className="relative">
        <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search names, companies, numbers…"
          className="w-full h-14 rounded-2xl border-2 border-border bg-card pl-12 pr-12 text-base focus:outline-none focus:border-primary"
          aria-label="Search contacts"
        />
        {search && (
          <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-lg flex items-center justify-center hover:bg-secondary" aria-label="Clear search">
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {isLoading && <p className="text-muted-foreground flex items-center gap-2"><Loader2 className="w-5 h-5 animate-spin" /> Loading contacts…</p>}
      {error && <p className="text-red-700 dark:text-red-300">Couldn't load contacts — {(error as Error).message}</p>}

      {!isLoading && !error && CATEGORY_GROUPS.map(group => {
        const inGroup = contacts.filter(c => group.categories.includes(c.category));
        const supplierCards = group.key === "suppliers" ? suppliers : [];
        if (inGroup.length === 0 && supplierCards.length === 0 && (q || !canEdit)) return null;
        return (
          <section key={group.key} className="space-y-3">
            <div className="flex items-center gap-3">
              <h2 className="font-display font-bold text-xl flex-1">{group.label}</h2>
              {canEdit && (
                <button
                  onClick={() => setEditing({ contact: null, category: group.categories[0] })}
                  className="h-10 px-3 rounded-lg border border-border text-sm font-medium inline-flex items-center gap-1.5 hover:bg-secondary/60"
                >
                  <Plus className="w-4 h-4" /> Add
                </button>
              )}
            </div>
            {inGroup.length === 0 && supplierCards.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing here yet.</p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {inGroup.map(c => (
                  <ContactCard key={c.id} contact={c} onEdit={canEdit ? () => setEditing({ contact: c }) : undefined}>
                    {c.useFor === APC_USE_FOR && <ApcPostcodeOverridesList />}
                  </ContactCard>
                ))}
                {supplierCards.map(s => <SupplierContactCard key={`s-${s.id}`} supplier={s} canEdit={canEdit} />)}
              </div>
            )}
            {group.key === "suppliers" && supplierCards.length > 0 && (
              <p className="text-xs text-muted-foreground">Supplier numbers come from each supplier's record — edit them there, so there's only one copy.</p>
            )}
          </section>
        );
      })}

      {!isLoading && !error && q && contacts.length === 0 && suppliers.length === 0 && (
        <div className="rounded-2xl border-2 border-dashed border-border p-8 text-center text-muted-foreground">
          <BookUser className="w-8 h-8 mx-auto mb-2" />
          Nobody matches “{search}”.
        </div>
      )}

      {editing && (
        <ContactEditDialog contact={editing.contact} defaultCategory={editing.category} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
