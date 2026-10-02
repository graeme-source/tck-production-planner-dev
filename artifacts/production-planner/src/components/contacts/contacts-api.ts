/**
 * Contacts directory — types and React Query hooks (Graeme, 2026-10-02).
 * One query ("contacts") feeds the Contacts page, the station Contacts
 * button and the pinned chip, so an edit shows everywhere at once.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export type ContactCategory = "emergency" | "carrier" | "service" | "supplier" | "other";

export interface Contact {
  id: number;
  name: string;
  organisation: string | null;
  role: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  category: ContactCategory;
  stationKeys: string[];
  pinned: boolean;
  useFor: string | null;
  sortOrder: number;
  updatedByName: string | null;
  updatedAt: string;
}

/** A supplier's own contact details, read from the suppliers table. */
export interface SupplierContact {
  id: number;
  name: string;
  contactName: string | null;
  phone: string | null;
  orderingPhone: string | null;
  email: string | null;
  website: string | null;
}

export interface ContactsResponse {
  contacts: Contact[];
  suppliers: SupplierContact[];
}

export type ContactInput = Pick<Contact, "name" | "organisation" | "role" | "phone" | "email" | "notes" | "category" | "stationKeys" | "pinned" | "sortOrder">;

export const CONTACTS_KEY = ["contacts"] as const;

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

export function useContacts() {
  return useQuery<ContactsResponse>({
    queryKey: CONTACTS_KEY,
    queryFn: async () => json(await fetch(`${BASE}/api/contacts`, { credentials: "include" })),
    staleTime: 5 * 60 * 1000,
  });
}

export function useSaveContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: number | null; data: ContactInput }) =>
      json<Contact>(await fetch(`${BASE}/api/contacts${id ? `/${id}` : ""}`, {
        method: id ? "PATCH" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })),
    onSuccess: () => qc.invalidateQueries({ queryKey: CONTACTS_KEY }),
  });
}

export function useDeleteContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) =>
      json<{ ok: true }>(await fetch(`${BASE}/api/contacts/${id}`, { method: "DELETE", credentials: "include" })),
    onSuccess: () => qc.invalidateQueries({ queryKey: CONTACTS_KEY }),
  });
}

export function useRestoreContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) =>
      json<Contact>(await fetch(`${BASE}/api/contacts/${id}/restore`, { method: "POST", credentials: "include" })),
    onSuccess: () => qc.invalidateQueries({ queryKey: CONTACTS_KEY }),
  });
}

export const CATEGORY_GROUPS: Array<{ key: string; label: string; categories: ContactCategory[] }> = [
  { key: "emergency", label: "Emergency", categories: ["emergency"] },
  { key: "carriers", label: "Carriers & services", categories: ["carrier", "service"] },
  { key: "suppliers", label: "Suppliers", categories: ["supplier"] },
  { key: "other", label: "Other", categories: ["other"] },
];

export const CATEGORY_LABELS: Record<ContactCategory, string> = {
  emergency: "Emergency",
  carrier: "Carrier",
  service: "Service",
  supplier: "Supplier",
  other: "Other",
};

/** What a use_for key means, in words, for the badge on the card. */
export const USE_FOR_LABELS: Record<string, string> = {
  apc_customer_service: "Shown on APC booking failures",
};

/** "01908 586999" → "tel:01908586999". */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

/** Contacts shown on a station: any whose station list includes one of
 *  the station's keys. */
export function contactsForStation(contacts: readonly Contact[], stationKeys: readonly string[]): Contact[] {
  return contacts.filter(c => c.stationKeys.some(k => stationKeys.includes(k)));
}

/** Short label for the always-visible chip: the organisation if there is
 *  one ("APC"), otherwise the name. */
export function chipLabel(c: Pick<Contact, "name" | "organisation">): string {
  return c.organisation?.trim() || c.name;
}

/** Pages outside the station screens that ARE a station's working screen.
 *  Order Packing Live is the packing station's production view (the
 *  packing station redirects there), and Dispatches is where packing
 *  books couriers. */
export const PAGE_STATION_KEYS: Record<string, string[]> = {
  "/fulfilment": ["packing"],
  "/dispatches": ["packing"],
};
