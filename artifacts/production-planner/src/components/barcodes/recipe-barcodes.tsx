/**
 * A recipe's barcodes — one card per product the recipe is sold as (its pack
 * listings, its 8-pack bag, its wonky pack). The SAME cards on the product
 * label page (the main place, at the top) and the recipe page: both edit the
 * one value in the app's table, which the packing scanner uses within
 * seconds and the pack label prints straight away.
 *
 * Shopify, both ways (12 Oct 2026): a save is sent to each Shopify listing
 * by the server, and each listing shows how that went — "Sent to Shopify ✓",
 * "Sending…", "Not sent — reason" with Retry. Where Shopify holds a different
 * number the card shows both, with "Use Shopify's" and "Send ours to
 * Shopify". The Calzone Club Special is managed by hand in Shopify and never
 * synced. A recipe with no Shopify listing yet can still be given its pack
 * barcode: it is held for the product and sent when a listing is linked.
 *
 * Autosaves with a visible state (charter rule 5). A number another product
 * holds is moved only after the person confirms (MoveConfirmDialog).
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, Barcode, Check, ChevronRight, CloudUpload, Hand, Info, Loader2, RefreshCw, Send } from "lucide-react";
import { checkGtin } from "@workspace/barcodes";
import { useAutosave } from "@/hooks/use-autosave";
import { SaveChip } from "@/components/save-chip";
import { cn } from "@/lib/utils";
import { barcodesApi, useInvalidateBarcodes, useRecipeBarcodes, type ApiError, type GroupView, type VariantView } from "./api";
import { MoveConfirmDialog, type PendingMove } from "./move-confirm-dialog";

const inputCls = "h-14 w-full max-w-sm rounded-xl border-2 border-border bg-card px-3 text-xl font-semibold font-mono tracking-wider tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60";
const smallBtn = "h-10 px-3 rounded-lg border-2 border-border text-sm font-bold inline-flex items-center gap-1.5 disabled:opacity-50";
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");

/** How the last send of this listing's barcode to Shopify went. */
function ShopifyLine({ v, canEdit, onRetry, busy }: { v: VariantView; canEdit: boolean; onRetry: () => void; busy: boolean }) {
  if (v.managedByHand) {
    return <p className="flex items-center gap-1.5 text-sky-700 dark:text-sky-400 font-semibold"><Hand className="w-4 h-4" /> Managed by hand in Shopify — never synced</p>;
  }
  if (v.archived) return <p className="text-muted-foreground">Archived in Shopify — never changed from here.</p>;
  const p = v.push;
  if (!p) return null;
  if (p.state === "sending") return <p className="flex items-center gap-1.5 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Sending to Shopify…</p>;
  if (p.state === "sent") {
    return <p className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-semibold"><Check className="w-4 h-4" /> Sent to Shopify ✓ {when(p.at)}</p>;
  }
  if (p.state === "conflict" && v.differentInShopify) return null; // the disagreement block says it
  if (p.state === "skipped") return <p className="text-muted-foreground">{p.message}</p>;
  const waiting = p.state === "waiting";
  return (
    <div className={cn("flex flex-wrap items-center gap-2", waiting ? "text-amber-700 dark:text-amber-400" : "text-destructive")}>
      <span className="flex items-start gap-1.5 font-semibold"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> Not sent{waiting ? " yet" : ""} — {p.message ?? "unknown reason"}</span>
      {canEdit && (
        <button type="button" disabled={busy} onClick={onRetry} className={smallBtn}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Retry
        </button>
      )}
    </div>
  );
}

