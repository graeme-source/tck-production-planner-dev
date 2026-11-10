import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { DetailsEditor, invoiceMoney, jsonFetch, ukDate, type ReadInvoice } from "@/pages/finance-invoice-drop";
import { MatchOptions, type InvoiceMatches } from "@/pages/finance-invoice-match";
import { FilePreview } from "@/pages/finance-invoices";
import { InvoiceNotes } from "@/pages/finance-invoice-notes";
import { inboxEntries, matchesInboxSearch } from "@/lib/finance-inbox";
import { CheckCircle2, Eye, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// The Inbox (Graeme, 6 Nov 2026): whatever was dropped in and hasn't got a
// transaction yet, like sending it to the accounts email address. The
// bookkeeper finds the transaction in QuickBooks, posts it, and marks it posted
// here; it's then just in the library. It doesn't become a transaction on this
// page unless it meets one: the undeniable matches attach themselves.

type InvoiceSupplier = { supplierId: number; supplierName: string; paymentTerms: "paid_when_ordered" | "on_account" };
type QueueEntry = InvoiceMatches & { invoice: ReadInvoice & { gbpRate: number | null; sourceText?: string; supplier?: InvoiceSupplier | null } };

/** How this supplier is paid, from their Suppliers record (Graeme, 10 Nov
 *  2026): on account = they invoice, the team pays on terms; otherwise it
 *  was paid by card when ordered. Nothing when the supplier isn't known. */
function PaymentTermsChip({ supplier }: { supplier: InvoiceSupplier | null | undefined }) {
  if (!supplier) return null;
  const onAccount = supplier.paymentTerms === "on_account";
  return (
    <span
      title={`${supplier.supplierName}'s payment terms, set on the Suppliers page`}
      className={cn(
        "shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap",
        onAccount ? "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200" : "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200",
      )}
    >
      {onAccount ? "On account" : "Paid when ordered"} · {supplier.supplierName}
    </span>
  );
}
type InvoiceQueue = { check: QueueEntry[]; waiting: QueueEntry[] };

const QUEUE_KEY = ["/api/finance/invoices", "queue"];

export function useInvoiceQueue() {
  return useQuery<InvoiceQueue>({
    queryKey: QUEUE_KEY,
    queryFn: () => jsonFetch(`${BASE}/api/finance/invoices/queue`),
  });
}

export function InboxPanel({ hiddenIds, search }: { hiddenIds: number[]; search: string }) {
  const queue = useInvoiceQueue();
  if (queue.isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  const entries = inboxEntries(queue.data).filter((e) => !hiddenIds.includes(e.invoice.id) && matchesInboxSearch(e.invoice, search));
  if (entries.length === 0) return <Card><CardContent className="py-10 text-center text-muted-foreground">Nothing here — all caught up.</CardContent></Card>;
  return <div className="space-y-3">{entries.map((e) => <InboxRow key={e.invoice.id} entry={e} />)}</div>;
}

function InboxRow({ entry }: { entry: QueueEntry }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { invoice: inv } = entry;
  const [showFile, setShowFile] = useState(false);
  const [editing, setEditing] = useState(false);
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: QUEUE_KEY });
    queryClient.invalidateQueries({ queryKey: ["/api/finance/lines"] });
  };
  const post = (path: string, body: object = {}) => jsonFetch(`${BASE}/api/finance/invoices/${inv.id}/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const fail = (title: string) => (e: Error) => toast({ title, description: e.message, variant: "destructive" });

  const attach = useMutation({
    mutationFn: (lineIds: number[]) => post("attach", { lineIds }),
    onSuccess: refresh,
    onError: fail("Couldn't attach it"),
  });
  const reject = useMutation({
    mutationFn: (lineId: number) => post("reject-line", { lineId }),
    onSuccess: refresh,
    onError: fail("Couldn't save that"),
  });
  const leave = useMutation({
    mutationFn: () => post("leave-queue"),
    onSuccess: () => { toast({ title: "Taken out of the Inbox", description: "It's still in Invoices." }); refresh(); },
    onError: fail("Couldn't save that"),
  });
  const markPosted = useMutation({
    mutationFn: () => post("posted", { posted: true }),
    onSuccess: () => { toast({ title: "Marked as posted", description: "It's in Invoices. If that was a mistake, open it there to put it back." }); refresh(); },
    onError: fail("Couldn't save that"),
  });
  const busy = attach.isPending || reject.isPending || leave.isPending || markPosted.isPending;
  const unread = inv.readStatus === "failed" || inv.readStatus === "not_available";

  return (
    <Card><CardContent className="p-4 space-y-3">
      {/* One headline row (Graeme, 10 Nov 2026): who and what on the left,
          then the note, Paid / Unpaid, and the amount — wraps on a phone. */}
      <div className="flex flex-col sm:flex-row sm:items-start gap-x-4 gap-y-2">
        <div className="sm:w-56 lg:w-64 shrink-0 min-w-0">
          <div className="font-semibold break-words">{inv.supplierName ?? inv.fileName}</div>
          <div className="text-sm text-muted-foreground break-words">
            {inv.invoiceDate ? ukDate(inv.invoiceDate) : "date not read"}
            {inv.invoiceNumber ? ` · No. ${inv.invoiceNumber}` : ""}
          </div>
          {inv.sourceText && <div className="text-xs text-muted-foreground break-words">{inv.sourceText}</div>}
          {unread && !inv.totalAmount && <div className="text-sm text-destructive">Couldn't be read: correct the details so it can be matched.</div>}
        </div>
        <div className="flex-1 min-w-0 flex flex-wrap items-center gap-2">
          <InvoiceNotes invoice={inv} layout="inline" />
          <PaymentTermsChip supplier={inv.supplier} />
        </div>
        <div className="shrink-0 sm:text-right font-bold tabular-nums text-lg leading-9">{inv.totalAmount ? invoiceMoney(inv.totalAmount, inv.currency) : "total not read"}</div>
      </div>

      <MatchOptions quiet invoice={inv} matches={entry} busy={busy} onAttach={(lines) => attach.mutate(lines.map((l) => l.lineId))} onReject={(id) => reject.mutate(id)} />

      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={busy} onClick={() => markPosted.mutate()}>
          {markPosted.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1" />} Mark as posted
        </Button>
        {/* Same size as Mark as posted, with a border: the bookkeeper opens the
            invoice on nearly every row to read the VAT split (Graeme, 10 Nov 2026). */}
        <Button variant="outline" aria-expanded={showFile} onClick={() => setShowFile((v) => !v)}><Eye className="h-4 w-4 mr-1" /> {showFile ? "Hide invoice" : "View invoice"}</Button>
        <Button variant="ghost" size="sm" onClick={() => setEditing((v) => !v)}>Correct details</Button>
        <Button variant="ghost" size="sm" className="sm:ml-auto" disabled={busy} onClick={() => leave.mutate()}>Remove from Inbox</Button>
      </div>

      {showFile && <FilePreview url={`${BASE}/api/finance/invoices/${inv.id}/file`} mime={inv.fileMime} name={inv.fileName} />}
      {editing && <DetailsEditor invoice={inv} busy={false} onSaved={refresh} />}
    </CardContent></Card>
  );
}
