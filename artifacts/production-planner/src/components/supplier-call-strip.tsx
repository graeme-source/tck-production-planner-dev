// The highlighted "Call · Account no." strip under the supplier name on each
// Front Door delivery card (#332, Jane Miles). Tap to dial reuses the
// Contacts page's Call button; the account number has a copy button because
// Brakes ask for it before speaking to customer service. Shows only when
// there's something to show.
import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { CallButton } from "@/components/contacts/contact-card";
import { supplierCallStrip, type SupplierCallInfo } from "@/lib/supplier-call-strip";
import { toast } from "@/hooks/use-toast";

export function SupplierCallStrip({ supplier }: { supplier: SupplierCallInfo | null | undefined }) {
  const strip = supplierCallStrip(supplier);
  const [copied, setCopied] = useState(false);
  if (!strip) return null;

  const copy = async () => {
    if (!strip.accountNumber) return;
    try {
      await navigator.clipboard.writeText(strip.accountNumber);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Couldn't copy", description: `Account number: ${strip.accountNumber}`, variant: "destructive" });
    }
  };

  return (
    <div
      className="mx-4 mb-3 rounded-xl border-2 border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 p-2 flex flex-wrap items-center gap-2"
      onClick={e => e.stopPropagation()}
    >
      {strip.phone && <CallButton phone={strip.phone} label={`Call ${strip.phone}`} className="flex-[1_1_12rem]" />}
      {strip.accountNumber && (
        <div className="flex-[1_1_12rem] flex items-center justify-between gap-2 h-12 px-3 rounded-xl bg-background border border-amber-300 dark:border-amber-700">
          <span className="text-base font-semibold break-all">
            Account no. <span className="font-mono text-lg">{strip.accountNumber}</span>
          </span>
          <button
            onClick={copy}
            className="shrink-0 inline-flex items-center gap-1.5 h-10 px-3 rounded-lg border border-border hover:bg-secondary/60 text-sm font-semibold"
            aria-label="Copy the account number"
          >
            {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
    </div>
  );
}
