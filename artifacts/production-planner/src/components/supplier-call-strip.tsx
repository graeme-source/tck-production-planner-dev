// Each Front Door delivery card's Call button and account number (#332, Jane
// Miles). The account number has a copy button because Brakes ask for it
// before speaking to customer service. Calling is rare, so since 6 Nov 2026
// (Graeme) it's a plain button beside Edit order, not a highlighted strip.
// Each shows only when there's something to show.
import { useState } from "react";
import { Copy, Check, Phone } from "lucide-react";
import { telHref } from "@/components/contacts/contacts-api";
import { supplierCallStrip, type SupplierCallInfo } from "@/lib/supplier-call-strip";
import { toast } from "@/hooks/use-toast";

export function SupplierCallButton({ supplier }: { supplier: SupplierCallInfo | null | undefined }) {
  const phone = supplierCallStrip(supplier)?.phone;
  if (!phone) return null;
  return (
    <a
      href={telHref(phone)}
      className="min-h-[44px] px-3 py-2 rounded-xl border border-border text-sm font-medium hover:bg-secondary/50 transition-colors flex items-center gap-1.5 whitespace-nowrap"
    >
      <Phone className="w-4 h-4" />
      Call {phone}
    </a>
  );
}

export function SupplierAccountNumber({ supplier }: { supplier: SupplierCallInfo | null | undefined }) {
  const strip = supplierCallStrip(supplier);
  const [copied, setCopied] = useState(false);
  if (!strip?.accountNumber) return null;

  const copy = async () => {
    if (!strip?.accountNumber) return;
    try {
      await navigator.clipboard.writeText(strip.accountNumber);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Couldn't copy", description: `Account number: ${strip.accountNumber}`, variant: "destructive" });
    }
  };

  return (
    <div className="px-4 pb-3 flex items-center gap-2 text-sm" onClick={e => e.stopPropagation()}>
      <span className="text-muted-foreground break-all">
        Account no. <span className="font-mono font-semibold text-foreground">{strip.accountNumber}</span>
      </span>
      <button
        onClick={copy}
        className="shrink-0 inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-lg border border-border hover:bg-secondary/60 text-sm font-medium"
        aria-label="Copy the account number"
      >
        {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
