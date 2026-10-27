/**
 * Product labels — data from /api/product-labels (React Query). The label is
 * laid out and drawn on the SERVER with the bundled fonts; these pages show
 * the server's PNG, so the proof is the exact bitmap the printer will get.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { DeclarationIssue } from "@workspace/allergens";
import type {
  FieldKey, FitProblem, LabelDates, LabelSnapshot, LabelStatus, LabelTemplate, Rect, RecipeLabelSettings,
  SnapshotChange, WidthVariant, CookingValues, ShelfPeriod, BonesWarning, CookingMode, CookingProfile, HalvedRange,
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

/** The times a suggestion prints, and the halves either side of TURN OVER. */
export interface SuggestedTimes {
  tierKey: string;
  tierName: string;
  reason: string;
  cooking: CookingValues;
  halves: { oven: HalvedRange | null; airFryer: HalvedRange | null };
}

/** Suggested (by weight) vs Manual for one recipe (cooking-tiers.ts). */
export interface CookingTimesInfo {
  /** The mode in force; modeChosen null = not chosen (worked out). */
  mode: CookingMode;
  modeChosen: CookingMode | null;
  /** The template's "suggest by weight" switch. Off = standard times print. */
  tiersOn: boolean;
  maxOvenMinutes: number | null;
  maxAirFryerMinutes: number | null;
  profile: CookingProfile;
  /** Null = not a calzone (no dough or no filling). */
  suggestion: SuggestedTimes | null;
}

export interface TierPreviewRow extends SuggestedTimes {
  recipeId: number;
  name: string;
  category: string | null;
  isDraft: boolean;
  profile: CookingProfile;
}

export interface RecipeLabel {
  recipe: {
    id: number; name: string; packSize: string; shelfLifeDays: number | null; isDraft: boolean; archived: boolean;
    factoryOvenTempC: number | null; factoryOvenTimeSeconds: number | null;
  };
  settings: RecipeLabelSettings;
  cookingTimes: CookingTimesInfo;
  /** The bones warning as it prints, and what Automatic finds. */
  bonesWarning: BonesWarning;
  /** The template's trigger words (for "no chicken found"). */
  boneRiskWords: string[];
  settingsUpdatedAt: string | null;
  settingsUpdatedByName: string | null;
  /** The template this recipe picked; null = the standard one. */
  templateChoice: number | null;
  template: { id: number; name: string; version: number; cooking: CookingValues; chilledDefault: ShelfPeriod | null; frozenDefault: ShelfPeriod | null; netQuantityOn: boolean };
  status: LabelStatus;
  statusLabel: string;
  matchesLive: boolean;
  changes: SnapshotChange[];
  blockers: string[];
  /** The declaration lines of `blockers`, and the ingredient behind each. */
  deckBlockers?: string[];
  deckIssues?: DeclarationIssue[];
  warnings: string[];
  sample: { printDate: string; productionDate: string };
  current: { hash: string; snapshot: LabelSnapshot; proof: Proof };
  live: null | {
    versionNo: number; publishedAt: string; publishedByName: string | null; hash: string;
    snapshot: LabelSnapshot; proof: Proof | null;
  };
}

export interface TemplateList {
  templates: Array<{ id: number; name: string; version: number; updatedAt: string; isDefault: boolean }>;
  /** Starting designs that can be added as a new template. */
  presets: Array<{ key: string; name: string; description: string; added: boolean }>;
}

export const labelKeys = {
  template: ["product-labels", "template"] as const,
  templateById: (id: number | null) => ["product-labels", "template", id ?? "default"] as const,
  templates: ["product-labels", "templates"] as const,
  list: ["product-labels", "list"] as const,
  recipe: (id: number) => ["product-labels", "recipe", id] as const,
};

/** One template: `id` null = the standard one. */
export function useLabelTemplate(id: number | null = null) {
  return useQuery({ queryKey: labelKeys.templateById(id), queryFn: () => api<TemplatePayload>(id ? `/template?id=${id}` : "/template") });
}

export function useLabelTemplates() {
  return useQuery({ queryKey: labelKeys.templates, queryFn: () => api<TemplateList>("/templates") });
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

/** Recipes with a published (live) label — only these get "Print back
 *  labels" at the wrapping station; the rest say "Use Label Live" (Graeme,
 *  19 Oct 2026). null until it loads, so nothing flashes up on a guess.
 *  Under ["product-labels", …] so publishing a label refreshes it too. */
export function useLiveLabelRecipeIds(enabled = true): Set<number> | null {
  const q = useQuery({
    queryKey: ["product-labels", "live-recipe-ids"],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/product-label-print/live-recipes`, { credentials: "include" });
      if (!res.ok) throw new Error(`Couldn't load published labels (HTTP ${res.status})`);
      return (await res.json()) as { recipeIds: number[] };
    },
  });
  return q.data ? liveRecipeIdSet(q.data.recipeIds) : null;
}

/** Recipes whose front label is the printed 102 × 25 mm name label (test
 *  products — Graeme, 27 Oct 2026). Wrapping makes "Print front labels"
 *  their main button. */
export function useFrontLabelDefaultIds(enabled = true): Set<number> {
  const q = useQuery({
    queryKey: ["product-labels", "front-default-ids"],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/product-front-label/default-recipes`, { credentials: "include" });
      if (!res.ok) throw new Error(`Couldn't load front label choices (HTTP ${res.status})`);
      return (await res.json()) as { recipeIds: number[] };
    },
  });
  return liveRecipeIdSet(q.data?.recipeIds);
}

/** Pure: the published-label set. */
export function liveRecipeIdSet(ids: number[] | undefined | null): Set<number> {
  return new Set((ids ?? []).filter(n => Number.isInteger(n) && n > 0));
}

/** What the wrapping station shows for a recipe's labels: the print button
 *  (published label), the "Use Label Live" instruction (no label built yet —
 *  the old Label Live software), or nothing while the list is loading. */
export function wrappingLabelAction(liveIds: Set<number> | null, recipeId: number): "print" | "label-live" | null {
  if (!liveIds) return null;
  return liveIds.has(recipeId) ? "print" : "label-live";
}
