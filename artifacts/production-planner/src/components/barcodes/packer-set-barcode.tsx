/**
 * Packing bench: a product with NO barcode (Graeme, 12 Oct 2026).
 *
 * With Settings → "Allow manual tap to pick" off, a no-barcode line can't be
 * ticked by hand any more. Instead the packer:
 *   1. checks by eye that the pack is definitely that product,
 *   2. scans the barcode printed on it,
 *   3. confirms "Set this as the barcode for <product>?" —
 * which saves it in our table (never Shopify) as set by them, and the line
 * ticks as scanned. Refused when the number belongs to another product
 * (fetch a manager), or when the product already has one (changing a
 * barcode is manager-only). Rules: @workspace/barcodes packer.ts; server:
 * POST /api/barcodes/variants/:id/packer-set.
 *
 * When the number belongs to another product, a manager or admin can say
 * this listing IS that product's pack (Graeme, 28 Oct 2026: "Fried Chicken
 * 400g + rice" is the plain 400g pack — a flow adds the rice), so it shares
 * the barcode: POST /variants/:id/packer-share.
 */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft, Barcode, Eye, Link2, Loader2, X } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { checkGtin, gtinKey, type KnownCodes } from "@workspace/barcodes";
import { barcodesApi, SCAN_MAP_KEY, type ApiError } from "./api";

/** The amber card under a no-barcode line. */
export function NoBarcodePanel({ name, canSet, onStart }: { name: string; canSet: boolean; onStart: () => void }) {
  return (
    <div className="-mt-1 rounded-b-xl border-2 border-t-0 border-amber-400 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-700 px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="flex-1 min-w-0">
        <p className="font-bold text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
          <AlertCircle className="w-5 h-5 flex-shrink-0" /> No barcode on this product yet
        </p>
        <p className="text-sm text-amber-900/80 dark:text-amber-200/80 mt-0.5">
          {canSet
            ? <>It can't be ticked by hand. Check the pack by eye, then scan its barcode to set it for {name}.</>
            : <>This line isn't linked to a Shopify product, so it can't be given a barcode here. Please fetch a manager.</>}
        </p>
      </div>
      {canSet && (
        <button
          type="button"
          onClick={onStart}
          className="min-h-[52px] px-5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-lg flex items-center justify-center gap-2 flex-shrink-0"
        >
          <Barcode className="w-5 h-5" /> Set its barcode
        </button>
      )}
    </div>
  );
}

type Step = "eye" | "scan" | "confirm";

export interface SetBarcodeTarget {
  variantId: string;
  name: string;
  imageUrl: string | null;
}

