/**
 * Forced testing — React Query hooks over /api/test-requests (Objectives E
 * and F). The tester's queries are keyed by user id so a PIN switch on a
 * shared iPad never shows one person's test to the next.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MyTestRequest, TestAnswer, TestStatus } from "@/lib/test-requests";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = `${BASE}/api/test-requests`;

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...init });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const details = body?.details?.fieldErrors ? Object.values(body.details.fieldErrors as Record<string, string[]>).flat()[0] : null;
    throw new Error(details ?? body.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

const post = <T,>(url: string, body: unknown = {}) => call<T>(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const MINE_KEY = (userId: number | null) => ["test-requests", "mine", userId] as const;

export function useMyTestRequests(userId: number | null, enabled: boolean) {
  return useQuery({
    queryKey: MINE_KEY(userId),
    queryFn: async () => (await call<{ requests: MyTestRequest[] }>(`${API}/mine`)).requests,
    enabled: enabled && userId != null,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true,
    staleTime: 60_000,
    retry: 1,
  });
}

/** Start / shown / on my to-do list / answer — each updates the tester's
 *  list straight away. */
export function useTesterActions(userId: number | null) {
  const qc = useQueryClient();
  const patch = (id: number, change: Partial<MyTestRequest> | null) =>
    qc.setQueryData<MyTestRequest[]>(MINE_KEY(userId), prev => (prev ?? []).flatMap(r => (r.id !== id ? [r] : change ? [{ ...r, ...change }] : [])));
  const refresh = () => qc.invalidateQueries({ queryKey: ["test-requests"] });

  const start = useMutation({
    mutationFn: (id: number) => post<{ ok: true }>(`${API}/${id}/start`),
    onSuccess: (_d, id) => patch(id, { startedAt: new Date().toISOString() }),
  });
  const prompted = useMutation({
    mutationFn: (id: number) => post<{ ok: true }>(`${API}/${id}/prompted`),
    onSuccess: (_d, id) => patch(id, { promptedAt: new Date().toISOString() }),
  });
  const later = useMutation({
    mutationFn: (id: number) => post<{ todoTaskId: number }>(`${API}/${id}/later`),
    onSuccess: (d, id) => {
      patch(id, { todoTaskId: d.todoTaskId });
      qc.invalidateQueries({ queryKey: ["todos"] });
    },
  });
  const answer = useMutation({
    mutationFn: async (v: { id: number; answer: TestAnswer; note: string; photo: File | null }) => {
      // Photo first, so the answer only lands once everything is in.
      if (v.photo) {
        const fd = new FormData();
        fd.append("file", v.photo);
        await call(`${API}/${v.id}/photo`, { method: "POST", body: fd });
      }
      await post(`${API}/${v.id}/answer`, { answer: v.answer, note: v.note.trim() || null });
    },
    onSuccess: (_d, v) => { patch(v.id, null); refresh(); qc.invalidateQueries({ queryKey: ["todos"] }); },
  });
  return { start, prompted, later, answer };
}

// ── The managers' page ─────────────────────────────────────────────────────
export type TesterView = {
  userId: number;
  name: string;
  isReporter: boolean;
  startedAt: string | null;
  promptedAt: string | null;
  onTodoList: boolean;
  answer: TestAnswer | null;
  answerLabel: string | null;
  note: string | null;
  hasPhoto: boolean;
  answeredAt: string | null;
};

export type TestRequestView = {
  id: number;
  title: string;
  steps: string;
  linkPath: string | null;
  onlyOnPath: string | null;
  notBefore: string | null;
  dailyFrom: string | null;
  dailyUntil: string | null;
  whenText: string | null;
  andonIssueId: number | null;
  source: "person" | "deploy";
  fixRef: string | null;
  createdByName: string;
  closedAt: string | null;
  closedByName: string | null;
  closeNote: string | null;
  createdAt: string;
  updatedAt: string;
  status: TestStatus;
  issue: { id: number; description: string | null; station: string; reportedByName: string | null } | null;
  improvementId: number | null;
  improvement: { id: number; title: string; submittedByName: string | null } | null;
  testers: TesterView[];
};

export type ListTab = "open" | "problems" | "answered" | "closed" | "all";

export function useTestRequestList(tab: ListTab) {
  return useQuery({
    queryKey: ["test-requests", "list", tab],
    queryFn: () => call<{ requests: TestRequestView[]; counts: Record<ListTab, number> }>(`${API}?tab=${tab}`),
    refetchInterval: 60_000,
  });
}

export function testerPhotoUrl(requestId: number, userId: number): string {
  return `${API}/${requestId}/testers/${userId}/photo`;
}

export type NewTestRequest = {
  title: string;
  steps: string;
  linkPath: string | null;
  onlyOnPath: string | null;
  notBefore: string | null;
  dailyFrom: string | null;
  dailyUntil: string | null;
  whenText: string | null;
  andonIssueId: number | null;
  improvementId: number | null;
  testerIds: number[];
};

export function useCreateTestRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: NewTestRequest) => post<{ id: number }>(API, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["test-requests"] }),
  });
}

export function useCloseTestRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; reopen?: boolean; note?: string }) =>
      post(`${API}/${v.id}/${v.reopen ? "reopen" : "close"}`, v.reopen ? {} : { note: v.note?.trim() || null }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["test-requests"] }),
  });
}

export type IssueReporter = { id: number; description: string | null; station: string; reportedBy: number | null; reportedByName: string | null };

export function useIssueReporter(issueId: number | null) {
  return useQuery({
    queryKey: ["test-requests", "issue", issueId],
    queryFn: () => call<IssueReporter>(`${API}/issue/${issueId}`),
    enabled: issueId != null && issueId > 0,
    retry: false,
  });
}

export type ImprovementSubmitter = { id: number; title: string; station: string; submittedBy: number | null; submittedByName: string | null };

export function useImprovementSubmitter(improvementId: number | null) {
  return useQuery({
    queryKey: ["test-requests", "improvement", improvementId],
    queryFn: () => call<ImprovementSubmitter>(`${API}/improvement/${improvementId}`),
    enabled: improvementId != null && improvementId > 0,
    retry: false,
  });
}

export type TeamMember = { id: number; name: string; role: string; isActive: boolean };

export function useTeamMembers() {
  return useQuery({
    queryKey: ["test-requests", "team"],
    queryFn: async () => (await call<TeamMember[]>(`${BASE}/api/users`)).filter(u => u.isActive),
    staleTime: 5 * 60_000,
  });
}
