/**
 * Staff emergency contacts — types and React Query hooks (Graeme,
 * 2026-10-02). Server: api-server routes/staff-emergency-contacts.ts.
 *
 * A colleague's details are only ever fetched by a reveal (a POST the
 * server logs) and are never cached by React Query — each reveal is a
 * fresh, logged read.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = `${BASE}/api/staff-emergency-contacts`;

export type RevealSource = "contacts_page" | "station" | "people_record";

export interface EmergencyContact {
  name: string;
  phone: string;
  relationship: string | null;
  secondName: string | null;
  secondPhone: string | null;
  secondRelationship: string | null;
  /** self | manager | onboarding */
  source: string;
  updatedByName: string | null;
  updatedAt: string;
}

export interface EmergencyContactInput {
  name: string;
  phone: string;
  relationship: string;
  secondName: string;
  secondPhone: string;
  secondRelationship: string;
}

export interface MyEmergencyContact {
  contact: EmergencyContact | null;
  promptNeeded: boolean;
}

export interface TeamMember {
  userId: number;
  name: string;
  avatarUrl: string | null;
  jobTitle: string | null;
  hasContact: boolean;
  updatedAt: string | null;
}

export interface Revealed {
  person: { id: number; name: string };
  contact: EmergencyContact | null;
}

export const MY_EMERGENCY_CONTACT_KEY = ["staff-emergency-contacts", "me"] as const;
export const TEAM_EMERGENCY_CONTACTS_KEY = ["staff-emergency-contacts", "team"] as const;

/** A server refusal, with the status kept so callers can tell 403 / 423. */
export class EmergencyContactError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const b = body as { error?: string; details?: { fieldErrors?: Record<string, string[]>; formErrors?: string[] } };
    // validate() answers "Validation failed" with zod's details — surface
    // the first plain-English reason instead.
    const detail = b.details?.formErrors?.[0] ?? Object.values(b.details?.fieldErrors ?? {})[0]?.[0];
    throw new EmergencyContactError(detail ?? b.error ?? `Request failed (${res.status})`, res.status);
  }
  return body as T;
}

export function toInput(c: EmergencyContact | null | undefined): EmergencyContactInput {
  return {
    name: c?.name ?? "", phone: c?.phone ?? "", relationship: c?.relationship ?? "",
    secondName: c?.secondName ?? "", secondPhone: c?.secondPhone ?? "", secondRelationship: c?.secondRelationship ?? "",
  };
}

export function useMyEmergencyContact(enabled = true) {
  return useQuery<MyEmergencyContact>({
    queryKey: MY_EMERGENCY_CONTACT_KEY,
    queryFn: async () => json(await fetch(`${API}/me`, { credentials: "include" })),
    enabled,
    staleTime: 10 * 60 * 1000,
  });
}

export function useSaveMyEmergencyContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: EmergencyContactInput) =>
      json<{ contact: EmergencyContact }>(await fetch(`${API}/me`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })),
    onSuccess: (out) => {
      qc.setQueryData<MyEmergencyContact>(MY_EMERGENCY_CONTACT_KEY, { contact: out.contact, promptNeeded: false });
      void qc.invalidateQueries({ queryKey: TEAM_EMERGENCY_CONTACTS_KEY });
    },
  });
}

/** Managers/admins only — the server answers 403 to anyone else, so the
 *  caller passes enabled=false for them and the query never runs. */
export function useTeamEmergencyContacts(enabled: boolean) {
  return useQuery<{ people: TeamMember[] }>({
    queryKey: TEAM_EMERGENCY_CONTACTS_KEY,
    queryFn: async () => json(await fetch(`${API}/team`, { credentials: "include" })),
    enabled,
    staleTime: 60 * 1000,
  });
}

/** Reveal one colleague's contact — logged by the server on every call. */
export function useRevealEmergencyContact() {
  return useMutation({
    mutationFn: async ({ userId, source }: { userId: number; source: RevealSource }) =>
      json<Revealed>(await fetch(
        source === "people_record" ? `${API}/people/${userId}/view` : `${API}/team/${userId}/view`,
        {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source }),
        },
      )),
  });
}

/** A manager's correction of a colleague's contact (logged as an edit). */
export function useCorrectEmergencyContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, source, data }: { userId: number; source: RevealSource; data: EmergencyContactInput }) =>
      json<{ contact: EmergencyContact }>(await fetch(`${API}/team/${userId}?source=${source}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: TEAM_EMERGENCY_CONTACTS_KEY });
      // A manager correcting their own card changes "mine" too.
      void qc.invalidateQueries({ queryKey: MY_EMERGENCY_CONTACT_KEY });
    },
  });
}
