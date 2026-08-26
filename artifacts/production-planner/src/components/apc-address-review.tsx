/**
 * One order whose address doesn't fit an APC label — and the means to fix it.
 *
 * The question at the bench is always the same: *what won't be on the label?*
 * That used to be a sentence of amber prose in a small font, with the lost
 * text quoted somewhere in the middle of it, which made the single most
 * important fact the hardest thing on screen to find (Graeme, 2026-08-26).
 *
 * So this shows three things, in the order they get asked:
 *   1. what the customer typed,
 *   2. what the label will carry,
 *   3. what is being dropped — on its own, in the largest type here.
 *
 * And then it lets the operator do something about it. Some losses are fine
 * (a county the postcode already carries); some are a failed delivery ("Van
 * 313 The Lawns" is the pitch number). Only a person looking at the order can
 * tell, so the fix is a manual re-cut of the address rather than a cleverer
 * parser. The correction applies to the LABEL only — the Shopify order is
 * never touched.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Ban, Check, Loader2, Pencil, RotateCcw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { OrderNumber } from "@/components/order-number";
import { toast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

/** APC's per-line limit. Mirrors ADDRESS_LINE_MAX on the server, which is the
 *  authority — the server re-cuts anything longer, so the two agreeing is what
 *  keeps "what you approved" and "what gets printed" the same thing. */
export const ADDRESS_LINE_MAX = 35;

export interface PreflightAddress {
  original: { address1: string; address2: string | null; city: string; postcode: string; company: string | null };
  label: { address1: string; address2: string | null; city: string; postcode: string };
  dropped: string[];
  corrected: boolean;
  correctedBy?: string;
}

export interface AddressReviewFlag {
  kind: "conflicting-postcode" | "town-too-long" | "truncated" | "county-removed";
  message: string;
  dropped?: string;
  severity: "critical" | "check";
}

/** A line of an address, with the character budget shown live. Counting up to
 *  the limit as you type is the whole point: the operator is solving a fitting
 *  problem, and hiding the constraint until save turns it into guesswork. */
function AddressField({ label, value, onChange, max = ADDRESS_LINE_MAX, placeholder, autoFocus }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  max?: number;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const over = value.length > max;
  // Proportional, not a fixed margin: "5 characters left" is nearly full on a
  // 35-character address line but perfectly normal on a 12-character
  // postcode, and an amber count on every postcode teaches people to ignore
  // the colour on the lines where it matters.
  const tight = !over && value.length > max * 0.85;
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-2 mb-1">
        <span className="text-sm font-semibold text-muted-foreground">{label}</span>
        <span className={cn(
          "text-sm tabular-nums font-medium",
          over ? "text-destructive" : tight ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
        )}>
          {value.length}/{max}
        </span>
      </span>
      <input
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        className={cn(
          // Large targets and 16px+ text: this is used on an iPad at the
          // bench, and anything smaller than this is a squint.
          "w-full px-3 py-2.5 rounded-xl border-2 bg-background text-base font-mono",
          "focus:outline-none focus:ring-2 focus:ring-primary/40",
          over ? "border-destructive" : "border-border focus:border-primary",
        )}
      />
    </label>
  );
}

/** The address as it will be printed. Mono, one line per line, so it reads
 *  like the label rather than like a paragraph. */
function AddressBlock({ lines, tone = "plain" }: { lines: Array<string | null>; tone?: "plain" | "label" }) {
  const shown = lines.filter((l): l is string => !!l && l.trim() !== "");
  return (
    <div className={cn(
      "font-mono text-base leading-relaxed rounded-xl px-3.5 py-2.5 border",
      tone === "label"
        ? "border-primary/30 bg-primary/5"
        : "border-border bg-secondary/40",
    )}>
      {shown.length === 0
        ? <span className="text-muted-foreground italic">Nothing</span>
        : shown.map((l, i) => <div key={i}>{l}</div>)}
    </div>
  );
}

