/** Raw meat portioning: GET /api/ingredients/meat-portioning, PUT /:id/meat-portioning. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DEFAULT_PORTIONING, type MeatPortioning } from "@/lib/meat-portioning";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const KEY = ["meat-portioning"] as const;

export function useMeatPortioning() {
  const query = useQuery<MeatPortioning[]>({
    queryKey: KEY,
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/ingredients/meat-portioning`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 5 * 60_000,
  });
  const byId = new Map((query.data ?? []).map(m => [m.id, m]));
  return { ...query, of: (id: number): MeatPortioning => byId.get(id) ?? { id, ...DEFAULT_PORTIONING } };
}

export function useSaveMeatPortioning(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<Omit<MeatPortioning, "id">>) => {
      const res = await fetch(`${BASE}/api/ingredients/${id}/meat-portioning`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      return body as MeatPortioning;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
