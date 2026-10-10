/**
 * Automatic QUID — data (React Query). Server: routes/recipe-quid.ts;
 * the rules: api-server lib/quid-matcher.ts + lib/quid-plan.ts.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    credentials: "include",
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init?.headers } : init?.headers,
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

export type QuidSource = "auto" | "manual" | null;

export interface QuidViewItem {
  key: string;
  kind: "ingredient" | "subRecipe" | "component";
  label: string;
  quid: boolean;
  source: QuidSource;
  match: { term: string; level: "auto" | "suggest"; isCategory: boolean } | null;
}

export interface QuidView {
  recipeId: number;
  recipeName: string;
  items: QuidViewItem[];
  suggestions: Array<{ key: string; label: string; term: string }>;
  unmatched: string[];
  unwrapped: string[];
  deckText: string;
}

export const recipeQuidKey = (recipeId: number) => ["recipe-quid", recipeId] as const;

export function useRecipeQuid(recipeId: number | null) {
  return useQuery({
    queryKey: recipeQuidKey(recipeId ?? 0),
    queryFn: () => api<QuidView>(`/recipes/${recipeId}/quid`),
    enabled: recipeId != null && recipeId > 0,
    staleTime: 0,
  });
}

/** A person's answer for one line: true / false (manual), null = back to automatic. */
export function useSetQuid(recipeId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { key: string; quid: boolean | null }) =>
      api<QuidView>(`/recipes/${recipeId}/quid`, { method: "PUT", body: JSON.stringify(v) }),
    onSuccess: (view) => {
      qc.setQueryData(recipeQuidKey(recipeId), view);
      // The deck changed → the label list's "update needed" too.
      qc.invalidateQueries({ queryKey: ["product-labels"] });
    },
  });
}

export type QuidTermMode = "auto" | "suggest" | "ignore" | "guard";

export interface QuidTermRow {
  id: number;
  phrase: string;
  mode: QuidTermMode;
  targets: string[];
  categories: string[];
  isCategory: boolean;
  updatedAt: string;
  updatedByName: string | null;
}

export interface QuidTermInput {
  phrase: string;
  mode: QuidTermMode;
  targets?: string[];
  categories?: string[];
  isCategory?: boolean;
}

const TERMS_KEY = ["quid-terms"] as const;

export function useQuidTerms() {
  return useQuery({ queryKey: TERMS_KEY, queryFn: () => api<{ terms: QuidTermRow[] }>("/quid-terms") });
}

export function useSaveQuidTerm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id?: number; term: QuidTermInput }) =>
      api<QuidTermRow>(v.id ? `/quid-terms/${v.id}` : "/quid-terms", { method: v.id ? "PUT" : "POST", body: JSON.stringify(v.term) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: TERMS_KEY }),
  });
}

export function useDeleteQuidTerm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<{ ok: true }>(`/quid-terms/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: TERMS_KEY }),
  });
}

export interface BackfillReport { applied: boolean; text: string; recipes: Array<{ recipeId: number; name: string; ticks: unknown[]; unticks: unknown[]; suggestions: unknown[] }> }

export function useQuidBackfill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (apply: boolean) => api<BackfillReport>("/quid-backfill", { method: "POST", body: JSON.stringify({ apply }) }),
    onSuccess: (r) => {
      if (r.applied) {
        qc.invalidateQueries({ queryKey: ["recipe-quid"] });
        qc.invalidateQueries({ queryKey: ["product-labels"] });
      }
    },
  });
}

/** A recipe body without the lines' `quid`: the recipe form no longer owns
 *  QUID (the panel saves it on its own), and the server keeps each line's
 *  stored tick when none is sent — so a form opened before a tick was
 *  changed can never undo it on Save. */
export function withoutQuid<T extends { ingredients?: Array<Record<string, unknown>>; subRecipes?: Array<Record<string, unknown>> }>(body: T): T {
  const strip = (lines?: Array<Record<string, unknown>>) => lines?.map(({ quid: _quid, ...line }) => line);
  return { ...body, ingredients: strip(body.ingredients), subRecipes: strip(body.subRecipes) } as T;
}

/** The deck as React-friendly runs: **bold** → allergen emphasis. */
export function deckRuns(deckText: string): Array<{ text: string; bold: boolean }> {
  return deckText.split("**").map((text, i) => ({ text, bold: i % 2 === 1 })).filter(r => r.text);
}
