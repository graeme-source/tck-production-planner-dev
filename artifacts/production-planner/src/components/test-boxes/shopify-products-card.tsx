/**
 * "Shopify products" on a test box (Graeme, 2026-10-02). Objectives A and I.
 *
 * Step 1 — Preview: the server works out, WITHOUT writing anything, what each
 * recipe's draft product would be (template, title, tags, details, barcode,
 * images) and what's missing. Step 2 — create one recipe's
 * product, or all of them, after a plain-English confirm. A recipe already
 * linked to a Shopify product is shown as "Already in Shopify" and never
 * duplicated; one that isn't can be linked to an existing product instead.
 *
 * API: routes/test-box-shopify.ts. Shapes mirror lib/test-box-shopify-run.ts.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, Check, ChevronDown, ChevronRight, ExternalLink, Link2, Loader2, Search, ShieldAlert, ShoppingBag, X,
} from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Types (mirror api-server/src/lib/test-box-shopify-run.ts) ──────────────
interface ProductLink { productId: string; title: string; status: string; adminUrl: string; variantTitle?: string }
interface MetafieldLine { label: string; field: string; action: "set" | "keep" | "remove" | "none"; summary: string }
interface RecipePreview {
  recipeId: number;
  recipeName: string;
  isDraft: boolean;
  action: "create" | "update" | "linked";
  linkedProducts: ProductLink[];
  createdProduct: ProductLink | null;
  possibleMatch: ProductLink | null;
  template: (ProductLink & { price: string | null; imageCount: number; reason: string }) | null;
  title: string;
  tags: string[];
  tagsRemoved: string[];
  statusAfter: string;
  barcode: string;
  imagesCopied: boolean;
  metafields: MetafieldLine[];
  nutrition: { complete: boolean; portionWeightG: number | null; rows: Array<{ label: string; per100g: string; perPortion: string }> };
  warnings: string[];
  blocking: string[];
}
interface Preview {
  box: { id: number; name: string };
  writesBlocked: boolean;
  blockedMessage: string | null;
  missingScopes: string[];
  includeImages: boolean;
  templates: Array<{ productId: string; title: string; status: string; tags: string[]; adminUrl: string }>;
  recipes: RecipePreview[];
  canCreate: boolean;
}
interface RecipeResult { recipeId: number; recipeName: string; outcome: "created" | "updated" | "skipped" | "failed"; message: string; product: ProductLink | null; steps: string[]; linkedVariants: string[] }
export interface Ticks { products: boolean; collection: boolean; discount: boolean }
interface RunResult {
  results: RecipeResult[];
  ticked: Ticks;
  stoppedByGuard: string | null;
}
interface SearchHit { productId: string; title: string; status: string; tags: string[]; imageUrl: string | null; variants: Array<{ id: string; title: string; sku: string | null }> }

export async function call<T>(boxId: number, path: string, init?: RequestInit, acceptBlocked = false): Promise<T> {
  const res = await fetch(`${BASE}/api/test-boxes/${boxId}/shopify${path}`, {
    credentials: "include",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  const body = await res.json().catch(() => ({})) as { error?: string; code?: string; details?: { formErrors?: string[]; fieldErrors?: Record<string, string[]> } };
  // A run the write guard stopped still comes back with its per-recipe results.
  if (acceptBlocked && res.status === 503 && body.code === "SHOPIFY_WRITES_BLOCKED") return body as T;
  if (!res.ok) {
    const field = body.details?.fieldErrors ? Object.values(body.details.fieldErrors)[0]?.[0] : undefined;
    throw new Error(body.details?.formErrors?.[0] ?? field ?? body.error ?? `HTTP ${res.status}`);
  }
  return body as T;
}

const STATUS_LABEL: Record<string, string> = { DRAFT: "Draft", ACTIVE: "Active", ARCHIVED: "Archived", UNLISTED: "Unlisted" };

export function Shell({ title, onClose, children, footer, narrow }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; narrow?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-[140] bg-black/60 flex items-center justify-center p-3 sm:p-6" onClick={onClose}>
      <div
        className={cn("bg-card border-2 border-border rounded-2xl shadow-2xl w-full max-h-[92dvh] flex flex-col overflow-hidden", narrow ? "max-w-md" : "max-w-3xl")}
        onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <ShoppingBag className="w-6 h-6 text-emerald-600" />
          <h2 className="flex-1 font-display font-bold text-lg">{title}</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-secondary" aria-label="Close"><X className="w-6 h-6" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">{children}</div>
        {footer && <div className="border-t border-border px-5 py-3.5 flex items-center gap-3 flex-wrap">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function ShopifyProductsModal({ boxId, onClose }: { boxId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const [templates, setTemplates] = useState<Record<string, string>>({});
  const [includeImages, setIncludeImages] = useState(true);
  const [confirm, setConfirm] = useState<number[] | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);

  const previewKey = ["test-boxes", boxId, "shopify-preview", templates, includeImages];
  const preview = useQuery({
    queryKey: previewKey,
    queryFn: () => call<Preview>(boxId, "/preview", { method: "POST", body: JSON.stringify({ templates, includeImages }) }),
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  const create = useMutation({
    mutationFn: (recipeIds: number[]) =>
      call<RunResult>(boxId, "/create", { method: "POST", body: JSON.stringify({ recipeIds, templates, includeImages }) }, true),
    onSuccess: r => {
      setResult(r);
      setConfirm(null);
      void qc.invalidateQueries({ queryKey: ["test-boxes", boxId] });
      void qc.invalidateQueries({ queryKey: ["todos"] });
    },
  });

  const p = preview.data;
  const makeable = (r: RecipePreview) => r.action !== "linked" && r.blocking.length === 0;
  const all = p?.recipes.filter(makeable) ?? [];
  const blockedBy = !p ? null
    : !p.canCreate ? "Only a manager or admin can create products."
    : p.missingScopes.length && !p.writesBlocked ? "Shopify hasn't given the app permission to create products yet."
    : null;

  return (
    <Shell
      title="Shopify products for this box"
      onClose={onClose}
      footer={p && !result ? (
        <>
          <p className="flex-1 text-sm text-muted-foreground min-w-[200px]">
            {all.length === 0 ? "Nothing to make — every recipe is already in Shopify or needs fixing first." : `${all.length} ready · drafts only, nothing is published`}
          </p>
          <button onClick={onClose} className="px-4 py-3 rounded-xl border-2 border-border text-base font-semibold hover:bg-secondary">Close</button>
          <button
            onClick={() => setConfirm(all.map(r => r.recipeId))}
            disabled={all.length === 0 || !!blockedBy || create.isPending}
            title={blockedBy ?? undefined}
            className="px-5 py-3 rounded-xl bg-emerald-600 text-white text-base font-semibold hover:bg-emerald-700 disabled:opacity-50"
          >
            {all.some(r => r.action === "create") ? `Create all ${all.length} in Shopify (draft)` : `Update all ${all.length} in Shopify`}
          </button>
        </>
      ) : undefined}
    >
      {preview.isLoading && <p className="flex items-center gap-2 text-base"><Loader2 className="w-5 h-5 animate-spin" /> Reading Shopify and the recipes — nothing is changed…</p>}
      {preview.error && <p className="text-destructive flex items-center gap-2"><AlertTriangle className="w-5 h-5" /> {(preview.error as Error).message}</p>}

      {result && <Results result={result} onBack={() => { setResult(null); void preview.refetch(); }} />}

      {p && !result && (
        <>
          {p.writesBlocked && (
            <Banner tone="amber" icon={<ShieldAlert className="w-5 h-5" />}>
              <b>Shopify writes are switched off on this server.</b> You can preview everything, but pressing Create will stop before anything is made.
            </Banner>
          )}
          {p.missingScopes.length > 0 && (
            <Banner tone="red" icon={<ShieldAlert className="w-5 h-5" />}>
              <b>Shopify hasn't given the app permission to create products yet.</b> In the Shopify app's settings (Dev Dashboard → the planner app → Access scopes) add <code>{p.missingScopes.join(", ")}</code>, release the new version and approve it in the store. Until then this can only preview.
            </Banner>
          )}

          <label className="flex items-center gap-3 rounded-2xl border-2 border-border p-3.5 cursor-pointer">
            <input type="checkbox" checked={includeImages} onChange={e => setIncludeImages(e.target.checked)} className="w-6 h-6 accent-emerald-600" />
            <span className="flex-1">
              <span className="text-base font-semibold block">Copy the template's product images</span>
              <span className="text-sm text-muted-foreground">On for this box — swap in the recipe's own photos later (it's on the launch checklist).</span>
            </span>
          </label>

          {p.recipes.map(r => (
            <RecipeCard
              key={r.recipeId}
              boxId={boxId}
              r={r}
              templates={p.templates}
              blockedBy={blockedBy}
              busy={create.isPending}
              onTemplate={productId => setTemplates(t => ({ ...t, [String(r.recipeId)]: productId }))}
              onCreate={() => setConfirm([r.recipeId])}
              onLinked={() => { void preview.refetch(); void qc.invalidateQueries({ queryKey: ["test-boxes", boxId] }); }}
            />
          ))}
        </>
      )}

      {confirm && p && (
        <ConfirmCreate
          recipes={p.recipes.filter(r => confirm.includes(r.recipeId))}
          includeImages={includeImages}
          pending={create.isPending}
          error={create.error as Error | null}
          onCancel={() => { setConfirm(null); create.reset(); }}
          onConfirm={() => create.mutate(confirm)}
        />
      )}
    </Shell>
  );
}

function RecipeCard({ boxId, r, templates, blockedBy, busy, onTemplate, onCreate, onLinked }: {
  boxId: number; r: RecipePreview; templates: Preview["templates"]; blockedBy: string | null; busy: boolean;
  onTemplate: (productId: string) => void; onCreate: () => void; onLinked: () => void;
}) {
  const [showNutrition, setShowNutrition] = useState(false);
  const [linking, setLinking] = useState(false);
  const chip = r.action === "linked" ? <Chip tone="slate">Already in Shopify</Chip>
    : r.action === "update" ? <Chip tone="sky">Made by the app — will be updated</Chip>
    : <Chip tone="emerald">Will be made as a draft</Chip>;
  const options = r.template && !templates.some(t => t.productId === r.template!.productId)
    ? [{ productId: r.template.productId, title: r.template.title, status: r.template.status }, ...templates]
    : templates;

  return (
    <section className="rounded-2xl border-2 border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <h3 className="text-lg font-bold flex-1 min-w-[180px]">{r.recipeName}</h3>
        {r.isDraft && <Chip tone="amber">Draft recipe</Chip>}
        {chip}
      </div>

      {r.action === "linked" ? (
        <div className="space-y-2">
          {r.linkedProducts.map(lp => (
            <p key={lp.productId} className="text-base flex items-center gap-2 flex-wrap">
              <Check className="w-5 h-5 text-emerald-600" /> Already in Shopify — <b>{lp.title}</b>
              <span className="text-sm text-muted-foreground">({STATUS_LABEL[lp.status] ?? lp.status}{lp.variantTitle ? ` · ${lp.variantTitle}` : ""})</span>
              <AdminLink href={lp.adminUrl}>Open in Shopify</AdminLink>
            </p>
          ))}
          <p className="text-sm text-muted-foreground">Linked to the recipe, so its sales reach the planner. The app leaves it as it is.</p>
        </div>
      ) : (
        <>
          {r.createdProduct && (
            <p className="text-base flex items-center gap-2 flex-wrap">
              Made earlier: <b>{r.createdProduct.title}</b> ({STATUS_LABEL[r.createdProduct.status] ?? r.createdProduct.status})
              <AdminLink href={r.createdProduct.adminUrl}>Open in Shopify</AdminLink>
            </p>
          )}
          {r.action === "create" && (
            <div className="space-y-1">
              <label className="text-sm font-semibold text-muted-foreground" htmlFor={`tpl-${r.recipeId}`}>Duplicate this product</label>
              <div className="flex items-center gap-2 flex-wrap">
                <select
                  id={`tpl-${r.recipeId}`}
                  value={r.template?.productId ?? ""}
                  onChange={e => onTemplate(e.target.value)}
                  className="flex-1 min-w-[220px] px-3 py-2.5 rounded-xl border-2 border-border bg-background text-base"
                >
                  {!r.template && <option value="">Pick a product…</option>}
                  {options.map(t => <option key={t.productId} value={t.productId}>{t.title} ({STATUS_LABEL[t.status] ?? t.status})</option>)}
                </select>
                {r.template && <AdminLink href={r.template.adminUrl}>Open</AdminLink>}
              </div>
              {r.template && (
                <p className="text-sm text-muted-foreground">
                  {r.template.reason ? `Chosen: ${r.template.reason}. ` : ""}Its price ({r.template.price ? `£${r.template.price}` : "—"}), 2 Pack variant, weight and settings come across{r.imagesCopied ? `, with ${r.template.imageCount} image${r.template.imageCount === 1 ? "" : "s"}` : ", without images"}.
                </p>
              )}
            </div>
          )}

          <dl className="grid grid-cols-1 sm:grid-cols-[150px_1fr] gap-x-3 gap-y-1.5 text-base">
            <dt className="text-muted-foreground">Title</dt><dd className="font-semibold">{r.title}</dd>
            <dt className="text-muted-foreground">Status</dt><dd>{STATUS_LABEL[r.statusAfter] ?? r.statusAfter}{r.action === "create" ? " — hidden until you set it Active" : ""}</dd>
            <dt className="text-muted-foreground">Tags</dt>
            <dd className="flex flex-wrap gap-1.5">
              {r.tags.map(t => <Chip key={t} tone="emerald">{t}</Chip>)}
              {r.tagsRemoved.map(t => <span key={t} className="px-2 py-0.5 rounded-full bg-secondary text-muted-foreground text-xs line-through" title="Removed (carried over from the template)">{t}</span>)}
            </dd>
            <dt className="text-muted-foreground">Barcode</dt><dd>{r.barcode}</dd>
            {r.metafields.map(m => (
              <MetafieldRow key={m.field} m={m} />
            ))}
          </dl>

          <div>
            <button onClick={() => setShowNutrition(s => !s)} className="text-sm font-semibold text-primary inline-flex items-center gap-1">
              {showNutrition ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />} Nutrition from the app {r.nutrition.complete ? "" : "(incomplete)"} — for the nutrition image
            </button>
            {showNutrition && <NutritionTable n={r.nutrition} />}
          </div>
        </>
      )}

      {r.blocking.map(w => <Banner key={w} tone="red" icon={<AlertTriangle className="w-5 h-5" />}>{w}</Banner>)}
      {r.warnings.map(w => <Banner key={w} tone="amber" icon={<AlertTriangle className="w-5 h-5" />}>{w}</Banner>)}

      {r.action !== "linked" && (
        <div className="flex items-center gap-2 flex-wrap pt-1">
          <button
            onClick={onCreate}
            disabled={!!blockedBy || r.blocking.length > 0 || busy}
            title={blockedBy ?? r.blocking[0]}
            className="px-4 py-3 rounded-xl bg-emerald-600 text-white text-base font-semibold hover:bg-emerald-700 disabled:opacity-50"
          >
            {r.action === "create" ? "Create this one in Shopify (draft)" : "Update this one in Shopify"}
          </button>
          {r.action === "create" && (
            <button onClick={() => setLinking(l => !l)} className="px-4 py-3 rounded-xl border-2 border-border text-base font-semibold hover:bg-secondary inline-flex items-center gap-2">
              <Link2 className="w-5 h-5" /> Link an existing product
            </button>
          )}
        </div>
      )}
      {linking && <LinkExisting boxId={boxId} recipeId={r.recipeId} initial={r.possibleMatch?.title ?? r.recipeName} canLink={!blockedBy || blockedBy.startsWith("Shopify")} onDone={() => { setLinking(false); onLinked(); }} />}
    </section>
  );
}

function MetafieldRow({ m }: { m: MetafieldLine }) {
  const tone = m.action === "set" ? "text-foreground" : m.action === "remove" ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground";
  return (
    <>
      <dt className="text-muted-foreground">{m.label}</dt>
      <dd className={cn("text-sm", tone)}>
        <span className="font-semibold">{m.action === "set" ? "Written: " : m.action === "keep" ? "Kept: " : m.action === "remove" ? "Removed: " : ""}</span>
        {m.summary}
      </dd>
    </>
  );
}

function NutritionTable({ n }: { n: RecipePreview["nutrition"] }) {
  if (!n.rows.length) return <p className="text-sm text-muted-foreground mt-1">No nutrition worked out for this recipe yet.</p>;
  return (
    <table className="mt-2 w-full max-w-md text-sm">
      <thead><tr className="text-muted-foreground"><th className="text-left font-semibold py-1"></th><th className="text-right font-semibold">Per 100g</th><th className="text-right font-semibold">Per calzone{n.portionWeightG ? ` (${n.portionWeightG}g)` : ""}</th></tr></thead>
      <tbody>
        {n.rows.map((row, i) => (
          <tr key={i} className="border-t border-border">
            <td className="py-1">{row.label}</td><td className="text-right tabular-nums">{row.per100g}</td><td className="text-right tabular-nums">{row.perPortion}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LinkExisting({ boxId, recipeId, initial, canLink, onDone }: { boxId: number; recipeId: number; initial: string; canLink: boolean; onDone: () => void }) {
  const [q, setQ] = useState(initial);
  const [debounced, setDebounced] = useState(initial);
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 350); return () => clearTimeout(t); }, [q]);
  const search = useQuery({
    queryKey: ["test-boxes", boxId, "shopify-search", debounced],
    queryFn: () => call<{ products: SearchHit[] }>(boxId, `/search?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length >= 2,
    staleTime: 30_000,
  });
  const link = useMutation({
    mutationFn: (variantIds: string[]) => call<{ linked: string[]; conflicts: string[] }>(boxId, "/link", { method: "POST", body: JSON.stringify({ recipeId, variantIds }) }),
    onSuccess: onDone,
  });
  return (
    <div className="rounded-2xl border-2 border-dashed border-border p-3.5 space-y-3">
      <p className="text-sm text-muted-foreground">Find the product in Shopify (read only) and link its 2 Pack variant to this recipe. Nothing in Shopify changes.</p>
      <div className="relative">
        <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Product title…" aria-label="Search Shopify products"
          className="w-full pl-10 pr-3 py-2.5 rounded-xl border-2 border-border bg-background text-base focus:outline-none focus:border-primary" />
      </div>
      {search.isFetching && <p className="text-sm flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Searching…</p>}
      {search.error && <p className="text-sm text-destructive">{(search.error as Error).message}</p>}
      {link.error && <p className="text-sm text-destructive">{(link.error as Error).message}</p>}
      <ul className="space-y-2">
        {(search.data?.products ?? []).map(h => (
          <li key={h.productId} className="rounded-xl border border-border p-3 flex items-start gap-3">
            {h.imageUrl ? <img src={h.imageUrl} alt="" className="w-12 h-12 rounded-lg object-cover flex-shrink-0" /> : <div className="w-12 h-12 rounded-lg bg-secondary flex-shrink-0" />}
            <div className="flex-1 min-w-0">
              <p className="font-semibold">{h.title} <span className="text-sm text-muted-foreground font-normal">({STATUS_LABEL[h.status] ?? h.status})</span></p>
              <div className="flex flex-wrap gap-2 mt-1.5">
                {h.variants.map(v => (
                  <button key={v.id} onClick={() => link.mutate([v.id])} disabled={!canLink || link.isPending}
                    className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50">
                    Link "{v.title}"
                  </button>
                ))}
              </div>
            </div>
          </li>
        ))}
        {search.data && search.data.products.length === 0 && <li className="text-sm text-muted-foreground">No products match.</li>}
      </ul>
    </div>
  );
}

function ConfirmCreate({ recipes, includeImages, pending, error, onCancel, onConfirm }: {
  recipes: RecipePreview[]; includeImages: boolean; pending: boolean; error: Error | null;
  onCancel: () => void; onConfirm: () => void;
}) {
  const making = recipes.filter(r => r.action === "create").length;
  const updating = recipes.filter(r => r.action === "update").length;
  const parts = [
    making ? `creates ${making} draft product${making === 1 ? "" : "s"}` : null,
    updating ? `updates ${updating} product${updating === 1 ? "" : "s"} the app made before` : null,
  ].filter(Boolean);
  return (
    <Shell title={recipes.length === 1 ? `Create '${recipes[0].recipeName}' in Shopify?` : `Create ${recipes.length} products in Shopify?`} onClose={onCancel} narrow
      footer={(
        <>
          <button onClick={onCancel} className="flex-1 px-4 py-3 rounded-xl border-2 border-border text-base font-semibold hover:bg-secondary">Cancel</button>
          <button onClick={onConfirm} disabled={pending} className="flex-1 px-4 py-3 rounded-xl bg-emerald-600 text-white text-base font-semibold hover:bg-emerald-700 disabled:opacity-50 inline-flex items-center justify-center gap-2">
            {pending && <Loader2 className="w-5 h-5 animate-spin" />} {pending ? "Working…" : making ? "Create as drafts" : "Update"}
          </button>
        </>
      )}
    >
      <p className="text-base">This {parts.join(", and ")} in your Shopify store. <b>Nothing is published.</b></p>
      <p className="text-sm text-muted-foreground">No collection is made here — that's the next step on the launch checklist, once every recipe has its product.</p>
      <ul className="text-sm list-disc pl-5 space-y-0.5">
        {recipes.map(r => <li key={r.recipeId}>{r.title}{r.action === "create" ? (includeImages ? " — with the template's images" : " — no images") : " — update"}</li>)}
      </ul>
      <p className="text-sm text-muted-foreground">Barcodes stay blank (GS1, by hand), and each product is linked to its recipe so sales reach the planner.</p>
      {error && <p className="text-sm text-destructive flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> {error.message}</p>}
    </Shell>
  );
}

function Results({ result, onBack }: { result: RunResult; onBack: () => void }) {
  const tone = (o: RecipeResult["outcome"]) => o === "created" || o === "updated" ? "emerald" : o === "failed" ? "red" : "slate";
  return (
    <div className="space-y-3">
      {result.stoppedByGuard && <Banner tone="amber" icon={<ShieldAlert className="w-5 h-5" />}><b>Stopped by the safety switch.</b> {result.stoppedByGuard}</Banner>}
      {result.results.map(r => (
        <div key={r.recipeId} className="rounded-2xl border-2 border-border p-4 space-y-1">
          <p className="text-base font-bold flex items-center gap-2 flex-wrap">
            {r.recipeName} <Chip tone={tone(r.outcome)}>{r.outcome === "created" ? "Made (draft)" : r.outcome === "updated" ? "Updated" : r.outcome === "failed" ? "Failed" : "Not changed"}</Chip>
            {r.product && <AdminLink href={r.product.adminUrl}>Open in Shopify</AdminLink>}
          </p>
          <p className="text-sm">{r.message}</p>
          {r.steps.length > 0 && <ul className="text-sm text-muted-foreground list-disc pl-5">{r.steps.map(s => <li key={s}>{s}</li>)}</ul>}
        </div>
      ))}
      {result.ticked.products && (
        <p className="text-sm flex items-center gap-2"><Check className="w-4 h-4 text-emerald-600" /> Every recipe now has its Shopify product — 'Create Shopify products' is ticked. Next: create the collection.</p>
      )}
      <p className="text-sm text-muted-foreground">Still by hand (on the launch checklist): GS1 barcodes, the nutrition image, images, price, and setting everything live on launch day.</p>
      <button onClick={onBack} className="px-4 py-3 rounded-xl border-2 border-border text-base font-semibold hover:bg-secondary">Back to the preview</button>
    </div>
  );
}

export function Banner({ tone, icon, children }: { tone: "amber" | "red"; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className={cn("rounded-xl p-3 text-sm flex items-start gap-2",
      tone === "red" ? "bg-red-500/10 text-red-800 dark:text-red-300 border border-red-500/40" : "bg-amber-500/10 text-amber-900 dark:text-amber-200 border border-amber-500/40")}>
      <span className="flex-shrink-0 mt-0.5">{icon}</span><span>{children}</span>
    </div>
  );
}

export function Chip({ tone, children }: { tone: "emerald" | "slate" | "sky" | "amber" | "red"; children: React.ReactNode }) {
  const cls = {
    emerald: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
    slate: "bg-secondary text-foreground",
    sky: "bg-sky-500/15 text-sky-800 dark:text-sky-300",
    amber: "bg-amber-500/20 text-amber-800 dark:text-amber-300",
    red: "bg-red-600 text-white",
  }[tone];
  return <span className={cn("px-2 py-0.5 rounded-full text-xs font-semibold", cls)}>{children}</span>;
}

export function AdminLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-primary underline underline-offset-2">
      {children} <ExternalLink className="w-3.5 h-3.5" />
    </a>
  );
}
