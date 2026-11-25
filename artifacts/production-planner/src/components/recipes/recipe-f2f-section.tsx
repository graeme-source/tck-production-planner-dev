/**
 * A recipe's F2F (frozen) product, in the recipe's own Shopify section,
 * beside the main Shopify link (Graeme, 25 Nov 2026: "We should be able to
 * do the same thing with the F2F: create F2F product and link F2F product").
 *
 * Shows the linked F2F product (Change / Unlink), or — with none — a
 * suggested match to link in one tap, "Create F2F product" (the same confirm
 * card as Recipes → F2F links), and "Link F2F product" with a search over
 * every Shopify product with F2F in its title. Same server as the F2F links
 * dialog: routes/recipe-f2f.ts. Picker rules: lib/f2f-pick.ts. Objective C.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Link2, Loader2, Plus, Search, Snowflake, Unlink, X } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { F2fCreateCard } from "./f2f-create-card";
import { f2fChoices, f2fLabel, filterF2fChoices, type F2fChoice, type ShopifyProductLite } from "@/lib/f2f-pick";

interface OneF2f {
  recipeId: number;
  name: string;
  isCoreMenu: boolean;
  f2f: F2fChoice | null;
  suggestion: F2fChoice | null;
  takenVariantIds: string[];
}
interface F2fList { products: F2fChoice[] }

async function getJson<T>(url: string, what: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((j as { error?: string })?.error ?? `Couldn't load ${what}`);
  return j as T;
}

export function RecipeF2fSection({ recipeId, recipeName, canEdit }: { recipeId: number; recipeName: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const key = ["recipe-f2f", "one", recipeId];
  const one = useQuery({ queryKey: key, queryFn: () => getJson<OneF2f>(`/api/recipe-f2f/${recipeId}`, "the F2F link"), enabled: canEdit });
  const [picking, setPicking] = useState(false);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");

  // Only loaded once the picker opens — the full Shopify list is slow.
  const shopify = useQuery({
    queryKey: ["shopify-products-for-f2f"],
    queryFn: () => getJson<ShopifyProductLite[]>("/api/shopify/products", "Shopify products"),
    enabled: picking, staleTime: 5 * 60_000,
  });
  const seen = useQuery({
    queryKey: ["recipe-f2f"],
    queryFn: () => getJson<F2fList>("/api/recipe-f2f", "the F2F products"),
    enabled: picking, staleTime: 60_000,
  });
  const choices = useMemo(
    () => f2fChoices(shopify.data ?? [], seen.data?.products ?? [], new Set(one.data?.takenVariantIds ?? [])),
    [shopify.data, seen.data, one.data],
  );
  const shown = filterF2fChoices(choices, search).slice(0, 40);

  const save = useMutation({
    mutationFn: async (product: F2fChoice | null) => {
      const res = await fetch(`/api/recipe-f2f/${recipeId}`, {
        method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(product ? { variantId: product.variantId, productTitle: product.title, variantTitle: product.variantTitle } : { variantId: null }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((j as { error?: string })?.error ?? "Couldn't save");
      return product;
    },
    onSuccess: (product) => {
      toast({ title: product ? `F2F linked: ${f2fLabel(product)}` : "F2F product unlinked" });
      setPicking(false); setSearch("");
      void qc.invalidateQueries({ queryKey: ["recipe-f2f"] });
      void qc.invalidateQueries({ queryKey: ["f2f-freezer-setting"] });
    },
    onError: (e: Error) => toast({ title: "Couldn't save the F2F link", description: e.message, variant: "destructive" }),
  });

  if (!canEdit) return null;
  const d = one.data;

  return (
    <div className="mt-4 border-t border-border pt-4">
      <div className="flex items-center gap-2 mb-1">
        <Snowflake className="w-4 h-4 text-sky-600" />
        <h4 className="text-sm font-semibold">F2F (frozen) product</h4>
        {(one.isLoading || save.isPending) && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
      </div>
      <p className="text-xs text-muted-foreground mb-2">Costs exactly what this recipe costs, and it's where freezer packs go in Shopify.</p>

      {one.error && <p className="text-xs text-destructive">{(one.error as Error).message}</p>}

      {d?.f2f && !picking && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-950/20 px-3 py-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span className="text-sm font-medium flex-1 min-w-[10rem] break-words">{f2fLabel(d.f2f)}</span>
          <button type="button" onClick={() => setPicking(true)} disabled={save.isPending}
            className="h-10 px-3 rounded-lg border border-border text-sm flex items-center gap-1 hover:bg-secondary disabled:opacity-50">
            <Link2 className="w-4 h-4" /> Change
          </button>
          <button type="button" onClick={() => save.mutate(null)} disabled={save.isPending}
            className="h-10 px-3 rounded-lg border border-border text-sm flex items-center gap-1 hover:bg-secondary disabled:opacity-50">
            <Unlink className="w-4 h-4" /> Unlink
          </button>
        </div>
      )}

      {d && !d.f2f && !picking && (
        <div className="space-y-2">
          {d.isCoreMenu && <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">On the core menu with no F2F product linked.</p>}
          <div className="flex flex-wrap gap-2">
            {d.suggestion && (
              <button type="button" onClick={() => save.mutate(d.suggestion)} disabled={save.isPending}
                className="h-11 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50">
                <Link2 className="w-4 h-4" /> Link {f2fLabel(d.suggestion)}
              </button>
            )}
            <button type="button" onClick={() => setCreating(true)} disabled={save.isPending}
              className="h-11 px-3 rounded-lg border-2 border-sky-400 text-sky-800 dark:text-sky-200 text-sm font-semibold flex items-center gap-1.5 hover:bg-sky-50 dark:hover:bg-sky-950/30 disabled:opacity-50">
              <Plus className="w-4 h-4" /> Create F2F product
            </button>
            <button type="button" onClick={() => setPicking(true)} disabled={save.isPending}
              className="h-11 px-3 rounded-lg border border-border text-sm font-semibold flex items-center gap-1.5 hover:bg-secondary disabled:opacity-50">
              <Search className="w-4 h-4" /> Link F2F product
            </button>
          </div>
        </div>
      )}

      {picking && (
        <div className="rounded-xl border border-border p-2 space-y-2">
          <div className="flex items-center gap-2">
            <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Search F2F products…"
              className="flex-1 h-10 rounded-lg border border-border bg-background px-3 text-sm" />
            <button type="button" aria-label="Close the F2F picker" onClick={() => { setPicking(false); setSearch(""); }}
              className="h-10 w-10 rounded-lg border border-border flex items-center justify-center hover:bg-secondary">
              <X className="w-4 h-4" />
            </button>
          </div>
          {(shopify.isLoading || seen.isLoading)
            ? <p className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Loading Shopify products…</p>
            : shown.length === 0
              ? <p className="text-xs text-muted-foreground">No F2F product matches{search ? ` "${search}"` : ""}. Use Create F2F product to make one.</p>
              : (
                <ul className="max-h-64 overflow-y-auto divide-y divide-border">
                  {shown.map(c => (
                    <li key={c.variantId}>
                      <button type="button" onClick={() => save.mutate(c)} disabled={save.isPending}
                        className="w-full text-left min-h-[44px] px-2 py-2 text-sm hover:bg-secondary rounded-md disabled:opacity-50">
                        {f2fLabel(c)}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
          {shopify.error && <p className="text-xs text-amber-700 dark:text-amber-400">Couldn't reach Shopify just now, so this only lists F2F products that have sold. Close and try again for the full list.</p>}
        </div>
      )}

      {creating && <F2fCreateCard recipeId={recipeId} recipeName={d?.name ?? recipeName} onClose={() => setCreating(false)} />}
    </div>
  );
}
