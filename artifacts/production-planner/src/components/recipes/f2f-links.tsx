/**
 * F2F (frozen) product links (Graeme, 25 Nov 2026): every core recipe gets
 * its "F2F - …" Shopify product linked, so F2F sales cost exactly what the
 * recipe costs and the fridge → freezer move knows where the stock goes.
 * Missing links are flagged. Server: routes/recipe-f2f.ts.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Link2, Loader2, Snowflake, Unlink, AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface F2fProduct { variantId: string; title: string; variantTitle: string | null }
interface F2fRow { recipeId: number; name: string; isCoreMenu: boolean; f2f: F2fProduct | null; suggestion: F2fProduct | null }
interface F2fResponse { recipes: F2fRow[]; products: F2fProduct[]; missing: number }

const KEY = ["recipe-f2f"];

async function fetchF2f(): Promise<F2fResponse> {
  const res = await fetch("/api/recipe-f2f", { credentials: "include" });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? "Couldn't load the F2F links");
  return res.json();
}

export function F2fLinksButton() {
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: KEY, queryFn: fetchF2f, staleTime: 60_000 });
  const missing = q.data?.missing ?? 0;
  return (
    <>
      <button onClick={() => setOpen(true)}
        className={cn("px-4 py-2.5 rounded-xl font-medium flex items-center gap-2 border-2",
          missing > 0 ? "border-amber-400 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200" : "border-border bg-card hover:bg-secondary")}>
        <Snowflake className="w-5 h-5" /> F2F links{missing > 0 ? ` · ${missing} missing` : ""}
      </button>
      <F2fLinksDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function F2fLinksDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KEY, queryFn: fetchF2f, enabled: open });
  const save = useMutation({
    mutationFn: async ({ recipeId, product }: { recipeId: number; product: F2fProduct | null }) => {
      const res = await fetch(`/api/recipe-f2f/${recipeId}`, {
        method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(product ? { variantId: product.variantId, productTitle: product.title, variantTitle: product.variantTitle } : { variantId: null }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error ?? "Couldn't save");
      return j;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
    onError: (e: Error) => toast({ title: "Couldn't save the link", description: e.message, variant: "destructive" }),
  });
  const data = q.data;
  const linked = new Set((data?.recipes ?? []).map(r => r.f2f?.variantId).filter(Boolean));
  const suggested = (data?.recipes ?? []).filter(r => !r.f2f && r.suggestion);

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="w-[calc(100vw-1rem)] sm:max-w-3xl max-h-[92dvh] overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-xl flex items-center gap-2"><Snowflake className="w-5 h-5 text-sky-600" /> F2F products for the core menu</DialogTitle>
          <DialogDescription>
            Link each core recipe to its F2F (frozen) Shopify product. A linked F2F product costs exactly what the recipe costs in Order Analysis and the P&amp;L, and it's where freezer stock will go.
          </DialogDescription>
        </DialogHeader>
        {!data ? <div className="py-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div> : (
          <div className="space-y-3">
            {data.missing > 0
              ? <p className="rounded-xl bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-sm font-semibold text-amber-900 dark:text-amber-200 flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> {data.missing} core recipe{data.missing === 1 ? "" : "s"} without an F2F product.</p>
              : <p className="rounded-xl bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 text-sm font-semibold text-emerald-800 dark:text-emerald-300 flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> Every core recipe has its F2F product.</p>}
            {suggested.length > 1 && (
              <button disabled={save.isPending} onClick={async () => { for (const r of suggested) await save.mutateAsync({ recipeId: r.recipeId, product: r.suggestion }); toast({ title: `Linked ${suggested.length} F2F products` }); }}
                className="h-11 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-semibold flex items-center gap-2 disabled:opacity-50">
                <Link2 className="w-4 h-4" /> Link all {suggested.length} suggested matches
              </button>
            )}
            <ul className="divide-y divide-border rounded-xl border border-border">
              {data.recipes.map(r => (
                <li key={r.recipeId} className="px-3 py-3 flex flex-wrap items-center gap-3">
                  <div className="flex-1 min-w-[12rem]">
                    <p className="font-semibold">{r.name}{!r.isCoreMenu && <span className="ml-2 text-xs font-normal text-muted-foreground">not on the core menu</span>}</p>
                    {r.f2f
                      ? <p className="text-sm text-emerald-700 dark:text-emerald-400 flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> {r.f2f.title}{r.f2f.variantTitle ? ` · ${r.f2f.variantTitle}` : ""}</p>
                      : r.suggestion
                        ? <p className="text-sm text-muted-foreground">Suggested: <span className="text-foreground">{r.suggestion.title}</span></p>
                        : <p className="text-sm text-amber-700 dark:text-amber-400">No F2F product found — pick one, or create it in Shopify first.</p>}
                  </div>
                  {r.f2f ? (
                    <button onClick={() => save.mutate({ recipeId: r.recipeId, product: null })} disabled={save.isPending}
                      className="h-10 px-3 rounded-lg border border-border text-sm flex items-center gap-1 hover:bg-secondary disabled:opacity-50"><Unlink className="w-4 h-4" /> Unlink</button>
                  ) : (
                    <span className="flex flex-wrap items-center gap-2">
                      {r.suggestion && (
                        <button onClick={() => save.mutate({ recipeId: r.recipeId, product: r.suggestion })} disabled={save.isPending}
                          className="h-10 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-semibold flex items-center gap-1 disabled:opacity-50"><Link2 className="w-4 h-4" /> Link</button>
                      )}
                      <select aria-label={`Pick the F2F product for ${r.name}`} value="" disabled={save.isPending}
                        onChange={e => { const p = data.products.find(x => x.variantId === e.target.value); if (p) save.mutate({ recipeId: r.recipeId, product: p }); }}
                        className="h-10 rounded-lg border border-border bg-background px-2 text-sm max-w-[16rem]">
                        <option value="">{r.suggestion ? "Or pick another…" : "Pick the F2F product…"}</option>
                        {data.products.filter(p => !linked.has(p.variantId)).map(p => <option key={p.variantId} value={p.variantId}>{p.title}{p.variantTitle ? ` · ${p.variantTitle}` : ""}</option>)}
                      </select>
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">The list of F2F products is everything titled "F2F …" sold in the last year. A brand-new F2F product shows here once it has sold.</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
