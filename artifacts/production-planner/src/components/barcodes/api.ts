/**
 * Barcodes — data from /api/barcodes (React Query). Our table is the source
 * of truth for scanning; nothing here writes to Shopify.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AlsoAccepts, BarcodeMap, Clash, CopyLink, KnownCodes, LinkKind, PullCounts, Reuse } from "@workspace/barcodes";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
export const BARCODES_API = `${BASE}/api/barcodes`;

export type ApiError = Error & { status?: number; body?: { error?: string; confirm?: "move" | "take"; holders?: string[] } };

export async function barcodesApi<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BARCODES_API}${path}`, {
    credentials: "include",
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init?.headers } : init?.headers,
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    const err = new Error(body.error ?? `Request failed (${res.status})`) as ApiError;
    err.status = res.status;
    err.body = body as ApiError["body"];
    throw err;
  }
  return body;
}

export interface VariantView {
  variantId: string;
  name: string;
  barcode: string | null;
  claimed: string | null;
  heldBack: string | null;
  invalid: string | null;
  current: boolean;
  source: string | null;
  setByName: string | null;
  setAt: string | null;
  shopifyBarcode: string | null;
  shopifyCheckedAt: string | null;
  notInShopify: boolean;
  differentInShopify: boolean;
  sameProductAs: string | null;
}

export interface GroupView {
  recipeId: number;
  recipeName: string;
  kind: LinkKind;
  label: string;
  productName: string;
  barcode: string | null;
  mixed: boolean;
  variants: VariantView[];
}

export interface BarcodeEvent {
  id: number;
  variantId: string;
  productName: string | null;
  action: string;
  oldBarcode: string | null;
  newBarcode: string | null;
  result: string;
  message: string | null;
  userName: string | null;
  createdAt: string;
}

export const recipeBarcodesKey = (id: number) => ["barcodes", "recipe", id] as const;

export function useRecipeBarcodes(recipeId: number | null) {
  return useQuery({
    queryKey: recipeBarcodesKey(recipeId ?? 0),
    queryFn: () => barcodesApi<{ groups: GroupView[]; events: BarcodeEvent[] }>(`/recipes/${recipeId}`),
    enabled: recipeId != null,
  });
}

export interface ClashView extends Clash { message: string }

export interface Overview {
  lastCheckedAt: string | null;
  firstPullAt: string | null;
  groups: GroupView[];
  clashes: ClashView[];
  reused: Reuse[];
  ambiguousBags: Array<{ variantId: string; name: string }>;
  clubSpecial: ClubSpecialView[];
  f2fSuggestions: CopyLink[];
}

export interface ClubSpecialView {
  variantId: string;
  name: string;
  current: boolean;
  scansAs: string | null;
  barcode: string | null;
  shopifyBarcode: string | null;
  changing: boolean;
  alsoAccepts: AlsoAccepts[];
  unexpected: boolean;
}

export function useBarcodeOverview() {
  return useQuery({ queryKey: ["barcodes", "overview"], queryFn: () => barcodesApi<Overview>("/overview") });
}

export interface PullItem {
  variantId: string;
  name: string;
  recipeId: number;
  recipeName: string;
  kind: LinkKind;
  outcome: string;
  ours: string | null;
  shopify: string | null;
  invalid: string | null;
}

export interface PullReport {
  mode: "pull" | "check";
  dryRun: boolean;
  at: string;
  linkedVariants: number;
  counts: PullCounts;
  followed: number;
  retiredCleared: number;
  items: PullItem[];
  clashes: ClashView[];
  reused: Reuse[];
  ambiguousBags: Array<{ variantId: string; name: string }>;
}

export interface ScanRejection {
  id: number;
  userName: string | null;
  orderName: string | null;
  code: string;
  kind: string;
  message: string | null;
  createdAt: string;
}

export function useScanRejections() {
  return useQuery({ queryKey: ["barcodes", "scan-rejections"], queryFn: () => barcodesApi<ScanRejection[]>("/scan-rejections?limit=50") });
}

export interface ScanMap { version: string | null; barcodes: BarcodeMap; identities: Record<string, string>; known: KnownCodes; alsoAccepts?: Record<string, AlsoAccepts[]> }

export const SCAN_MAP_KEY = ["barcodes", "scan-map"] as const;

/** The packing screen's live barcode map: refreshed every 10 seconds, and
 *  the page refetches it at once when a scan misses — so a barcode saved in
 *  the app scans straight away, with no manual sync. */
export function useScanMap(enabled = true) {
  return useQuery({
    queryKey: SCAN_MAP_KEY,
    queryFn: () => barcodesApi<ScanMap>("/scan-map"),
    refetchInterval: 10_000,
    staleTime: 5_000,
    enabled,
  });
}

export function useInvalidateBarcodes() {
  const qc = useQueryClient();
  return () => Promise.all([
    qc.invalidateQueries({ queryKey: ["barcodes"] }),
    // The pack label reads the same barcode.
    qc.invalidateQueries({ queryKey: ["product-labels"] }),
  ]);
}