export function SetBarcodeDialog({
  target, known, onClose, onSet,
}: {
  target: SetBarcodeTarget;
  /** The live scan map's known codes — an early, friendly "belongs to …". The server checks again. */
  known: KnownCodes;
  onClose: () => void;
  /** Saved — tick the line as scanned (and close). */
  onSet: (barcode: string) => void;
}) {
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>("eye");
  const [code, setCode] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  /** The product that already has the scanned number — a manager can say
   *  this listing is the same pack and share it. */
  const [heldBy, setHeldBy] = useState<{ code: string; name: string } | null>(null);
  const { state } = useAuth();
  const role = state.status === "authenticated" ? state.user.role : null;
  const canShare = role === "admin" || role === "manager";
  const scanRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === "scan") requestAnimationFrame(() => scanRef.current?.focus());
  }, [step]);

  const save = useMutation({
    mutationFn: (barcode: string) => barcodesApi<{ barcode: string; name: string }>(`/variants/${target.variantId}/packer-set`, {
      method: "POST",
      body: JSON.stringify({ barcode, productName: target.name }),
    }),
    onSuccess: async (r) => {
      // The new code must be in the live map before anything else scans.
      await qc.refetchQueries({ queryKey: SCAN_MAP_KEY });
      onSet(r.barcode);
    },
    onError: (err: ApiError, barcode) => {
      setProblem(err.message);
      // A number that's someone else's, or a product that already has one:
      // nothing the packer can fix here.
      setBlocked(err.status === 409);
      const product = (err.body as { why?: string; product?: string } | undefined);
      if (product?.why === "elsewhere" && product.product) setHeldBy({ code: barcode, name: product.product });
    },
  });

  const share = useMutation({
    mutationFn: (barcode: string) => barcodesApi<{ barcode: string; name: string }>(`/variants/${target.variantId}/packer-share`, {
      method: "POST",
      body: JSON.stringify({ barcode, productName: target.name }),
    }),
    onSuccess: async (r) => {
      await qc.refetchQueries({ queryKey: SCAN_MAP_KEY });
      onSet(r.barcode);
    },
    onError: (err: ApiError) => setProblem(err.message),
  });

  function handleScan(e: React.FormEvent) {
    e.preventDefault();
    // Uncontrolled field, read from the DOM — a hardware scanner types the
    // whole number in a few milliseconds (see the main scan field).
    const raw = scanRef.current?.value ?? "";
    if (scanRef.current) scanRef.current.value = "";
    setBlocked(false);
    setHeldBy(null);
    const g = checkGtin(raw);
    if (!g.ok) {
      setProblem(g.reason === "No barcode number" ? "Scan the barcode on the pack." : `That isn't a valid barcode: ${g.reason}. Scan it again.`);
      return;
    }
    const owner = known[gtinKey(g.digits)];
    if (owner) {
      setProblem(`${g.digits} is already the barcode of ${owner.name}, not ${target.name}. Don't pack it — check the pack and fetch a manager.`);
      setBlocked(true);
      setHeldBy({ code: g.digits, name: owner.name });
      return;
    }
    setProblem(null);
    setCode(g.digits);
    setStep("confirm");
  }

  const close = () => { if (!save.isPending) onClose(); };

  return (
    <div className="fixed inset-0 z-[80] bg-black/50 flex items-center justify-center p-3 sm:p-6" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="set-barcode-title"
        className="bg-background rounded-3xl shadow-2xl w-full max-w-xl max-h-[92dvh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 px-5 pt-5 pb-3 border-b border-border">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">No barcode on this product yet</p>
            <h2 id="set-barcode-title" className="text-2xl font-bold leading-tight mt-0.5">{target.name}</h2>
          </div>
          <button type="button" onClick={close} aria-label="Close" className="w-11 h-11 rounded-full hover:bg-secondary flex items-center justify-center flex-shrink-0">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <ol className="flex gap-2 text-sm font-semibold">
            {(["eye", "scan", "confirm"] as const).map((s, i) => {
              const active = step === s;
              return (
                <li key={s} className={`flex-1 rounded-full px-3 py-1.5 text-center ${active ? "bg-amber-500 text-white" : "bg-secondary text-muted-foreground"}`}>
                  {i + 1}. {s === "eye" ? "Check" : s === "scan" ? "Scan" : "Confirm"}
                </li>
              );
            })}
          </ol>

          {target.imageUrl && (
            <img src={target.imageUrl} alt="" className="w-28 h-28 rounded-2xl object-cover bg-secondary mx-auto" />
          )}

          {step === "eye" && (
            <div className="rounded-2xl border-2 border-border p-4 space-y-2">
              <p className="text-xl font-bold flex items-center gap-2"><Eye className="w-6 h-6 text-amber-600" /> Check by eye</p>
              <p className="text-lg">Check by eye that this is definitely <span className="font-bold">{target.name}</span>.</p>
              <p className="text-sm text-muted-foreground">Read the name and pack size on the label. If you're not certain, stop and fetch a manager.</p>
            </div>
          )}

          {step === "scan" && (
            <form onSubmit={handleScan} className="rounded-2xl border-2 border-border p-4 space-y-3">
              <p className="text-xl font-bold flex items-center gap-2"><Barcode className="w-6 h-6 text-amber-600" /> Scan the barcode on the pack</p>
              <input
                ref={scanRef}
                inputMode="numeric"
                autoComplete="off"
                placeholder="Scan now, or type the number and press Enter"
                className="w-full min-h-[56px] px-4 rounded-xl border-2 border-amber-400 bg-background text-xl font-mono focus:outline-none focus:ring-2 focus:ring-amber-500"
                aria-label="Barcode on the pack"
              />
            </form>
          )}

          {step === "confirm" && code && (
            <div className="rounded-2xl border-2 border-amber-400 bg-amber-50 dark:bg-amber-950/40 p-4 space-y-2">
              <p className="text-sm text-muted-foreground">Scanned</p>
              <p className="text-3xl font-mono font-bold tracking-wider">{code}</p>
              <p className="text-xl">Set this as the barcode for <span className="font-bold">{target.name}</span>?</p>
            </div>
          )}

          {heldBy && canShare && (
            <div className="rounded-2xl border-2 border-primary/40 bg-primary/5 p-4 space-y-3">
              <p className="text-lg">
                <span className="font-bold">Manager:</span> is <span className="font-bold">{target.name}</span> really the same pack as <span className="font-bold">{heldBy.name}</span> (with extras added another way)?
              </p>
              <p className="text-sm text-muted-foreground">Then they share barcode {heldBy.code}: scanning it ticks either one. Only do this if the pack in hand is identical.</p>
              <button
                type="button"
                disabled={share.isPending}
                onClick={() => { setProblem(null); share.mutate(heldBy.code); }}
                className="w-full min-h-[56px] rounded-xl bg-primary text-primary-foreground font-bold text-lg flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {share.isPending ? <><Loader2 className="w-5 h-5 animate-spin" /> Saving…</> : <><Link2 className="w-5 h-5" /> Same pack — share {heldBy.name}'s barcode</>}
              </button>
            </div>
          )}

          {problem && (
            <div role="alert" className="rounded-2xl border-2 border-red-400 bg-red-50 dark:bg-red-950/40 p-4 text-red-900 dark:text-red-200 text-lg font-semibold flex gap-2">
              <AlertCircle className="w-6 h-6 flex-shrink-0 mt-0.5" /> {problem}
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-border flex gap-3">
          {step === "eye" && (
            <>
              <button type="button" onClick={close} className="min-h-[56px] px-5 rounded-xl border-2 border-border font-semibold text-lg">Cancel</button>
              <button type="button" onClick={() => setStep("scan")} className="flex-1 min-h-[56px] rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-lg">
                Yes, it's definitely this product
              </button>
            </>
          )}
          {step === "scan" && (
            <>
              <button type="button" onClick={() => { setProblem(null); setBlocked(false); setHeldBy(null); setStep("eye"); }} className="min-h-[56px] px-5 rounded-xl border-2 border-border font-semibold text-lg flex items-center gap-1.5">
                <ArrowLeft className="w-5 h-5" /> Back
              </button>
              <button type="button" onClick={close} className="flex-1 min-h-[56px] rounded-xl border-2 border-border font-semibold text-lg">Cancel</button>
            </>
          )}
          {step === "confirm" && (
            <>
              <button type="button" onClick={close} disabled={save.isPending} className="min-h-[56px] px-5 rounded-xl border-2 border-border font-semibold text-lg disabled:opacity-40">Cancel</button>
              {!blocked && (
                <button
                  type="button"
                  disabled={save.isPending}
                  onClick={() => { setProblem(null); if (code) save.mutate(code); }}
                  className="flex-1 min-h-[56px] rounded-xl bg-primary text-primary-foreground font-bold text-lg flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {save.isPending ? <><Loader2 className="w-5 h-5 animate-spin" /> Saving…</> : "Yes, set it"}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
