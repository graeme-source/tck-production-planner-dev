/**
 * "Create F2F product" (Graeme, 25 Nov 2026): the confirm card. Shows
 * exactly what will be made in Shopify from the recipe's main product —
 * title, variants and prices, tags (and the ones left off, with why),
 * product type, Active with stock 0 — and makes it only when the person
 * presses Create. It is then linked to the recipe. Server:
 * api-server routes/recipe-f2f.ts → lib/f2f-product.ts (rules in
 * lib/f2f-product-rules.ts).
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2, Snowflake } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";

interface Preview {
  recipeId: number;
  recipeName: string;
  main: { productId: string; title: string; status: string; tags: string[]; productType: string } | null;
  otherProducts: Array<{ productId: string; title: string }>;
  create: {
    title: string; status: "ACTIVE"; productType: string; tags: string[]; keptTags: string[];
    strippedTags: Array<{ tag: string; why: string }>; variants: Array<{ title: string; price: string }>;
    imageCount: number; linkVariantTitle: string | null;
  } | null;
  resuming: { shopifyProductId: string; lastError: string | null } | null;
  blockers: string[];
  writesBlocked: boolean;
  blockedMessage: string | null;
}
interface CreateResult { outcome: "created" | "finished"; productId: string; title: string; linked: { variantId: string; variantTitle: string } | null; linkError: string | null; steps: string[] }

const gbp = (p: string) => `£${Number(p).toFixed(2)}`;

export function F2fCreateCard({ recipeId, recipeName, onClose }: { recipeId: number; recipeName: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [mainProductId, setMainProductId] = useState<string | null>(null);
  const q = useQuery<Preview>({
    queryKey: ["recipe-f2f-create-preview", recipeId, mainProductId],
    queryFn: async () => {
      const res = await fetch(`/api/recipe-f2f/${recipeId}/create-preview${mainProductId ? `?mainProductId=${mainProductId}` : ""}`, { credentials: "include" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error ?? "Couldn't read Shopify");
      return j;
    },
    retry: false,
  });
  const create = useMutation<CreateResult, Error>({
    mutationFn: async () => {
      const res = await fetch(`/api/recipe-f2f/${recipeId}/create`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedTitle: q.data?.create?.title, mainProductId: q.data?.main?.productId ?? null }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error ?? "Couldn't make it");
      return j;
    },
    onSuccess: (r) => {
      toast({ title: `Made ${r.title}`, description: r.linked ? `Linked to ${recipeName}.` : r.linkError ?? "" });
      qc.invalidateQueries({ queryKey: ["recipe-f2f"] });
      qc.invalidateQueries({ queryKey: ["f2f-freezer-setting"] });
    },
    onError: (e) => { toast({ title: "Not made", description: e.message, variant: "destructive" }); q.refetch(); },
  });
  const p = q.data;
  const done = create.data;

  return (
    <Dialog open onOpenChange={o => { if (!o && !create.isPending) onClose(); }}>
      <DialogContent className="w-[calc(100vw-1rem)] sm:max-w-2xl max-h-[92dvh] overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-xl flex items-center gap-2"><Snowflake className="w-5 h-5 text-sky-600" /> Create the F2F product for {recipeName}</DialogTitle>
          <DialogDescription>A copy of the recipe's main Shopify product, for its freezer stock. Check it, then press Create.</DialogDescription>
        </DialogHeader>

        {q.isLoading && <div className="py-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>}
        {q.error && <p className="rounded-xl bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-800 dark:text-red-200">{(q.error as Error).message}</p>}

        {done ? (
          <div className="space-y-3">
            <p className="rounded-xl bg-emerald-50 dark:bg-emerald-950/30 px-4 py-3 font-semibold text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5" /> {done.outcome === "finished" ? "Finished" : "Made"} {done.title}
            </p>
            <ul className="list-disc pl-5 space-y-1 text-sm">{done.steps.map((s, i) => <li key={i}>{s}</li>)}</ul>
            <button type="button" onClick={onClose} className="h-12 w-full rounded-xl bg-primary text-primary-foreground font-semibold">Done</button>
          </div>
        ) : p && (
          <div className="space-y-4">
            {p.main && (
              <div className="rounded-xl border border-border p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Copied from</p>
                <p className="font-semibold">{p.main.title}</p>
                {p.otherProducts.length > 0 && (
                  <select aria-label="Copy a different product" value={p.main.productId} onChange={e => setMainProductId(e.target.value)}
                    className="mt-2 h-11 w-full rounded-lg border border-border bg-background px-2 text-sm">
                    <option value={p.main.productId}>{p.main.title}</option>
                    {p.otherProducts.map(o => <option key={o.productId} value={o.productId}>{o.title}</option>)}
                  </select>
                )}
              </div>
            )}

            {p.create && (
              <div className="rounded-xl border-2 border-sky-300 dark:border-sky-800 bg-sky-50/60 dark:bg-sky-950/20 p-4 space-y-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Will make</p>
                  <p className="font-display text-lg font-bold">{p.create.title}</p>
                  <p className="text-sm">Active · stock tracked, starting at 0 · {p.create.imageCount} image{p.create.imageCount === 1 ? "" : "s"} copied · product type {p.create.productType ? `"${p.create.productType}"` : "blank"}</p>
                </div>
                <div>
                  <p className="text-sm font-semibold mb-1">Variants (same prices as the main)</p>
                  <ul className="grid gap-1 sm:grid-cols-2">
                    {p.create.variants.map(v => (
                      <li key={v.title} className="rounded-lg bg-card border border-border px-3 py-2 flex justify-between text-sm">
                        <span>{v.title}{v.title === p.create!.linkVariantTitle ? " · linked to the recipe" : ""}</span><span className="font-semibold tabular-nums">{gbp(v.price)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-sm font-semibold mb-1">Tags</p>
                  <div className="flex flex-wrap gap-1.5">{p.create.tags.map(t => <span key={t} className="rounded-full bg-card border border-border px-3 py-1 text-sm">{t}</span>)}</div>
                </div>
                {p.create.strippedTags.length > 0 && (
                  <div>
                    <p className="text-sm font-semibold mb-1">Left off (from the main product)</p>
                    <ul className="space-y-1 text-sm">
                      {p.create.strippedTags.map(t => <li key={t.tag}><span className="line-through">{t.tag}</span> <span className="text-muted-foreground">— {t.why}</span></li>)}
                    </ul>
                  </div>
                )}
                <p className="text-sm text-muted-foreground">Not added to any manual collection. It shows on the site in WonkyZones only while it has stock.</p>
              </div>
            )}

            {p.resuming && <p className="rounded-xl bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">An earlier try made this product but didn't finish{p.resuming.lastError ? ` (${p.resuming.lastError})` : ""}. Create finishes that one — it won't make a second.</p>}
            {p.blockers.length > 0 && (
              <ul className="rounded-xl bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-800 dark:text-red-200 space-y-1">
                {p.blockers.map(b => <li key={b} className="flex gap-2"><AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {b}</li>)}
              </ul>
            )}
            {p.blockedMessage && <p className="rounded-xl bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">{p.blockedMessage}</p>}

            <div className="flex flex-col-reverse sm:flex-row gap-2">
              <button type="button" onClick={onClose} disabled={create.isPending} className="h-14 flex-1 rounded-xl border-2 border-border font-semibold hover:bg-secondary disabled:opacity-50">Cancel</button>
              <button type="button" onClick={() => create.mutate()} disabled={create.isPending || !p.create || p.blockers.length > 0}
                className="h-14 flex-1 rounded-xl bg-primary text-primary-foreground font-bold text-lg flex items-center justify-center gap-2 disabled:opacity-50">
                {create.isPending && <Loader2 className="w-5 h-5 animate-spin" />} Create in Shopify
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
