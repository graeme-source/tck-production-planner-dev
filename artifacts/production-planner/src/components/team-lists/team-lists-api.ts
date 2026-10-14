/**
 * Team lists — types and React Query hooks (Graeme, 2026-10-13).
 * "team-lists" feeds the dashboard card, the quick-actions panel and /lists;
 * ["team-lists", id] feeds one list. Every change invalidates both, so a tick
 * on one screen shows on the others.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RecurrenceRule } from "@workspace/recurrence";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface Progress { total: number; done: number; overdue: number }

export interface TeamListSummary {
  id: number;
  name: string;
  description: string | null;
  emoji: string | null;
  color: string | null;
  memberIds: number[];
  sortOrder: number;
  archived: boolean;
  /** May change the list itself (managers/admins with access). Everyone who
   *  can see the list can tick its tasks. */
  canEdit: boolean;
  itemCount: number;
  progress: Progress;
}

export interface TeamListItem {
  id: number;
  listId: number;
  title: string;
  notes: string | null;
  url: string | null;
  priority: 1 | 2 | 3 | 4;
  recurrence: RecurrenceRule;
  timeOfDay: string | null;
  carryOver: boolean;
  startDate: string;
  sortOrder: number;
  active: boolean;
}

export interface DayEntry {
  itemId: number;
  dueDate: string;
  overdue: boolean;
  completion: { status: "done" | "skipped"; byName: string | null; at: string } | null;
}

export interface TeamListDetail {
  today: string;
  list: Omit<TeamListSummary, "itemCount" | "progress">;
  items: TeamListItem[];
  entries: DayEntry[];
  progress: Progress;
  /** The next 7 days (weekly-and-rarer tasks only). Each entry can be ticked
   *  early; the tick is stored against that day (Graeme, 2026-10-14). */
  comingUp: Array<{ date: string; itemIds: number[]; entries: DayEntry[] }>;
}

export interface ListInput {
  name: string;
  description: string | null;
  emoji: string | null;
  color: string | null;
  memberIds: number[];
}

export type ItemInput = Pick<TeamListItem, "title" | "notes" | "url" | "priority" | "recurrence" | "timeOfDay" | "carryOver">;

export const TEAM_LISTS_KEY = ["team-lists"] as const;
const listKey = (id: number) => ["team-lists", id] as const;

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

function send(path: string, method: string, body?: unknown) {
  return fetch(`${BASE}/api/team-lists${path}`, {
    method,
    credentials: "include",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export interface TeamListsResponse {
  today: string;
  canCreate: boolean;
  /** Show the Team lists section at all (server rule teamListsVisible):
   *  the person can open an active list, or is an admin. */
  visible: boolean;
  lists: TeamListSummary[];
}

/** Lists this person can open. Anyone signed in may ask — the server only
 *  returns the lists they're ticked on (all of them for admins). */
export function useTeamLists(enabled = true, archived = false) {
  return useQuery<TeamListsResponse>({
    queryKey: archived ? [...TEAM_LISTS_KEY, "with-archived"] : TEAM_LISTS_KEY,
    queryFn: async () => json(await send(archived ? "?archived=1" : "", "GET")),
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useTeamList(id: number | null) {
  return useQuery<TeamListDetail>({
    queryKey: listKey(id ?? 0),
    queryFn: async () => json(await send(`/${id}`, "GET")),
    enabled: id != null,
    staleTime: 15_000,
    refetchInterval: 60_000,
  });
}

export function useTeamListPeople(enabled: boolean) {
  return useQuery<Array<{ id: number; name: string; role: string }>>({
    queryKey: [...TEAM_LISTS_KEY, "people"],
    queryFn: async () => json(await send("/people", "GET")),
    enabled,
    staleTime: 5 * 60_000,
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: TEAM_LISTS_KEY });
}

export function useCreateList() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (data: ListInput) => json<TeamListSummary>(await send("", "POST", data)),
    onSuccess: invalidate,
  });
}

export function useUpdateList() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<ListInput> & { archived?: boolean } }) =>
      json<TeamListSummary>(await send(`/${id}`, "PATCH", data)),
    onSuccess: invalidate,
  });
}

export function useAddItem(listId: number) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (data: Partial<ItemInput> & { title: string }) => json<TeamListItem>(await send(`/${listId}/items`, "POST", data)),
    onSuccess: invalidate,
  });
}

/** Plain async save for the autosaving edit modal (useAutosave wants a
 *  promise); the caller invalidates when it closes. */
export async function patchItem(id: number, data: Partial<ItemInput> & { active?: boolean }): Promise<TeamListItem> {
  return json<TeamListItem>(await send(`/items/${id}`, "PATCH", data));
}

export function useUpdateItem() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<ItemInput> & { active?: boolean } }) => patchItem(id, data),
    onSuccess: invalidate,
  });
}

export function useReorderItems(listId: number) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (itemIds: number[]) => json(await send(`/${listId}/reorder`, "POST", { itemIds })),
    onSuccess: invalidate,
  });
}

export function useTick() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({ itemId, dueDate, status, undo }: { itemId: number; dueDate: string; status?: "done" | "skipped"; undo?: boolean }) =>
      undo
        ? json(await send(`/items/${itemId}/untick`, "POST", { dueDate }))
        : json(await send(`/items/${itemId}/tick`, "POST", { dueDate, status: status ?? "done" })),
    onSuccess: invalidate,
  });
}

export function useImportTodoist(listId: number) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (csv: string) =>
      json<{ created: number; skipped: number; warnings: Array<{ itemId: number; title: string; warning: string }> }>(
        await send(`/${listId}/import`, "POST", { csv }),
      ),
    onSuccess: invalidate,
  });
}

export const PRIORITY_STYLES: Record<number, { label: string; dot: string; ring: string }> = {
  1: { label: "P1", dot: "bg-red-500", ring: "border-red-500" },
  2: { label: "P2", dot: "bg-orange-500", ring: "border-orange-500" },
  3: { label: "P3", dot: "bg-blue-500", ring: "border-blue-500" },
  4: { label: "P4", dot: "bg-muted-foreground/40", ring: "border-border" },
};

export function progressText(p: Progress): string {
  if (p.total === 0) return "Nothing due today";
  const base = `${p.done} of ${p.total} done`;
  return p.overdue > 0 ? `${base} · ${p.overdue} overdue` : base;
}
