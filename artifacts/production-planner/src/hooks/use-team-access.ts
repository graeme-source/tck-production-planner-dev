/**
 * Data for Settings → Team & Access (Graeme, 2026-09-30 redesign).
 *
 * Every endpoint here already existed; this only gathers them behind React
 * Query so the one Team list and the Access modal read from the same cache:
 *
 *   GET  /api/users                          accounts (admins get full rows)
 *   PUT  /api/users/:id                      role / active / name / email / password
 *   DEL  /api/users/:id
 *   GET  /api/features                       registry + grants + SOP training (admin)
 *   PUT|DELETE /api/features/:key/grants/:id grant / remove one feature
 *   GET  /api/people-access/users            People access state (admin)
 *   PUT  /api/people-access/users/:id        founder only
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getListUsersQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/auth-context";
import type { Role } from "@workspace/feature-registry";
import type { PeopleAccessState } from "@/lib/people-access-labels";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export const FEATURES_KEY = ["/api/features"];
export const PEOPLE_ACCESS_KEY = ["/api/people-access/users"];

export type TeamUser = {
  id: number;
  name: string;
  email?: string;
  role: Role;
  isActive: boolean;
  isProductionPlanner?: boolean;
  avatarUrl?: string | null;
  createdAt?: string;
};

export type FeatureRow = {
  key: string;
  name: string;
  description: string | null;
  requiredSopId: number | null;
  area: string;
  kind: "page" | "settings" | "ability" | "retired";
  target: string | null;
  baselineRole: Role | null;
  founderOnly?: boolean;
  retired: boolean;
};
export type GrantRow = { id: number; featureKey: string; userId: number };
export type FeaturesData = {
  features: FeatureRow[];
  grants: GrantRow[];
  sops: Array<{ id: number; title: string }>;
  gateEnforced: boolean;
  trainingByGrant: Record<number, boolean>;
};

export type PeopleAccessRow = {
  id: number;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  isFounder: boolean;
  state: PeopleAccessState;
  grantedAt: string | null;
  grantedByName: string | null;
};
export type PeopleAccessData = { canGrant: boolean; reason: string | null; users: PeopleAccessRow[] };

export async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...init });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body as T;
}

function useIsAdmin() {
  const { state } = useAuth();
  return state.status === "authenticated" && state.user.role === "admin";
}

export function useTeamFeatures() {
  const isAdmin = useIsAdmin();
  return useQuery<FeaturesData>({
    queryKey: FEATURES_KEY,
    queryFn: () => jsonFetch<FeaturesData>(`${BASE}/api/features`),
    enabled: isAdmin,
  });
}

export function usePeopleAccessList() {
  const isAdmin = useIsAdmin();
  return useQuery<PeopleAccessData>({
    queryKey: PEOPLE_ACCESS_KEY,
    queryFn: () => jsonFetch<PeopleAccessData>(`${BASE}/api/people-access/users`),
    enabled: isAdmin,
  });
}

/** Everything a change to one account can alter on this tab. */
function useInvalidateTeam() {
  const qc = useQueryClient();
  return () => Promise.all([
    qc.invalidateQueries({ queryKey: getListUsersQueryKey() }),
    qc.invalidateQueries({ queryKey: FEATURES_KEY }),
    qc.invalidateQueries({ queryKey: PEOPLE_ACCESS_KEY }),
  ]);
}

export type AccountPatch = {
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  isProductionPlanner: boolean;
  password?: string;
};

/** PUT /api/users/:id. The endpoint wants the whole account each time, so
 *  callers merge their one change into the current values. Throws the
 *  server's own refusal message (e.g. a People-access account). */
export function useUpdateAccount() {
  const invalidate = useInvalidateTeam();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: AccountPatch }) =>
      jsonFetch<TeamUser>(`${BASE}/api/users/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }),
    onSuccess: () => { void invalidate(); },
  });
}

export function useDeleteAccount() {
  const invalidate = useInvalidateTeam();
  return useMutation({
    mutationFn: (id: number) => jsonFetch<void>(`${BASE}/api/users/${id}`, { method: "DELETE" }),
    onSuccess: () => { void invalidate(); },
  });
}

export function useSetFeatureGrant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, userId, grant }: { key: string; userId: number; grant: boolean }) =>
      jsonFetch(`${BASE}/api/features/${encodeURIComponent(key)}/grants/${userId}`, {
        method: grant ? "PUT" : "DELETE",
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: FEATURES_KEY }),
  });
}

export function useSetPeopleAccess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, enabled }: { userId: number; enabled: boolean }) =>
      jsonFetch<PeopleAccessRow>(`${BASE}/api/people-access/users/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      }),
    onSuccess: (row) => {
      qc.setQueryData<PeopleAccessData>(PEOPLE_ACCESS_KEY, old =>
        old ? { ...old, users: old.users.some(u => u.id === row.id) ? old.users.map(u => (u.id === row.id ? row : u)) : [...old.users, row] } : old);
      void qc.invalidateQueries({ queryKey: PEOPLE_ACCESS_KEY });
    },
  });
}