export function BarcodeGroupCard({ group, canEdit, prominent }: { group: GroupView; canEdit: boolean; prominent?: boolean }) {
  const invalidate = useInvalidateBarcodes();
  const [text, setText] = useState(group.barcode ?? "");
  const [pending, setPending] = useState<PendingMove | null>(null);
  const [moving, setMoving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyVariant, setBusyVariant] = useState<string | null>(null);
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
      else { setPending(null); auto.discard(); setActionError(err.message); }
    } finally {
      setMoving(false);
    }
  };

  const useShopify = async (variantId: string, code: string) => {
    setActionError(null);
    setBusyVariant(variantId);
    try {
      await barcodesApi(`/variants/${variantId}/use-shopify`, { method: "POST", body: JSON.stringify({}) });
      await invalidate();
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 409 && err.body?.confirm) {
        setPending({ code, confirm: err.body.confirm, reason: err.message, holders: err.body.holders ?? [], target: group.productName, useShopifyVariant: variantId });
      } else {
        setActionError(err.message);
      }
    } finally {
      setBusyVariant(null);
    }
  };

  /** "Send ours to Shopify" / "Retry". The result shows on the listing's line. */
  const shopifyAction = async (variantId: string, path: "send-ours" | "retry-push") => {
    setActionError(null);
    setBusyVariant(variantId);
    try {
      await barcodesApi(`/variants/${variantId}/${path}`, { method: "POST", body: JSON.stringify({}) });
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      await invalidate();
      setBusyVariant(null);
    }
  };

  return (
    <div className={cn("rounded-2xl border-2 bg-card p-4 space-y-3", prominent ? "border-primary/40" : "border-border")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className={cn("font-bold flex items-center gap-2", prominent ? "text-lg" : "text-base")}><Barcode className="w-5 h-5 text-[#7cb342]" /> {group.label} barcode</p>
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
        className={cn(inputCls, check && !check.ok && text.replace(/\s+/g, "") !== (group.barcode ?? "") && "border-destructive")}
      />
      {/* Only for a number someone has typed — never for the saved one. */}
      {check && !check.ok && text.replace(/\s+/g, "") !== (group.barcode ?? "") && <p className="text-sm text-destructive font-semibold">Not saved — {check.reason}.</p>}
      {group.mixed && <p className="text-sm text-amber-700 dark:text-amber-400 font-semibold">These listings hold different barcodes, so none is printed on the label. Type the one number they should all use.</p>}
      {!group.barcode && !group.mixed && !text && <p className="text-sm text-amber-700 dark:text-amber-400">No barcode — the label can't go live and the packing screen will ask packers to check this product by eye.</p>}
      {group.heldProblem && <p className="text-sm text-destructive font-semibold flex items-start gap-1"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {group.heldProblem}</p>}
      {actionError && <p className="text-sm text-destructive font-semibold">{actionError}</p>}

      {group.pending ? (
        <p className="rounded-xl bg-muted/40 px-3 py-2 text-sm flex items-start gap-2">
          <CloudUpload className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
          <span>
            <b>No Shopify listing yet</b> — {group.barcode ? "it's on the label now and will be sent to Shopify when a listing is linked on the recipe page." : "you can still set it: it goes on the label now and is sent to Shopify when a listing is linked."}
            {group.heldSetByName && group.barcode && <span className="text-muted-foreground"> Set by {group.heldSetByName}{group.heldSetAt ? `, ${when(group.heldSetAt)}` : ""}.</span>}
          </span>
        </p>
      ) : (
        <ul className="space-y-2">
          {group.variants.map(v => (
            <li key={v.variantId} className="rounded-xl bg-muted/40 px-3 py-2 text-sm space-y-1.5">
              <p className="font-medium">{v.name} {!v.current && <span className="ml-1 text-xs text-muted-foreground">(old product)</span>}</p>
              <p className="text-muted-foreground">Scans with: <span className="font-mono text-foreground">{v.barcode ?? "—"}</span></p>
              {v.invalid && <p className="text-amber-700 dark:text-amber-400 flex items-center gap-1"><AlertTriangle className="w-4 h-4" /> Check digit wrong: {v.invalid}</p>}
              {v.heldBack && <p className="text-destructive flex items-start gap-1"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {v.claimed ? <>Our number {v.claimed} isn't used: </> : null}{v.heldBack}</p>}
              {v.differentInShopify ? (
                <div className="rounded-lg border-2 border-amber-400 bg-amber-50 dark:bg-amber-950/30 p-2 space-y-2">
                  <p className="text-amber-800 dark:text-amber-300 flex items-start gap-1 font-semibold">
                    <Info className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>Shopify and the app disagree — Shopify: <span className="font-mono">{v.shopifyBarcode}</span>, app: <span className="font-mono">{v.claimed ?? v.barcode ?? "none"}</span>. Neither is changed until you choose.</span>
                  </p>
                  {canEdit && (
                    <div className="flex flex-wrap gap-2">
                      <button type="button" disabled={busyVariant === v.variantId} onClick={() => void useShopify(v.variantId, v.shopifyBarcode ?? "")} className={cn(smallBtn, "bg-card")}>
                        <RefreshCw className="w-4 h-4" /> Use Shopify's
                      </button>
                      {(v.barcode ?? group.barcode) && (
                        <button type="button" disabled={busyVariant === v.variantId} onClick={() => void shopifyAction(v.variantId, "send-ours")} className={cn(smallBtn, "bg-card")}>
                          {busyVariant === v.variantId ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send ours to Shopify
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ) : null}
              <ShopifyLine v={v} canEdit={canEdit} busy={busyVariant === v.variantId} onRetry={() => void shopifyAction(v.variantId, "retry-push")} />
              {v.notInShopify && <p className="text-muted-foreground">This listing isn't in Shopify any more.</p>}
            </li>
          ))}
        </ul>
      )}
      <MoveConfirmDialog pending={pending} busy={moving} onConfirm={p => void confirmMove(p)} onCancel={() => { setPending(null); auto.discard(); setText(group.barcode ?? ""); }} />
    </div>
  );
}

/**
 * The barcode cards for one recipe. `prominent` = the product label page,
 * where setting the barcode is part of making the label (shown near the top,
 * bigger); otherwise the compact section on the recipe page.
 */
export function RecipeBarcodes({ recipeId, active, canEdit, prominent = false }: { recipeId: number; active: boolean; canEdit: boolean; prominent?: boolean }) {
  const q = useRecipeBarcodes(active ? recipeId : null);
  if (!active) return null;
  return (
    <section className={prominent ? "rounded-2xl border-2 border-border bg-card p-5 space-y-3" : "mt-4 border-t border-border pt-4 space-y-3"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {prominent
          ? <h2 className="text-xl font-bold flex items-center gap-2"><Barcode className="w-6 h-6 text-[#7cb342]" /> Barcode</h2>
          : <h4 className="text-sm font-semibold flex items-center gap-2"><Barcode className="w-4 h-4 text-[#7cb342]" /> Barcodes</h4>}
        <Link href="/barcodes" className="text-sm font-semibold text-primary flex items-center gap-1">All barcodes <ChevronRight className="w-4 h-4" /></Link>
      </div>
      <p className={cn("text-muted-foreground", prominent ? "text-sm" : "text-xs")}>
        One number for the label, the packing scanner and Shopify. Set it here {prominent ? "or on the recipe page" : "or on the product label page"} — it's the same number. It prints on the label straight away and is sent to Shopify.
      </p>
      {!canEdit && <p className="text-sm text-muted-foreground">View only — managers can change it.</p>}
      {q.isLoading && <p className="text-sm text-muted-foreground">Loading barcodes…</p>}
      {q.error && <p className="text-sm text-destructive">Couldn't load barcodes: {(q.error as Error).message}</p>}
      {q.data?.groups.map(g => <BarcodeGroupCard key={`${g.kind}:${g.pending ? "held" : "linked"}`} group={g} canEdit={canEdit} prominent={prominent} />)}
    </section>
  );
}
