/**
 * "Create Shopify product" on a recipe (Graeme, 30 Oct 2026: "click in a
 * recipe, click 'Create Shopify product', and it sets up the product in
 * Shopify"). Objective A. Lives in the recipe editor's More tab, above the
 * Shopify Inventory Link.
 *
 *   Card: already in Shopify → the product(s) with "Open in Shopify"; else a
 *   "Create Shopify product" button (managers and admins).
 *   Button → a window with the PREVIEW of exactly what will be made (read
 *   from Shopify, nothing changed): title, Draft, product type blank, tags,
 *   the one 2 Pack variant and its price, each metafield, the photo, the
 *   nutrition image (drawn here from the recipe's numbers) and the listing
 *   description — plus anything that stops it. "Create draft in Shopify"
 *   makes it; nothing is ever published.
 *
 *   The window lists "What goes to Shopify" (barcode included — the app's,
 *   typed here in the same Barcode box as the label page, then put on the
 *   2 Pack and sent by the app's barcode sync), warns per ingredient about
 *   missing nutrition / label declarations (the deck is then left off, never
 *   partial — Create still allowed), and "Also set up in the app": the back
 *   label (published) and the front label (switched on), each with a tick —
 *   shopify-product-labels.tsx (Graeme, 30 Oct 2026).
 *
 *   Already in Shopify → "Add nutrition table" (Graeme, 30 Oct 2026: products
 *   made before the app could upload files went out without it). Ticks the
 *   recipe's products with no nutrition image; one that has one is only
 *   replaced when ticked by hand.
 *
 * API: routes/recipe-shopify-product.ts. Shapes mirror
 * api-server lib/recipe-shopify-product-preview.ts + -run.ts.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { AlertTriangle, Check, ChevronDown, ChevronRight, ClipboardList, Loader2, Printer, ShieldAlert, ShoppingBag, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { base64FromDataUrl, nutritionImageLayout, type NutritionImageRow } from "@/lib/nutrition-image";
import { drawNutritionPng } from "@/lib/nutrition-image-canvas";
import { AdminLink, Banner, Chip } from "@/components/test-boxes/shopify-products-card";
import { BarcodeGroupCard } from "@/components/barcodes/recipe-barcodes";
import { useRecipeBarcodes, type GroupView } from "@/components/barcodes/api";
import { BackLabelsDialog } from "@/components/product-labels/back-labels-dialog";
import { FrontLabelsDialog } from "@/components/product-labels/front-labels-dialog";
import { LabelSetupSection, useLabelSetup } from "./shopify-product-labels";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Types (mirror the server) ───────────────────────────────────────────────
interface ProductLink { productId: string; title: string; status: string; adminUrl: string; variantTitle?: string }
interface MetafieldLine { label: string; field: string; action: "set" | "keep" | "remove" | "none"; summary: string }
interface Preview {
  recipe: { id: number; name: string; isDraft: boolean; archived: boolean };
  writesBlocked: boolean;
  blockedMessage: string | null;
  missingScopes: string[];
  missingFileScopes: string[];
  action: "create" | "update" | "linked";
  linkedProducts: ProductLink[];
  createdProduct: (ProductLink & { state: string; lastError: string | null }) | null;
  template: (ProductLink & { price: string | null; variantTitles: string[]; reason: string }) | null;
  templates: Array<{ productId: string; title: string; status: string; adminUrl: string }>;
  title: string;
  status: "DRAFT";
  productType: string;
  tags: string[];
  tagsLeftOut: Array<{ tag: string; reason: string }>;
  variant: { title: string; removed: string[] };
  price: { set: string | null; summary: string };
  barcode: { code: string | null; summary: string };
  listingDescription: string;
  metafields: MetafieldLine[];
  photo: { willAttach: boolean; summary: string; width: number | null; height: number | null };
  nutrition: { complete: boolean; portionWeightG: number | null; rows: NutritionImageRow[] };
  nutritionImage: { willAttach: boolean; summary: string };
  declarationGaps: { items: Array<{ ingredientId: number | null; name: string; missing: string[] }>; headlines: string[] };
  deckLeftOff: boolean;
  warnings: string[];
  blocking: string[];
}
interface Status {
  state: "linked" | "started" | "none";
  products: Array<{ title: string; variantTitle: string | null; adminUrl: string | null; status: string | null }>;
  started: (ProductLink & { lastError: string | null }) | null;
  shopifyUnreachable: boolean;
}
interface LabelOutcome { done: boolean; message: string; versionNo?: number | null }
interface RunResult {
  outcome: "created" | "finished" | "blocked"; message: string; product: ProductLink | null; steps: string[]; linkedVariants: string[];
  barcode: string | null; deckLeftOff: boolean; backLabel: LabelOutcome | null; frontLabel: LabelOutcome | null;
}
interface NutritionTarget { productId: string; title: string; status: string; adminUrl: string; hasNutrition: boolean }
interface NutritionPlan {
  writesBlocked: boolean;
  blockedMessage: string | null;
  missingScopes: string[];
  missingFileScopes: string[];
  products: NutritionTarget[];
  ticked: string[];
  nutrition: Preview["nutrition"];
  blocking: string[];
}
interface NutritionRunResult { outcome: "done" | "blocked"; message: string; products: NutritionTarget[] }

const STATUS_LABEL: Record<string, string> = { DRAFT: "Draft", ACTIVE: "Active", ARCHIVED: "Archived", UNLISTED: "Unlisted" };

async function call<T>(path: string, init?: RequestInit, acceptBlocked = false): Promise<T> {
  const res = await fetch(`${BASE}/api/recipes${path}`, {
    credentials: "include",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  const body = await res.json().catch(() => ({})) as { error?: string; code?: string; details?: { fieldErrors?: Record<string, string[]> } };
  // A run the write guard stopped still comes back with its message.
  if (acceptBlocked && res.status === 503 && body.code === "SHOPIFY_WRITES_BLOCKED") return body as T;
  if (!res.ok) {
    const field = body.details?.fieldErrors ? Object.values(body.details.fieldErrors)[0]?.[0] : undefined;
    throw new Error(field ?? body.error ?? `HTTP ${res.status}`);
  }
  return body as T;
}

export const shopifyProductKey = (recipeId: number) => ["recipe-shopify-product", recipeId] as const;

export function CreateShopifyProductCard({ recipeId, canEdit, unsavedChanges, onLinked }: {
  recipeId: number;
  canEdit: boolean;
  /** The editor has unsaved changes — the product is made from the SAVED recipe. */
  unsavedChanges: boolean;
  /** A variant was linked to the recipe (refresh the mapping list). */
  onLinked: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [nutritionOpen, setNutritionOpen] = useState(false);
  const status = useQuery({
    queryKey: shopifyProductKey(recipeId),
    queryFn: () => call<Status>(`/${recipeId}/shopify-product`),
    staleTime: 30_000,
  });
  const s = status.data;

  return (
    <section className="rounded-2xl border-2 border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <ShoppingBag className="w-5 h-5 text-emerald-600" />
        <h4 className="text-base font-bold flex-1">Shopify product</h4>
        {status.isFetching && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
      </div>

      {status.error && <p className="text-sm text-destructive flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> {(status.error as Error).message}</p>}

      {s?.state === "linked" && (
        <div className="space-y-1.5">
          {s.products.map(p => (
            <p key={`${p.title}-${p.adminUrl}`} className="text-base flex items-center gap-2 flex-wrap">
              <Check className="w-5 h-5 text-emerald-600" /> Already in Shopify — <b>{p.title}</b>
              {(p.status || p.variantTitle) && <span className="text-sm text-muted-foreground">({[p.status ? STATUS_LABEL[p.status] ?? p.status : null, p.variantTitle].filter(Boolean).join(" · ")})</span>}
              {p.adminUrl && <AdminLink href={p.adminUrl}>Open it in Shopify</AdminLink>}
            </p>
          ))}
          {s.shopifyUnreachable && <p className="text-sm text-muted-foreground">Couldn't read Shopify just now, so these are the planner's own links.</p>}
          <p className="text-sm text-muted-foreground">Linked to this recipe, so its sales reach the planner. A second product is never made.</p>
          {canEdit && (
            <button type="button" onClick={() => setNutritionOpen(true)}
              className="min-h-12 px-5 rounded-xl border-2 border-border text-base font-semibold hover:bg-secondary inline-flex items-center gap-2">
              <ClipboardList className="w-5 h-5" /> Add nutrition table
            </button>
          )}
        </div>
      )}

      {s?.state === "started" && s.started && (
        <p className="text-sm flex items-center gap-2 flex-wrap">
          <AlertTriangle className="w-4 h-4 text-amber-600" /> The app started a draft (<b>{s.started.title}</b>) but didn't finish{s.started.lastError ? `: ${s.started.lastError}` : ""}.
          <AdminLink href={s.started.adminUrl}>Open it in Shopify</AdminLink>
        </p>
      )}

      {s && s.state !== "linked" && (
        <>
          {s.state === "none" && (
            <p className="text-sm text-muted-foreground">
              Makes this recipe's product in Shopify as a <b>draft</b>: its tags, the 2 Pack and its barcode, the recipe description, nutrition, ingredient deck, listing description and photo — links it here, and sets up its back and front labels. You'll see exactly what first.
            </p>
          )}
          {unsavedChanges && (
            <Banner tone="amber" icon={<AlertTriangle className="w-4 h-4" />}>You have unsaved changes — save them first; the product is made from the saved recipe.</Banner>
          )}
          {canEdit ? (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="min-h-12 px-5 rounded-xl bg-emerald-600 text-white text-base font-semibold hover:bg-emerald-700 inline-flex items-center gap-2"
            >
              <ShoppingBag className="w-5 h-5" /> {s.state === "started" ? "Finish the Shopify product" : "Create Shopify product"}
            </button>
          ) : (
            <p className="text-sm text-muted-foreground">Only a manager or admin can create the product.</p>
          )}
        </>
      )}

      {open && <CreateProductDialog recipeId={recipeId} onClose={() => setOpen(false)} onLinked={onLinked} canEdit={canEdit} />}
      {nutritionOpen && <AddNutritionDialog recipeId={recipeId} onClose={() => setNutritionOpen(false)} />}
    </section>
  );
}

/** The barcode line, live from the Barcode box (so a number typed in the
 *  window shows at once); the preview's own line until that has loaded. */
function barcodeText(p: Preview, g: GroupView | undefined): { text: string; missing: boolean } {
  if (p.action === "linked" || !g) return { text: p.barcode.summary, missing: !p.barcode.code };
  if (g.heldProblem) return { text: g.heldProblem, missing: true };
  if (!g.barcode) return { text: "None yet — set one on the Label tab, or type it here", missing: true };
  if (g.barcode === p.barcode.code) return { text: p.barcode.summary, missing: false };
  return { text: `${g.barcode} — typed here. Put on the 2 Pack when it's linked and sent to Shopify by the app's barcode sync (never over a different number already there)`, missing: false };
}

function CreateProductDialog({ recipeId, onClose, onLinked, canEdit }: { recipeId: number; onClose: () => void; onLinked: () => void; canEdit: boolean }) {
  const qc = useQueryClient();
  // The barcode (same box as the label page) and the labels, live.
  const barcodes = useRecipeBarcodes(recipeId);
  const packGroup = barcodes.data?.groups.find(g => g.kind === "pack");
  const labels = useLabelSetup(recipeId);
  const [templateProductId, setTemplateProductId] = useState<string | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [showNutrition, setShowNutrition] = useState(false);

  const preview = useQuery({
    queryKey: ["recipe-shopify-product-preview", recipeId, templateProductId],
    queryFn: () => call<Preview>(`/${recipeId}/shopify-product/preview`, { method: "POST", body: JSON.stringify({ templateProductId }) }),
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  const p = preview.data;

  // The nutrition image, drawn here from the preview's numbers; only sent
  // when the preview says it will be put on.
  const nutritionPng = useMemo(() => {
    if (!p || !p.nutrition.complete) return null;
    const layout = nutritionImageLayout(p.nutrition.rows, p.nutrition.portionWeightG);
    if (!layout) return null;
    try { return drawNutritionPng(layout); } catch { return null; }
  }, [p]);

  const create = useMutation({
    mutationFn: () => call<RunResult>(`/${recipeId}/shopify-product/create`, {
      method: "POST",
      body: JSON.stringify({
        templateProductId: templateProductId ?? p?.template?.productId ?? null,
        nutritionPngBase64: p?.nutritionImage.willAttach && nutritionPng ? base64FromDataUrl(nutritionPng) : null,
        ...labels.payload,
      }),
    }, true),
    onSuccess: r => {
      setResult(r);
      void qc.invalidateQueries({ queryKey: shopifyProductKey(recipeId) });
      void qc.invalidateQueries({ queryKey: ["barcodes"] });
      void qc.invalidateQueries({ queryKey: ["product-labels"] });
      void qc.invalidateQueries({ queryKey: ["front-label-preview", recipeId] });
      if (r.linkedVariants.length) onLinked();
    },
  });

  const blockedBy = !p ? null
    : p.action === "linked" ? "Already in Shopify."
    : p.missingScopes.length && !p.writesBlocked ? "Shopify hasn't given the app permission to create products yet."
    : p.blocking.length ? p.blocking[0]
    : null;

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="p-0 gap-0 flex flex-col w-[calc(100vw-1rem)] sm:max-w-3xl max-h-[92dvh] overflow-hidden bg-card border-border rounded-2xl [&>button:last-child]:hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <ShoppingBag className="w-6 h-6 text-emerald-600 shrink-0" />
          <DialogTitle className="flex-1 font-display font-bold text-lg">Create Shopify product</DialogTitle>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-secondary" aria-label="Close"><X className="w-6 h-6" /></button>
        </div>
        <DialogDescription className="sr-only">Preview of the draft product, then make it in Shopify.</DialogDescription>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {preview.isLoading && <p className="flex items-center gap-2 text-base"><Loader2 className="w-5 h-5 animate-spin" /> Reading Shopify and the recipe — nothing is changed…</p>}
          {preview.error && <p className="text-destructive flex items-center gap-2"><AlertTriangle className="w-5 h-5" /> {(preview.error as Error).message}</p>}

          {result && <Result result={result} recipeId={recipeId} recipeName={p?.recipe.name ?? p?.title ?? "This recipe"} />}

          {p && !result && (
            <>
              {p.writesBlocked && (
                <Banner tone="amber" icon={<ShieldAlert className="w-5 h-5" />}>
                  <b>Shopify writes are switched off on this server.</b> You can preview everything, but Create will stop before anything is made.
                </Banner>
              )}
              {p.missingScopes.length > 0 && (
                <Banner tone="red" icon={<ShieldAlert className="w-5 h-5" />}>
                  <b>Shopify hasn't given the app permission to create products yet.</b> In the Shopify app's settings (Dev Dashboard → the planner app → Access scopes) add <code>{p.missingScopes.join(", ")}</code>, release the new version and approve it in the store. Until then this can only preview.
                </Banner>
              )}
              {p.missingFileScopes.length > 0 && (
                <Banner tone="amber" icon={<ShieldAlert className="w-5 h-5" />}>
                  <b>No permission to upload files yet ({p.missingFileScopes.join(", ")})</b> — the nutrition image will be left off; everything else is still made. Add the scope the same way to have it put on.
                </Banner>
              )}

              {p.action === "linked" ? (
                <div className="space-y-2">
                  {p.linkedProducts.map(lp => (
                    <p key={lp.productId} className="text-base flex items-center gap-2 flex-wrap">
                      <Check className="w-5 h-5 text-emerald-600" /> Already in Shopify — <b>{lp.title}</b>
                      <span className="text-sm text-muted-foreground">({STATUS_LABEL[lp.status] ?? lp.status}{lp.variantTitle ? ` · ${lp.variantTitle}` : ""})</span>
                      <AdminLink href={lp.adminUrl}>Open it in Shopify</AdminLink>
                    </p>
                  ))}
                  <p className="text-sm text-muted-foreground">Nothing will be made — the recipe already has its product.</p>
                </div>
              ) : (
                <>
                  {p.action === "update" && p.createdProduct && (
                    <p className="text-base flex items-center gap-2 flex-wrap">
                      Finishing: <b>{p.createdProduct.title}</b> ({STATUS_LABEL[p.createdProduct.status] ?? p.createdProduct.status})
                      <AdminLink href={p.createdProduct.adminUrl}>Open</AdminLink>
                    </p>
                  )}
                  {p.action === "create" && (
                    <div className="space-y-1">
                      <label className="text-sm font-semibold text-muted-foreground" htmlFor="recipe-shopify-template">Settings copied from</label>
                      <div className="flex items-center gap-2 flex-wrap">
                        <select
                          id="recipe-shopify-template"
                          value={p.template?.productId ?? ""}
                          onChange={e => setTemplateProductId(e.target.value || null)}
                          className="flex-1 min-w-[220px] min-h-11 px-3 rounded-xl border-2 border-border bg-background text-base"
                        >
                          {!p.template && <option value="">Pick a product…</option>}
                          {p.template && !p.templates.some(t => t.productId === p.template!.productId) && (
                            <option value={p.template.productId}>{p.template.title} ({STATUS_LABEL[p.template.status] ?? p.template.status})</option>
                          )}
                          {p.templates.map(t => <option key={t.productId} value={t.productId}>{t.title} ({STATUS_LABEL[t.status] ?? t.status})</option>)}
                        </select>
                        {p.template && <AdminLink href={p.template.adminUrl}>Open</AdminLink>}
                      </div>
                      {p.template && (
                        <p className="text-sm text-muted-foreground">
                          {p.template.reason ? `Chosen: ${p.template.reason}. ` : ""}Its 2 Pack's weight, inventory settings, template and vendor come across — never its images, type, tags or details.
                        </p>
                      )}
                    </div>
                  )}

                  <h3 className="text-lg font-bold">What goes to Shopify</h3>
                  <dl className="grid grid-cols-1 sm:grid-cols-[170px_1fr] gap-x-3 gap-y-1.5 text-base">
                    <dt className="text-muted-foreground">Title</dt><dd className="font-semibold">{p.title}</dd>
                    <dt className="text-muted-foreground">Status</dt><dd>Draft — hidden until you set it Active in Shopify</dd>
                    <dt className="text-muted-foreground">Product type</dt><dd>Blank — kept off the website's main menu</dd>
                    <dt className="text-muted-foreground">Tags</dt>
                    <dd className="space-y-1.5">
                      <span className="flex flex-wrap gap-1.5">{p.tags.map(t => <Chip key={t} tone="emerald">{t}</Chip>)}</span>
                      {p.tagsLeftOut.length > 0 && (
                        <span className="block text-sm text-muted-foreground">
                          Left out: {p.tagsLeftOut.map(l => `${l.tag} (${l.reason})`).join("; ")}.
                        </span>
                      )}
                    </dd>
                    <dt className="text-muted-foreground">Variant</dt>
                    <dd>
                      Size: <b>{p.variant.title}</b> only
                      {p.variant.removed.length > 0 && <span className="text-sm text-muted-foreground"> — removed from the copy: {p.variant.removed.join(", ")}</span>}
                    </dd>
                    <dt className="text-muted-foreground">Price</dt>
                    <dd className={cn(p.price.set ? "font-semibold" : "text-amber-700 dark:text-amber-300")}>{p.price.summary}</dd>
                    <dt className="text-muted-foreground">Barcode</dt>
                    <dd className={cn(barcodeText(p, packGroup).missing && "text-amber-700 dark:text-amber-300")}>{barcodeText(p, packGroup).text}</dd>
                    {p.metafields.map(m => (
                      <MetafieldRow key={m.field} m={m} />
                    ))}
                    <dt className="text-muted-foreground">Photo</dt>
                    <dd className={cn("text-sm", !p.photo.willAttach && "text-amber-700 dark:text-amber-300")}>{p.photo.summary}</dd>
                  </dl>

                  {/* The same Barcode box as the label page: checked the same
                      way (check digit; a number another product holds is
                      only moved after you confirm), autosaved, held for the
                      recipe and put on the 2 Pack when Create links it. */}
                  {packGroup && <BarcodeGroupCard group={packGroup} canEdit={canEdit} />}

                  <div className="rounded-2xl border-2 border-border p-3.5 space-y-1">
                    <p className="text-sm font-semibold text-muted-foreground">Product page description (from the Details tab)</p>
                    {p.listingDescription
                      ? p.listingDescription.split(/\n\s*\n/).map((para, i) => <p key={i} className="text-base">{para}</p>)
                      : <p className="text-base text-amber-700 dark:text-amber-300">None yet — write it (or Draft with AI) on the Details tab.</p>}
                  </div>

                  <div className="flex flex-col sm:flex-row gap-4">
                    {p.photo.willAttach && (
                      <img src={`${BASE}/api/recipes/${recipeId}/product-photo`} alt="Product photo" className="w-full sm:w-56 aspect-[4/3] object-cover rounded-lg border border-border" />
                    )}
                    <div className={cn("flex-1 rounded-2xl border-2 p-3.5 space-y-2", p.nutritionImage.willAttach && nutritionPng ? "border-emerald-500/40 bg-emerald-500/5" : "border-border")}>
                      <p className="text-base font-bold flex items-center gap-2">
                        {p.nutritionImage.willAttach && nutritionPng ? <Check className="w-5 h-5 text-emerald-600" /> : <AlertTriangle className="w-5 h-5 text-amber-600" />}
                        Nutrition image {p.nutritionImage.willAttach && nutritionPng ? "— will be put on" : "— left off"}
                      </p>
                      <p className="text-sm">{p.nutritionImage.willAttach && !nutritionPng ? "This page couldn't draw the image, so it will be left off — close and try again." : p.nutritionImage.summary}</p>
                      {nutritionPng && <img src={nutritionPng} alt="Nutrition table" className={cn("w-full max-w-[300px] rounded-lg border border-border bg-white", !p.nutritionImage.willAttach && "opacity-60")} />}
                      <button type="button" onClick={() => setShowNutrition(v => !v)} className="text-sm font-semibold text-primary inline-flex items-center gap-1">
                        {showNutrition ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />} The numbers {p.nutrition.complete ? "" : "(incomplete)"}
                      </button>
                      {showNutrition && <NutritionTable n={p.nutrition} />}
                    </div>
                  </div>

                  {(p.declarationGaps.items.length > 0 || p.declarationGaps.headlines.length > 0) && (
                    <div className="rounded-2xl border-2 border-amber-500/50 bg-amber-500/10 p-3.5 space-y-2 text-amber-900 dark:text-amber-200">
                      <p className="text-base font-bold flex items-center gap-2"><AlertTriangle className="w-5 h-5" /> Missing nutrition or label declarations</p>
                      {p.declarationGaps.items.length > 0 && (
                        <ul className="space-y-0.5 text-sm">
                          {p.declarationGaps.items.map(g => <li key={`${g.ingredientId ?? ""}:${g.name}`}><b>{g.name}</b> — {g.missing.join("; ")}</li>)}
                        </ul>
                      )}
                      {p.declarationGaps.headlines.map(h => <p key={h} className="text-sm font-semibold">{h}</p>)}
                      <p className="text-sm">You can still create the product. Fix these on the recipe's <b>Label</b> tab (each ingredient opens from there).</p>
                    </div>
                  )}

                  <LabelSetupSection recipeId={recipeId} setup={labels} />
                </>
              )}

              {p.blocking.map(w => <Banner key={w} tone="red" icon={<AlertTriangle className="w-5 h-5" />}>{w}</Banner>)}
              {p.warnings.map(w => <Banner key={w} tone="amber" icon={<AlertTriangle className="w-5 h-5" />}>{w}</Banner>)}
            </>
          )}
          {create.error && <p className="text-sm text-destructive flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> {(create.error as Error).message}</p>}
        </div>

        <div className="border-t border-border px-5 py-3.5 flex items-center gap-3 flex-wrap">
          {result ? (
            <>
              <span className="flex-1" />
              <button type="button" onClick={onClose} className="min-h-12 px-5 rounded-xl bg-primary text-primary-foreground text-base font-semibold">Done</button>
            </>
          ) : (
            <>
              <p className="flex-1 text-sm text-muted-foreground min-w-[200px]">{blockedBy ?? "A draft only — nothing is published."}</p>
              <button type="button" onClick={onClose} className="min-h-12 px-4 rounded-xl border-2 border-border text-base font-semibold hover:bg-secondary">Cancel</button>
              {p?.action !== "linked" && (
                <button
                  type="button"
                  onClick={() => create.mutate()}
                  disabled={!p || !!blockedBy || create.isPending}
                  title={blockedBy ?? undefined}
                  className="min-h-12 px-5 rounded-xl bg-emerald-600 text-white text-base font-semibold hover:bg-emerald-700 disabled:opacity-50 inline-flex items-center gap-2"
                >
                  {create.isPending && <Loader2 className="w-5 h-5 animate-spin" />}
                  {create.isPending ? "Making it…" : p?.action === "update" ? "Finish the draft in Shopify" : "Create draft in Shopify"}
                </button>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The nutrition table on the recipe's existing Shopify products: preview
 *  (reads only) → tick → "Put it on". Uploaded once, set on each ticked one. */
function AddNutritionDialog({ recipeId, onClose }: { recipeId: number; onClose: () => void }) {
  const [picked, setPicked] = useState<string[] | null>(null);
  const [result, setResult] = useState<NutritionRunResult | null>(null);
  const [showNumbers, setShowNumbers] = useState(false);
  const plan = useQuery({
    queryKey: ["recipe-shopify-nutrition-preview", recipeId],
    queryFn: () => call<NutritionPlan>(`/${recipeId}/shopify-product/nutrition/preview`, { method: "POST" }),
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  const p = plan.data;
  const ticked = picked ?? p?.ticked ?? [];
  const toggle = (id: string) => setPicked(ticked.includes(id) ? ticked.filter(x => x !== id) : [...ticked, id]);

  const png = useMemo(() => {
    if (!p || !p.nutrition.complete) return null;
    const layout = nutritionImageLayout(p.nutrition.rows, p.nutrition.portionWeightG);
    if (!layout) return null;
    try { return drawNutritionPng(layout); } catch { return null; }
  }, [p]);

  const put = useMutation({
    mutationFn: () => call<NutritionRunResult>(`/${recipeId}/shopify-product/nutrition`, {
      method: "POST",
      body: JSON.stringify({ productIds: ticked, nutritionPngBase64: png ? base64FromDataUrl(png) : "" }),
    }, true),
    onSuccess: r => setResult(r),
  });

  const blockedBy = !p ? null
    : p.blocking.length && !p.writesBlocked ? p.blocking[0]
    : !png ? "This page couldn't draw the nutrition table — close and try again."
    : ticked.length === 0 ? "Tick at least one product."
    : null;
  const replacing = p ? p.products.filter(x => x.hasNutrition && ticked.includes(x.productId)).length : 0;

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="p-0 gap-0 flex flex-col w-[calc(100vw-1rem)] sm:max-w-2xl max-h-[92dvh] overflow-hidden bg-card border-border rounded-2xl [&>button:last-child]:hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <ClipboardList className="w-6 h-6 text-emerald-600 shrink-0" />
          <DialogTitle className="flex-1 font-display font-bold text-lg">Add nutrition table</DialogTitle>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-secondary" aria-label="Close"><X className="w-6 h-6" /></button>
        </div>
        <DialogDescription className="sr-only">Put this recipe's nutrition table image on its Shopify products.</DialogDescription>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {plan.isLoading && <p className="flex items-center gap-2 text-base"><Loader2 className="w-5 h-5 animate-spin" /> Reading Shopify and the recipe — nothing is changed…</p>}
          {plan.error && <p className="text-destructive flex items-center gap-2"><AlertTriangle className="w-5 h-5" /> {(plan.error as Error).message}</p>}

          {result && (result.outcome === "blocked"
            ? <Banner tone="amber" icon={<ShieldAlert className="w-5 h-5" />}><b>Stopped by the safety switch.</b> {result.message}</Banner>
            : (
              <div className="space-y-2">
                <p className="text-lg font-bold flex items-center gap-2"><Check className="w-6 h-6 text-emerald-600" /> Nutrition table put on</p>
                <p className="text-base">{result.message}</p>
                {result.products.map(x => <p key={x.productId} className="text-base flex items-center gap-2 flex-wrap"><b>{x.title}</b> <AdminLink href={x.adminUrl}>Open it in Shopify</AdminLink></p>)}
              </div>
            ))}

          {p && !result && (
            <>
              {p.writesBlocked && (
                <Banner tone="amber" icon={<ShieldAlert className="w-5 h-5" />}><b>Shopify writes are switched off on this server.</b> You can see what would happen, but nothing will be put on.</Banner>
              )}
              {p.blocking.map(b => <Banner key={b} tone="red" icon={<AlertTriangle className="w-5 h-5" />}>{b}</Banner>)}

              {p.products.length > 0 && (
                <div className="space-y-2">
                  <p className="text-base font-bold">Which products?</p>
                  {p.products.map(x => {
                    const on = ticked.includes(x.productId);
                    return (
                      <label key={x.productId} className={cn("flex items-start gap-3 rounded-2xl border-2 p-3.5 cursor-pointer", on ? "border-emerald-500/50 bg-emerald-500/5" : "border-border")}>
                        <input type="checkbox" checked={on} onChange={() => toggle(x.productId)} className="w-6 h-6 mt-0.5 accent-emerald-600 shrink-0" />
                        <span className="flex-1 min-w-0">
                          <span className="block text-base font-semibold">{x.title} <span className="text-sm font-normal text-muted-foreground">({STATUS_LABEL[x.status] ?? x.status})</span></span>
                          <span className={cn("block text-sm", x.hasNutrition ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>
                            {x.hasNutrition ? (on ? "Already has a nutrition table — it will be REPLACED" : "Already has a nutrition table — tick to replace it") : "No nutrition table yet"}
                          </span>
                        </span>
                        <AdminLink href={x.adminUrl}>Open</AdminLink>
                      </label>
                    );
                  })}
                </div>
              )}

              {png && (
                <div className="space-y-2">
                  <p className="text-base font-bold">The image that goes on</p>
                  <img src={png} alt="Nutrition table" className="w-full max-w-[320px] rounded-lg border border-border bg-white" />
                  <button type="button" onClick={() => setShowNumbers(v => !v)} className="text-sm font-semibold text-primary inline-flex items-center gap-1">
                    {showNumbers ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />} The numbers
                  </button>
                  {showNumbers && <NutritionTable n={p.nutrition} />}
                </div>
              )}
            </>
          )}
          {put.error && <p className="text-sm text-destructive flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> {(put.error as Error).message}</p>}
        </div>

        <div className="border-t border-border px-5 py-3.5 flex items-center gap-3 flex-wrap">
          {result ? (
            <>
              <span className="flex-1" />
              <button type="button" onClick={onClose} className="min-h-12 px-5 rounded-xl bg-primary text-primary-foreground text-base font-semibold">Done</button>
            </>
          ) : (
            <>
              <p className="flex-1 text-sm text-muted-foreground min-w-[200px]">{blockedBy ?? (replacing ? `Replaces the table on ${replacing} product${replacing === 1 ? "" : "s"}.` : "Only the nutrition table changes.")}</p>
              <button type="button" onClick={onClose} className="min-h-12 px-4 rounded-xl border-2 border-border text-base font-semibold hover:bg-secondary">Cancel</button>
              <button
                type="button"
                onClick={() => put.mutate()}
                disabled={!p || !!blockedBy || put.isPending}
                className="min-h-12 px-5 rounded-xl bg-emerald-600 text-white text-base font-semibold hover:bg-emerald-700 disabled:opacity-50 inline-flex items-center gap-2"
              >
                {put.isPending && <Loader2 className="w-5 h-5 animate-spin" />}
                {put.isPending ? "Putting it on…" : `Put it on ${ticked.length || ""} product${ticked.length === 1 ? "" : "s"}`.replace("  ", " ")}
              </button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
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
        <span className="text-xs text-muted-foreground"> ({m.field})</span>
      </dd>
    </>
  );
}

function NutritionTable({ n }: { n: Preview["nutrition"] }) {
  if (!n.rows.length) return <p className="text-sm text-muted-foreground">No nutrition worked out for this recipe yet.</p>;
  const hasPortion = n.rows[0]?.perPortion != null;
  return (
    <table className="w-full max-w-md text-sm">
      <thead><tr className="text-muted-foreground"><th className="text-left font-semibold py-1"></th><th className="text-right font-semibold">Per 100g</th>{hasPortion && <th className="text-right font-semibold">Per calzone{n.portionWeightG ? ` (${n.portionWeightG}g)` : ""}</th>}</tr></thead>
      <tbody>
        {n.rows.map((row, i) => (
          <tr key={i} className="border-t border-border">
            <td className="py-1">{row.label}</td><td className="text-right tabular-nums">{row.per100g}</td>{hasPortion && <td className="text-right tabular-nums">{row.perPortion}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Result({ result, recipeId, recipeName }: { result: RunResult; recipeId: number; recipeName: string }) {
  const [printing, setPrinting] = useState<"back" | "front" | null>(null);
  if (result.outcome === "blocked") {
    return <Banner tone="amber" icon={<ShieldAlert className="w-5 h-5" />}><b>Stopped by the safety switch.</b> {result.message}</Banner>;
  }
  const line = (ok: boolean, text: string) => (
    <p className={cn("text-base flex items-start gap-2", !ok && "text-amber-800 dark:text-amber-300")}>
      {ok ? <Check className="w-5 h-5 mt-0.5 shrink-0 text-emerald-600" /> : <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0" />}<span>{text}</span>
    </p>
  );
  const printBtn = "min-h-11 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-bold inline-flex items-center gap-2";
  return (
    <div className="space-y-3">
      <p className="text-lg font-bold flex items-center gap-2 flex-wrap">
        <Check className="w-6 h-6 text-emerald-600" /> {result.outcome === "created" ? "Made as a draft in Shopify" : "Draft finished"}
        {result.product && <AdminLink href={result.product.adminUrl}>Open it in Shopify</AdminLink>}
      </p>
      <p className="text-base">{result.message}</p>
      {result.barcode && line(/✓/.test(result.barcode) || /being sent/.test(result.barcode), result.barcode)}
      {result.deckLeftOff && line(false, "Ingredient deck left off — finish the declarations, then use Push to Shopify on the Label tab.")}
      {result.backLabel && line(result.backLabel.done, result.backLabel.message)}
      {result.frontLabel && line(result.frontLabel.done, result.frontLabel.message)}
      {(result.backLabel && !result.backLabel.done) || (result.frontLabel && !result.frontLabel.done)
        ? <Link href={`/labels/${recipeId}`} className="text-sm font-semibold text-primary underline underline-offset-2">Open the recipe's label page</Link>
        : null}
      {(result.backLabel?.done || result.frontLabel?.done) && (
        <div className="flex flex-wrap gap-2">
          {result.backLabel?.done && <button type="button" onClick={() => setPrinting("back")} className={printBtn}><Printer className="w-4 h-4" /> Print back labels</button>}
          {result.frontLabel?.done && <button type="button" onClick={() => setPrinting("front")} className={printBtn}><Printer className="w-4 h-4" /> Print front labels</button>}
        </div>
      )}
      {result.steps.length > 0 && <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-0.5">{result.steps.map(s => <li key={s}>{s}</li>)}</ul>}
      <p className="text-sm text-muted-foreground">Still by hand in Shopify: any collection it belongs in, and setting it Active when it launches.</p>
      {printing === "back" && <BackLabelsDialog recipeId={recipeId} recipeName={recipeName} mode="today" onClose={() => setPrinting(null)} />}
      {printing === "front" && <FrontLabelsDialog recipeId={recipeId} recipeName={recipeName} onClose={() => setPrinting(null)} />}
    </div>
  );
}
