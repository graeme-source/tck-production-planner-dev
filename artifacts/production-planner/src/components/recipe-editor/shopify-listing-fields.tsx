/**
 * The recipe's Shopify listing — description + product photo — on the
 * recipe editor's Details tab, under "Name and description" (Graeme, 30 Oct
 * 2026: "split those two items in the recipe section first, so I can review
 * them there before we publish to Shopify"). Objective A.
 *
 *   - Shopify listing description: the paragraph or two on the product page
 *     (the product's description), separate from the recipe description
 *     above it (the short line → custom.product_recipe). AUTOSAVES with a
 *     visible save state (hooks/use-autosave), independent of the editor's
 *     Save button. "Draft with AI" writes one from the recipe; Graeme reads
 *     and edits it, and can put the old text back.
 *   - Product photo: one per recipe, at least 1000 × 750 — checked here
 *     from the file's own header before uploading (and again on the server).
 *     Saved the moment it's chosen; replace or remove any time.
 *
 * These render inside the editor's <form>, so every button is type="button".
 * API: routes/recipe-shopify-product.ts. "Create Shopify product" is on the
 * More tab (shopify-product-create.tsx).
 */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ImagePlus, Loader2, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import { PRODUCT_PHOTO_MIN_HEIGHT, PRODUCT_PHOTO_MIN_WIDTH, productPhotoProblem, readImageInfo } from "@workspace/product-labels";
import { cn } from "@/lib/utils";
import { useAutosave } from "@/hooks/use-autosave";
import { SaveChip } from "@/components/save-chip";
import { EDITOR_INPUT, EditorField } from "./editor-shell";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface ListingState {
  listingDescription: string;
  photo: { width: number; height: number; byteSize: number; mimeType: string; filename: string | null; uploadedAt: string; uploadedByName: string | null } | null;
}

export const listingKey = (recipeId: number) => ["recipe-shopify-listing", recipeId] as const;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api/recipes${path}`, {
    credentials: "include",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  const body = await res.json().catch(() => ({})) as { error?: string; details?: { fieldErrors?: Record<string, string[]> } };
  if (!res.ok) {
    const field = body.details?.fieldErrors ? Object.values(body.details.fieldErrors)[0]?.[0] : undefined;
    throw new Error(field ?? body.error ?? `HTTP ${res.status}`);
  }
  return body as T;
}

export function ShopifyListingFields({ recipeId, canEdit }: { recipeId: number; canEdit: boolean }) {
  const listing = useQuery({ queryKey: listingKey(recipeId), queryFn: () => api<ListingState>(`/${recipeId}/shopify-listing`) });

  return (
    <>
      <EditorField
        label="Shopify listing description — the product page"
        className="md:col-span-2"
        hint="A paragraph or two about the recipe and why it's special — the description on its Shopify product page. 'Create Shopify product' (More tab) uses it and won't run without it. Saves as you type."
      >
        {listing.isLoading ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2 min-h-11"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</p>
        ) : listing.error ? (
          <p className="text-sm text-destructive flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> {(listing.error as Error).message}</p>
        ) : (
          <ListingDescription recipeId={recipeId} initial={listing.data?.listingDescription ?? ""} canEdit={canEdit} />
        )}
      </EditorField>
      <EditorField
        label="Product photo — for Shopify"
        className="md:col-span-2"
        hint={`One photo of the finished product, at least ${PRODUCT_PHOTO_MIN_WIDTH} × ${PRODUCT_PHOTO_MIN_HEIGHT} pixels (JPEG, PNG or WebP). It goes on the product when it's made in Shopify. Saved as soon as you choose it.`}
      >
        {listing.data && <ProductPhoto recipeId={recipeId} photo={listing.data.photo} canEdit={canEdit} />}
      </EditorField>
    </>
  );
}

function ListingDescription({ recipeId, initial, canEdit }: { recipeId: number; initial: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const [value, setValue] = useState(initial);
  const [previous, setPrevious] = useState<string | null>(null);
  const [cautions, setCautions] = useState<string[]>([]);
  const auto = useAutosave(async (next: string) => {
    const saved = await api<{ listingDescription: string }>(`/${recipeId}/shopify-listing`, {
      method: "PUT", body: JSON.stringify({ listingDescription: next.trim() === "" ? null : next }),
    });
    qc.setQueryData<ListingState>(listingKey(recipeId), old => (old ? { ...old, listingDescription: saved.listingDescription } : old));
    void qc.invalidateQueries({ queryKey: ["recipe-shopify-product", recipeId] });
  });

  const draft = useMutation({
    mutationFn: () => api<{ text: string; cautions: string[] }>(`/${recipeId}/shopify-listing/draft`, { method: "POST", body: "{}" }),
    onSuccess: r => {
      setPrevious(value);
      setValue(r.text);
      setCautions(r.cautions);
      auto.schedule(r.text);
      void auto.flush();
    },
  });

  const change = (next: string) => { setValue(next); auto.schedule(next); };

  return (
    <div className="space-y-2">
      <textarea
        value={value}
        onChange={e => change(e.target.value)}
        onBlur={() => void auto.flush()}
        readOnly={!canEdit}
        aria-label="Shopify listing description"
        maxLength={5000}
        className={cn(EDITOR_INPUT, "min-h-[140px] resize-y leading-relaxed", auto.state === "error" && "border-destructive")}
        placeholder={canEdit ? "e.g. We developed this one for the colder months: tender chicken thigh in a creamy tarragon sauce with sweet leeks…" : "No listing description yet"}
      />
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => draft.mutate()}
            disabled={draft.isPending}
            className="min-h-11 px-4 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-50 inline-flex items-center gap-2"
          >
            {draft.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {draft.isPending ? "Writing…" : value.trim() ? "Draft again with AI" : "Draft with AI"}
          </button>
          {previous != null && !draft.isPending && (
            <button
              type="button"
              onClick={() => { const back = previous; setPrevious(null); setCautions([]); change(back); void auto.flush(); }}
              className="min-h-11 px-4 rounded-xl border border-border text-sm font-semibold hover:bg-secondary inline-flex items-center gap-2"
            >
              <RotateCcw className="w-4 h-4" /> Put the old text back
            </button>
          )}
          <span className="flex-1" />
          <SaveChip state={auto.state} error={auto.error} onRetry={() => void auto.flush()} />
        </div>
      )}
      {draft.error && <p className="text-sm text-destructive flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> {(draft.error as Error).message}</p>}
      {previous != null && (
        <p className="text-sm text-muted-foreground">Written by AI from this recipe's name, description, ingredients and tags — read it through and change anything that isn't right before making the product.</p>
      )}
      {cautions.length > 0 && (
        <div className="rounded-xl p-3 text-sm flex items-start gap-2 bg-amber-500/10 text-amber-900 dark:text-amber-200 border border-amber-500/40">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>Check these — the recipe doesn't say so: <b>{cautions.join(", ")}</b>. Take them out unless they're true.</span>
        </div>
      )}
    </div>
  );
}

function readAsBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => reject(new Error("Couldn't read that file"));
    r.readAsDataURL(file);
  });
}

function ProductPhoto({ recipeId, photo, canEdit }: { recipeId: number; photo: ListingState["photo"]; canEdit: boolean }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (!saved) return; const t = setTimeout(() => setSaved(false), 4000); return () => clearTimeout(t); }, [saved]);

  const onSaved = (s: ListingState) => {
    qc.setQueryData(listingKey(recipeId), s);
    void qc.invalidateQueries({ queryKey: ["recipe-shopify-product", recipeId] });
    setSaved(true);
  };
  const upload = useMutation({
    mutationFn: async (file: File) => api<ListingState>(`/${recipeId}/product-photo`, {
      method: "PUT", body: JSON.stringify({ dataBase64: await readAsBase64(file), filename: file.name }),
    }),
    onSuccess: onSaved,
  });
  const remove = useMutation({
    mutationFn: () => api<ListingState>(`/${recipeId}/product-photo`, { method: "DELETE" }),
    onSuccess: s => { setConfirmRemove(false); onSaved(s); },
  });

  async function choose(file: File | undefined) {
    if (!file) return;
    setProblem(null);
    upload.reset();
    // The same check as the server, from the file's own header.
    const info = readImageInfo(new Uint8Array(await file.arrayBuffer()));
    const why = info
      ? productPhotoProblem({ width: info.width, height: info.height, bytes: file.size, mime: info.mime })
      : "That file isn't a JPEG, PNG or WebP photo we can read — save it as a JPEG and try again.";
    if (why) { setProblem(why); return; }
    upload.mutate(file);
  }

  const busy = upload.isPending || remove.isPending;
  return (
    <div className="flex flex-col sm:flex-row gap-4 items-start rounded-xl border border-border bg-card p-3">
      {photo ? (
        <img
          src={`${BASE}/api/recipes/${recipeId}/product-photo?v=${encodeURIComponent(photo.uploadedAt)}`}
          alt="Product photo"
          className="w-full sm:w-64 aspect-[4/3] object-cover rounded-lg border border-border bg-secondary"
        />
      ) : (
        <div className="w-full sm:w-64 aspect-[4/3] rounded-lg border-2 border-dashed border-border flex items-center justify-center text-sm text-muted-foreground text-center p-3">
          No photo yet
        </div>
      )}
      <div className="flex-1 min-w-0 space-y-2">
        {photo && (
          <p className="text-sm">
            <b>{photo.width} × {photo.height}</b> · {(photo.byteSize / 1024 / 1024).toFixed(1)} MB
            <span className="text-muted-foreground"> · added {new Date(photo.uploadedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}{photo.uploadedByName ? ` by ${photo.uploadedByName}` : ""}</span>
          </p>
        )}
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={e => { void choose(e.target.files?.[0]); e.target.value = ""; }} />
            <button type="button" onClick={() => input.current?.click()} disabled={busy}
              className="min-h-11 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50 inline-flex items-center gap-2">
              {upload.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
              {upload.isPending ? "Uploading…" : photo ? "Replace photo" : "Upload photo"}
            </button>
            {photo && !confirmRemove && (
              <button type="button" onClick={() => setConfirmRemove(true)} disabled={busy}
                className="min-h-11 px-4 rounded-xl border border-border text-sm font-semibold hover:bg-secondary inline-flex items-center gap-2 disabled:opacity-50">
                <Trash2 className="w-4 h-4" /> Remove
              </button>
            )}
            {confirmRemove && (
              <span className="inline-flex items-center gap-2 text-sm">
                Remove the photo?
                <button type="button" onClick={() => remove.mutate()} disabled={busy} className="min-h-11 px-4 rounded-xl bg-destructive text-destructive-foreground font-semibold disabled:opacity-50">
                  {remove.isPending ? "Removing…" : "Yes, remove"}
                </button>
                <button type="button" onClick={() => setConfirmRemove(false)} className="min-h-11 px-4 rounded-xl border border-border font-semibold">Keep it</button>
              </span>
            )}
            {saved && <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">Saved</span>}
          </div>
        )}
        {problem && <p className="text-sm text-destructive flex items-start gap-2"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {problem}</p>}
        {upload.error && <p className="text-sm text-destructive flex items-start gap-2"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> Not saved: {(upload.error as Error).message}</p>}
        {remove.error && <p className="text-sm text-destructive flex items-start gap-2"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> Not removed: {(remove.error as Error).message}</p>}
      </div>
    </div>
  );
}
