/**
 * Product labels — data from /api/product-labels (React Query). The label is
 * laid out and drawn on the SERVER with the bundled fonts; these pages show
 * the server's PNG, so the proof is the exact bitmap the printer will get.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  FieldKey, FitProblem, LabelDates, LabelSnapshot, LabelStatus, LabelTemplate, Rect, RecipeLabelSettings,
  SnapshotChange, WidthVariant, CookingValues, ShelfPeriod,
} from "@workspace/product-labels";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
export const API = `${BASE}/api/product-labels`;

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    credentials: "include",
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init?.headers } : init?.headers,
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string; blockers?: string[] };
  if (!res.ok) {
    const err = new Error(body.error ?? `Request failed (${res.status})`) as Error & { status?: number; body?: unknown };
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

export interface ProofField {
  key: FieldKey;
  boxes: Rect[];
  sizePt: number;
  width: WidthVariant;
  minPt: number;
  legalMinPt: number;
  xHeightMm: number;
  lines: number;
  usedHeight: number;
  fits: boolean;
}

export interface Proof {
  png: string;
  overflowPng: string | null;
  widthDots: number;
  heightDots: number;
  dpi: number;
  fits: boolean;
  fitProblems: FitProblem[];
  contentProblems: string[];
  fields: ProofField[];
  columns: { left: Rect; right: Rect; leftText: Rect };
  barcode: { box: Rect; module: { ok: boolean; moduleDots?: number; moduleMm?: number; magnificationPct?: number; widthDots?: number; reason?: string } };
  dates: LabelDates;
}

export interface TemplatePayload {
  id: number;
  name: string;
  version: number;
  updatedAt: string;
  updatedByName: string | null;
  template: LabelTemplate;
  legalMinimums: Record<FieldKey, Record<WidthVariant, number>>;
  xHeights: Record<WidthVariant, number>;
  raised?: FieldKey[];
}

export interface LabelListRow {
  recipeId: number;
  name: string;
  category: string | null;
  status: LabelStatus;
  statusLabel: string;
  liveVersion: { versionNo: number; publishedAt: string; publishedByName: string | null } | null;
  changes: string[];
  blockers: string[];
  barcode: string | null;
}

export interface RecipeLabel {
  recipe: {
    id: number; name: string; packSize: string; shelfLifeDays: number | null; isDraft: boolean; archived: boolean;
    factoryOvenTempC: number | null; factoryOvenTimeSeconds: number | null;
  };
  settings: RecipeLabelSettings;
  settingsUpdatedAt: string | null;
  settingsUpdatedByName: string | null;
  template: { id: number; name: string; version: number; cooking: CookingValues; frozenDefault: ShelfPeriod | null };
  status: LabelStatus;
  statusLabel: string;
  matchesLive: boolean;
  changes: SnapshotChange[];
  blockers: string[];
  warnings: string[];
  sample: { printDate: string; productionDate: string };
  current: { hash: string; snapshot: LabelSnapshot; proof: Proof };
  live: null | {
    versionNo: number; publishedAt: string; publishedByName: string | null; hash: string;
    snapshot: LabelSnapshot; proof: Proof | null;
  };
}

export const labelKeys = {
  template: ["product-labels", "template"] as const,
  list: ["product-labels", "list"] as const,
  recipe: (id: number) => ["product-labels", "recipe", id] as const,
};

export function useLabelTemplate() {
  return useQuery({ queryKey: labelKeys.template, queryFn: () => api<TemplatePayload>("/template") });
}

export function useLabelList() {
  return useQuery({ queryKey: labelKeys.list, queryFn: () => api<{ recipes: LabelListRow[] }>("/recipes"), staleTime: 0 });
}

export function useRecipeLabel(id: number | null) {
  return useQuery({
    queryKey: labelKeys.recipe(id ?? 0),
    queryFn: () => api<RecipeLabel>(`/recipes/${id}`),
    enabled: id != null && id > 0,
    // Status must reflect the recipe as it is NOW — never a cached verdict.
    staleTime: 0,
  });
}

/** After a change that can move a label's status. */
export function useInvalidateLabels() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["product-labels"] });
}

export const STATUS_TONE: Record<LabelStatus, string> = {
  live: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800",
  "update-needed": "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800",
  "doesnt-fit": "bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800",
  "never-published": "bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800",
  "draft-recipe": "bg-secondary text-muted-foreground border-border",
  archived: "bg-secondary text-muted-foreground border-border",
};

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function fmtDay(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}