export function AddressReviewCard({ orderId, orderName, customerName, address, flags, adminBase, onSaved }: {
  orderId: number;
  orderName: string;
  customerName: string;
  address: PreflightAddress;
  flags: AddressReviewFlag[];
  adminBase?: string;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const queryClient = useQueryClient();

  const [a1, setA1] = useState(address.label.address1);
  const [a2, setA2] = useState(address.label.address2 ?? "");
  const [city, setCity] = useState(address.label.city);
  const [postcode, setPostcode] = useState(address.label.postcode);

  const worstSeverity = flags.some(f => f.severity === "critical") ? "critical" : "check";
  const dropped = address.dropped.filter(Boolean);
  const conflicts = flags.filter(f => f.kind === "conflicting-postcode");

  const tooLong = a1.length > ADDRESS_LINE_MAX || a2.length > ADDRESS_LINE_MAX || city.length > ADDRESS_LINE_MAX;
  const canSave = a1.trim() !== "" && city.trim() !== "" && postcode.trim() !== "" && !tooLong;

  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}/api/fulfilment/label-address/${orderId}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address1: a1.trim(),
          address2: a2.trim() || undefined,
          city: city.trim(),
          postcode: postcode.trim(),
          orderName,
          originalAddress1: address.original.address1,
          originalAddress2: address.original.address2 ?? undefined,
          originalCity: address.original.city,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not save the address");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["apc-batch-preflight"] });
      toast({ title: `${orderName} address updated`, description: "The label will use your version." });
      setEditing(false);
      onSaved();
    },
    onError: err => toast({
      title: "Could not save the address",
      description: err instanceof Error ? err.message : "Request failed",
      variant: "destructive",
    }),
  });

  const revert = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}/api/fulfilment/label-address/${orderId}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not undo the change");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["apc-batch-preflight"] });
      toast({ title: `${orderName} back to the automatic address` });
      onSaved();
    },
    onError: err => toast({
      title: "Could not undo the change",
      description: err instanceof Error ? err.message : "Request failed",
      variant: "destructive",
    }),
  });

  return (
    <div className={cn(
      "rounded-2xl border-2 p-4 space-y-3.5",
      address.corrected
        ? "border-green-300 dark:border-green-800 bg-green-50/60 dark:bg-green-950/20"
        : worstSeverity === "critical"
          ? "border-red-300 dark:border-red-800 bg-red-50/60 dark:bg-red-950/20"
          : "border-amber-300 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20",
    )}>
      <div className="flex items-center gap-3 flex-wrap">
        <OrderNumber
          orderId={orderId}
          name={orderName}
          adminBase={adminBase}
          className="font-mono text-lg font-bold"
        />
        <span className="text-lg text-muted-foreground flex-1 min-w-0 truncate">{customerName}</span>
        {address.corrected && (
          <span className="flex items-center gap-1.5 text-sm font-semibold text-green-700 dark:text-green-300">
            <Check className="w-4 h-4" />
            Address fixed{address.correctedBy ? ` by ${address.correctedBy}` : ""}
          </span>
        )}
      </div>

      {/* The headline: what is being lost. Given its own block, in the biggest
          type on the card, because it is the only thing the operator has to
          make a judgement about. */}
      {!address.corrected && dropped.length > 0 && (
        <div className={cn(
          "rounded-xl px-3.5 py-3 border-2",
          worstSeverity === "critical"
            ? "border-red-400 dark:border-red-700 bg-red-100/70 dark:bg-red-950/40"
            : "border-amber-400 dark:border-amber-700 bg-amber-100/70 dark:bg-amber-950/40",
        )}>
          <p className={cn(
            "text-sm font-bold uppercase tracking-wide flex items-center gap-2 mb-1.5",
            worstSeverity === "critical" ? "text-red-800 dark:text-red-300" : "text-amber-800 dark:text-amber-300",
          )}>
            <Ban className="w-4 h-4" /> Won't be on the label
          </p>
          {dropped.map((d, i) => (
            <p key={i} className={cn(
              "font-mono text-xl font-bold break-words",
              worstSeverity === "critical" ? "text-red-900 dark:text-red-200" : "text-amber-900 dark:text-amber-200",
            )}>
              {d}
            </p>
          ))}
          <p className={cn(
            "text-sm mt-1.5",
            worstSeverity === "critical" ? "text-red-800/90 dark:text-red-300/90" : "text-amber-800/90 dark:text-amber-300/90",
          )}>
            {worstSeverity === "critical"
              ? "This looks like it identifies the building — without it the driver may not find the address."
              : "This looks like a place name the postcode already covers, so it is probably safe to lose."}
          </p>
        </div>
      )}

      {/* A postcode that disagrees with the order's own is a different problem
          from a line that won't fit, and no amount of re-cutting solves it. */}
      {!address.corrected && conflicts.map((f, i) => (
        <div key={i} className="rounded-xl px-3.5 py-3 border-2 border-red-400 dark:border-red-700 bg-red-100/70 dark:bg-red-950/40">
          <p className="text-sm font-bold uppercase tracking-wide flex items-center gap-2 mb-1 text-red-800 dark:text-red-300">
            <AlertTriangle className="w-4 h-4" /> Two different postcodes
          </p>
          <p className="text-base text-red-900 dark:text-red-200">{f.message}</p>
        </div>
      ))}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-sm font-semibold text-muted-foreground mb-1.5">What the customer entered</p>
          <AddressBlock lines={[
            address.original.company,
            address.original.address1,
            address.original.address2,
            address.original.city,
            address.original.postcode,
          ]} />
        </div>
        <div>
          <p className="text-sm font-semibold text-muted-foreground mb-1.5">What the label will say</p>
          <AddressBlock tone="label" lines={[
            address.label.address1,
            address.label.address2,
            address.label.city,
            address.label.postcode,
          ]} />
        </div>
      </div>

      {editing ? (
        <div className="space-y-3 rounded-xl border-2 border-primary/40 bg-background/60 p-3.5">
          <p className="text-base font-semibold">
            Re-cut the address so the important part fits.
            <span className="block text-sm font-normal text-muted-foreground mt-0.5">
              APC allows {ADDRESS_LINE_MAX} characters per line. This changes the label only — the Shopify
              order stays exactly as the customer wrote it.
            </span>
          </p>
          <AddressField label="Address line 1" value={a1} onChange={setA1} autoFocus />
          <AddressField label="Address line 2" value={a2} onChange={setA2} placeholder="Optional" />
          <div className="grid gap-3 sm:grid-cols-2">
            <AddressField label="Town" value={city} onChange={setCity} />
            <AddressField label="Postcode" value={postcode} onChange={setPostcode} max={12} />
          </div>
          <div className="flex items-center gap-2.5 flex-wrap pt-1">
            <button
              onClick={() => save.mutate()}
              disabled={!canSave || save.isPending}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-green-600 text-white text-base font-semibold hover:bg-green-700 disabled:opacity-40"
            >
              {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Save this address
            </button>
            <button
              onClick={() => {
                setA1(address.label.address1);
                setA2(address.label.address2 ?? "");
                setCity(address.label.city);
                setPostcode(address.label.postcode);
                setEditing(false);
              }}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 border-border text-base font-medium hover:bg-secondary/50"
            >
              <X className="w-4 h-4" /> Cancel
            </button>
            {tooLong && (
              <span className="text-sm font-semibold text-destructive">
                A line is over {ADDRESS_LINE_MAX} characters — shorten it before saving.
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            onClick={() => setEditing(true)}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-base font-semibold hover:bg-primary/90"
          >
            <Pencil className="w-4 h-4" /> {address.corrected ? "Edit the address" : "Fix the address"}
          </button>
          {address.corrected && (
            <button
              onClick={() => revert.mutate()}
              disabled={revert.isPending}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 border-border text-base font-medium hover:bg-secondary/50 disabled:opacity-40"
            >
              {revert.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
              Undo — use the automatic address
            </button>
          )}
        </div>
      )}
    </div>
  );
}
