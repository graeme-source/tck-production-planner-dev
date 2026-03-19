import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export type PagePermission = {
  pageKey: string;
  label: string;
  minRole: "viewer" | "manager" | "admin";
};

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function fetchPermissions(): Promise<PagePermission[]> {
  const res = await fetch(`${BASE}/api/page-permissions`, { credentials: "include" });
  if (!res.ok) return [];
  return res.json();
}

async function savePermissions(updates: { pageKey: string; minRole: string }[]) {
  const res = await fetch(`${BASE}/api/page-permissions`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error("Failed to save permissions");
  return res.json();
}

const QUERY_KEY = ["page-permissions"];

const ROLE_RANK: Record<string, number> = { viewer: 0, manager: 1, admin: 2 };

export function usePagePermissions() {
  const { data = [], isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchPermissions,
    staleTime: 5 * 60 * 1000,
  });

  function minRoleFor(pageKey: string): string {
    return data.find(p => p.pageKey === pageKey)?.minRole ?? "viewer";
  }

  function canAccess(userRole: string, pageKey: string): boolean {
    const min = minRoleFor(pageKey);
    return (ROLE_RANK[userRole] ?? 0) >= (ROLE_RANK[min] ?? 0);
  }

  return { permissions: data, isLoading, minRoleFor, canAccess };
}

export function useSavePagePermissions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: savePermissions,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}
