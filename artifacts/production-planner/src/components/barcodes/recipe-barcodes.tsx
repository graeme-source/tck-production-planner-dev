/**
 * A recipe's barcodes on the recipe page — one card per product the recipe
 * is sold as (its pack listings, its 8-pack bag, its wonky pack). Our table
 * is the source of truth for scanning: a barcode saved here scans on the
 * packing screen within seconds and is the one the pack label prints.
 * Nothing is sent to Shopify; where Shopify's barcode differs (it feeds
 * Google Shopping GTINs) the card says so, with "Use Shopify's".
 *
 * Autosaves with a visible state (charter rule 5). A number another product
 * holds is moved only after the person confirms (MoveConfirmDialog).
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, Barcode, ChevronRight, Info, RefreshCw } from "lucide-react";
import { checkGtin } from "@workspace/barcodes";
import { useAutosave } from "@/hooks/use-autosave";
import { SaveChip } from "@/components/save-chip";
import { cn } from "@/lib/utils";
import { barcodesApi, useInvalidateBarcodes, useRecipeBarcodes, type ApiError, type GroupView } from "./api";
import { MoveConfirmDialog, type PendingMove } from "./move-confirm-dialog";

const inputCls = "h-12 w-full max-w-xs rounded-xl border-2 border-border bg-card px-3 text-lg font-semibold font-mono tracking-wider tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60";

function GroupCard({ group, canEdit }: { group: GroupView; canEdit: boolean }) {
  const invalidate = useInvalidateBarcodes();
  const [text, setText] = useState(group.barcode ?? "");
  const [pending, setPending] = useState<PendingMove | null>(null);
  const [moving, setMoving] = useState(false);
  const [useError, setUseError] = useState<string | null>(null);
  useEffect(() => { setText(group.barcode ?? ""); }, [group.barcode]);

  const put = (code: string, confirm: { confirmMove?: boolean; confirmTake?: boolean } = {}) =>
    barcodesApi(`/recipes/${group.recipeId}/${group.kind}`, { method: "PUT", body: JSON.stringify({ barcode: code, ...confirm }) });

  const auto = useAutosave(async (code: string) => {
    try {
      await put(code);
      await invalidate();
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 409 && err.body?.confirm) {
        setPending({ code, confirm: err.body.confirm, reason: err.message, holders: err.body.holders ?? [], target: group.productName });
        throw new Error("Not saved yet — waiting for you to confirm the move");
      }
      throw err;
    }
  });

  const check = text.trim() === "" ? null : checkGtin(text);
  const onChange = (v: string) => {
    const clean = v.replace(/[^\d ]/g, "").slice(0, 18);
    setText(clean);
    const c = clean.trim() === "" ? null : checkGtin(clean);
    if (c?.ok && c.digits !== group.barcode) auto.schedule(c.digits);
  };

  // One dialog for both ways a code can arrive: typed here, or "Use Shopify's".
  const send = (p: PendingMove, confirm: { confirmMove?: boolean; confirmTake?: boolean }) =>
    p.useShopifyVariant
      ? barcodesApi(`/variants/${p.useShopifyVariant}/use-shopify`, { method: "POST", body: JSON.stringify(confirm) })
      : put(p.code, confirm);

  const confirmMove = async (p: PendingMove) => {
    setMoving(true);
    try {
      await send(p, { confirmMove: true, confirmTake: p.confirm === "take" });
      setPending(null);
      if (!p.useShopifyVariant) auto.discard("saved");
      await invalidate();
    } catch (e) {
      const err = e as ApiError;
      // Moving from an old product can reveal a current one too — ask again.
      if (err.status === 409 && err.body?.confirm === "take") setPending({ ...p, confirm: "take", reason: err.message, holders: err.body.holders ?? [] });
      else { setPending(null); auto.discard(); setUseError(err.message); }
    } finally {
      setMoving(false);
    }
  };

  const useShopify = async (variantId: string, code: string) => {
    setUseError(null);
    try {
      await barcodesApi(`/variants/${variantId}/use-shopify`, { method: "POST", body: JSON.stringify({}) });
      await invalidate();
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 409 && err.body?.confirm) {
        setPending({ code, confirm: err.body.confirm, reason: err.message, holders: err.body.holders ?? [], target: group.productName, useShopifyVariant: variantId });
      } else {
        setUseError(err.message);
      }
    }
  };

  return (
    <div className="rounded-2xl border-2 border-border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-base font-bold flex items-center gap-2"><Barcode className="w-5 h-5 text-[#7cb342]" /> {group.label} barcode</p>
          <p className="text-xs text-muted-foreground">{group.productName}</p>
        </div>
        {canEdit && <SaveChip state={auto.state} error={auto.error} onRetry={() => void auto.flush()} />}
      </div>

      <input
        inputMode="numeric"
        aria-label={`${group.label} barcode`}
        value={text}
        disabled={!canEdit}
        onChange={e => onChange(e.target.value)}
        onBlur={() => void auto.flush()}
        placeholder={group.mixed ? "Listings differ — type the one number" : "e.g. 5065018206009"}
        className={cn(inputCls, check && !check.ok && "border-destructive")}
      />
      {check && !check.ok && <p className="text-sm text-destructive font-semibold">Not saved — {check.reason}.</p>}
      {group.mixed && <p className="text-sm text-amber-700 dark:text-amber-400 font-semibold">These listings hold different barcodes, so none is printed on the label. Type the one number they should all use.</p>}
      {!group.barcode && !group.mixed && !text && <p className="text-sm text-amber-700 dark:text-amber-400">No barcode — the packing screen will ask packers to check this product by eye.</p>}
      {useError && <p className="text-sm text-destructive font-semibold">{useError}</p>}

      <ul className="space-y-2">
        {group.variants.map(v => (
          <li key={v.variantId} className="rounded-xl bg-muted/40 px-3 py-2 text-sm space-y-1">
            <p className="font-medium">{v.name} {!v.current && <span className="ml-1 text-xs text-muted-foreground">(old product)</span>}</p>
            <p className="text-muted-foreground">Scans with: <span className="font-mono text-foreground">{v.barcode ?? "—"}</span></p>
            {v.invalid && <p className="text-amber-700 dark:text-amber-400 flex items-center gap-1"><AlertTriangle className="w-4 h-4" /> Check digit wrong: {v.invalid}</p>}
            {v.heldBack && <p className="text-destructive flex items-start gap-1"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {v.claimed ? <>Our number {v.claimed} isn't used: </> : null}{v.heldBack}</p>}
            {v.differentInShopify && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-amber-700 dark:text-amber-400 flex items-center gap-1"><Info className="w-4 h-4" /> Different in Shopify: <span className="font-mono">{v.shopifyBarcode}</span></span>
                {canEdit && (
                  <button type="button" onClick={() => void useShopify(v.variantId, v.shopifyBarcode ?? "")} className="h-9 px-3 rounded-lg border-2 border-border text-xs font-bold flex items-center gap-1">
                    <RefreshCw className="w-3.5 h-3.5" /> Use Shopify's
                  </button>
                )}
              </div>
            )}
            {v.notInShopify && <p className="text-muted-foreground">This listing isn't in Shopify any more.</p>}
          </li>
        ))}
      </ul>
      <MoveConfirmDialog pending={pending} busy={moving} onConfirm={p => void confirmMove(p)} onCancel={() => { setPending(null); auto.discard(); setText(group.barcode ?? ""); }} />
    </div>
  );
}

export function RecipeBarcodes({ recipeId, active, canEdit }: { recipeId: number; active: boolean; canEdit: boolean }) {
  const q = useRecipeBarcodes(active ? recipeId : null);
  if (!active) return null;
  return (
    <section className="mt-4 border-t border-border pt-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold flex items-center gap-2"><Barcode className="w-4 h-4 text-[#7cb342]" /> Barcodes</h4>
        <Link href="/barcodes" className="text-xs font-semibold text-primary flex items-center gap-1">All barcodes <ChevronRight className="w-3.5 h-3.5" /></Link>
      </div>
      <p className="text-xs text-muted-foreground">Set here — the packing scanner uses it within seconds and the pack label prints it. Shopify isn't changed.</p>
      {q.isLoading && <p className="text-sm text-muted-foreground">Loading barcodes…</p>}
      {q.error && <p className="text-sm text-destructive">Couldn't load barcodes: {(q.error as Error).message}</p>}
      {q.data && q.data.groups.length === 0 && <p className="text-sm text-muted-foreground italic">Link a Shopify listing above to give this recipe a barcode.</p>}
      {q.data?.groups.map(g => <GroupCard key={`${g.kind}`} group={g} canEdit={canEdit} />)}
    </section>
  );
}
