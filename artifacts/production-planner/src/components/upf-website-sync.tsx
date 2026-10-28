/**
 * "On the website" — what each Shopify product's menu card shows (UPF %,
 * calories and protein per portion), pushed automatically from these
 * recipes every 10 minutes (api-server lib/upf-shopify-sync.ts). Shown on the Recipes page so a change to a
 * recipe can be followed through to the website. Objective B.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Globe, Loader2, RefreshCw } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const KEY = ["upf", "shopify-sync"];

interface Figure {
  value: number | null;
  published: number | null;
  heldBecause: string | null;
  /** Held back on purpose: the recipe has no pack size (per 100 g only). */
  byDesign?: boolean;
  /** Nutrition table: sent per 100 g only (no pack size). */
  per100gOnly?: boolean;
}

interface SyncProduct {
  productId: string;
  productTitle: string | null;
  recipeNames: string | null;
  status: "linked" | "several_recipes";
  upf: Figure;
  kcal: Figure;
  protein: Figure;
  /** value 1 = the table is ready to publish; null = held back. */
  nutrition: Figure;
  lastError: string | null;
  checkedAt: string;
  writtenAt: string | null;
}

interface SyncStatus {
  writesBlocked: boolean;
  lastRun: { ranAt: string; written: number; errors: string[]; blocked: boolean } | null;
  products: SyncProduct[];
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api/upf${path}`, {
    credentials: "include",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/** Same wording the website uses, so what you read here is what customers see. */
function upfLabel(p: number): string {
  if (p <= 0) return "UPF free";
  if (p < 1) return "<1% UPF";
  if (p < 10) return `${p.toFixed(1)}% UPF`;
  return `${Math.round(p)}% UPF`;
}

function FigureCell({ figure, label }: { figure: Figure; label: (v: number) => string }) {
  if (figure.value == null && figure.byDesign) {
    return <span className="text-xs text-muted-foreground">Not shown — no pack size set, so no per-portion figure (the table shows per 100 g)</span>;
  }
  if (figure.value == null) {
    return <span className="text-xs text-muted-foreground">Not shown — {figure.heldBecause}</span>;
  }
  return <span className="font-medium">{label(figure.value)}</span>;
}

function ago(iso: string | null | undefined): string {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours} h ago` : new Date(iso).toLocaleDateString("en-GB");
}

/** `embedded`: inside the Recipe tools pop-up — the product list shows straight away. */
export function UpfWebsiteSync({ embedded }: { embedded?: boolean } = {}) {
  const [open, setOpen] = useState(embedded === true);
  const qc = useQueryClient();
  const { state } = useAuth();
  const canRun = state.status === "authenticated" && (state.user.role === "admin" || state.user.role === "manager");

  const q = useQuery<SyncStatus>({ queryKey: KEY, queryFn: () => api("/shopify-sync"), staleTime: 60_000 });
  const run = useMutation({
    mutationFn: () => api<{ written: number }>("/shopify-sync/run", { method: "POST", body: "{}" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });

  // On the page it stays out of the way; in the pop-up it says what's happening.
  if (q.isLoading) return embedded ? <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</p> : null;
  if (q.error || !q.data) return embedded ? <p className="text-sm text-red-700">Couldn't load the website figures{q.error ? ` — ${(q.error as Error).message}` : ""}.</p> : null;
  const { products, writesBlocked } = q.data;
  // A per-portion figure held back on purpose (no pack size) isn't missing.
  const shown = (f: Figure) => f.value != null || f.byDesign === true;
  const complete = products.filter(p => p.upf.value != null && shown(p.kcal) && shown(p.protein) && p.nutrition.value != null);
  const incomplete = products.length - complete.length;
  const failing = products.filter(p => p.lastError);
  const lastCheck = products.reduce<string | null>((a, p) => (!a || p.checkedAt > a ? p.checkedAt : a), null);

  return (
    <div className={embedded ? "" : "rounded-2xl border border-border bg-card"}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <button type="button" onClick={() => setOpen(o => !o)} className="flex items-center gap-2 font-semibold text-sm min-h-11" aria-expanded={open}>
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          <Globe className="w-4 h-4 text-primary" /> UPF, calories, protein &amp; nutrition on the website
        </button>
        <span className="text-sm text-muted-foreground">
          {complete.length} complete · {incomplete} with a figure held back · updates every 10 min · last check {ago(lastCheck)}
        </span>
        {writesBlocked && <span className="text-xs text-amber-700">Shopify writes are off on this server — nothing is sent.</span>}
        {failing.length > 0 && <span className="text-xs text-red-700">{failing.length} product{failing.length === 1 ? "" : "s"} failed to update</span>}
        {canRun && (
          <button
            type="button"
            onClick={() => run.mutate()}
            disabled={run.isPending}
            className="ml-auto inline-flex items-center gap-2 px-3 min-h-11 rounded-xl border border-border text-sm hover:bg-muted disabled:opacity-60"
          >
            {run.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Update website now
          </button>
        )}
      </div>
      {run.error && <p className="px-4 pb-2 text-sm text-red-700">{(run.error as Error).message}</p>}
      {run.isSuccess && <p className="px-4 pb-2 text-sm text-muted-foreground">Done — {run.data.written} product{run.data.written === 1 ? "" : "s"} updated.</p>}

      {open && (
        <div className="border-t border-border overflow-x-auto">
          {products.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">No recipes are linked to Shopify products yet — link them in each recipe's Shopify mapping.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="text-left">
                  <th className="px-4 py-2 font-medium">Shopify product</th>
                  <th className="px-4 py-2 font-medium">Recipe</th>
                  <th className="px-4 py-2 font-medium">UPF</th>
                  <th className="px-4 py-2 font-medium">Calories / portion</th>
                  <th className="px-4 py-2 font-medium">Protein / portion</th>
                  <th className="px-4 py-2 font-medium">Nutrition table</th>
                  <th className="px-4 py-2 font-medium">Last sent</th>
                </tr>
              </thead>
              <tbody>
                {products.map(p => (
                  <tr key={p.productId} className="border-t border-border/60 align-top">
                    <td className="px-4 py-2">{p.productTitle}</td>
                    <td className="px-4 py-2 text-muted-foreground">{p.recipeNames}</td>
                    <td className="px-4 py-2">
                      {p.upf.value != null ? (
                        <span className={cn("inline-flex px-2 py-0.5 rounded-full text-xs font-bold uppercase", p.upf.value <= 0 ? "bg-green-100 text-green-700" : "bg-stone-100 text-stone-700")}>
                          {upfLabel(p.upf.value)}
                        </span>
                      ) : (
                        <FigureCell figure={p.upf} label={upfLabel} />
                      )}
                    </td>
                    <td className="px-4 py-2"><FigureCell figure={p.kcal} label={v => `${Math.round(v)} kcal`} /></td>
                    <td className="px-4 py-2">
                      <FigureCell figure={p.protein} label={v => `${Math.round(v)} g`} />
                      {p.lastError && <p className="text-xs text-red-700 mt-1">Shopify: {p.lastError}</p>}
                    </td>
                    <td className="px-4 py-2"><FigureCell figure={p.nutrition} label={() => (p.nutrition.per100gOnly ? "Per 100 g only" : "Per 100 g & per portion")} /></td>
                    <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">{ago(p.writtenAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
