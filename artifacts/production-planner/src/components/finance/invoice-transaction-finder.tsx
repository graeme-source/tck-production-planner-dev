/**
 * "Is it this transaction?" for one invoice (Graeme, 26 Nov 2026: "if I
 * upload an invoice, it will detect the outstanding transactions and make
 * sure that it matches or gives me the option to match at the time of
 * uploading"). Waits for the invoice to be read, then puts forward a
 * transaction where two of amount (converted from dollars etc.), supplier and
 * date agree, with "Yes, attach"; and "Choose a transaction" always opens
 * every outstanding one with a search. A second copy of an invoice already in
 * the library works on the first, so nothing goes on twice. Used straight
 * after an upload and on an invoice in the library. Objective I.
 */
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Copy, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { jsonFetch, money, ukDate, type ReadInvoice } from "@/pages/finance-invoice-drop";
import { MatchOptions, type InvoiceMatches, type Suggestion } from "@/pages/finance-invoice-match";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Found = InvoiceMatches & {
  invoice: ReadInvoice & { readStatus?: string };
  copyOf: number | null;
  alreadyAttached: { id: number; lineDate: string; descriptor: string; amount: string; status: string } | null;
};

const READING = ["pending"];

export function InvoiceTransactionFinder({ invoiceId, onInvoice }: {
  invoiceId: number;
  /** The invoice as the server has it now (read details, category). */
  onInvoice?: (invoice: Found["invoice"] & { categoryId?: number | null }) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const key = ["/api/finance/invoices", invoiceId, "transactions"];
  const found = useQuery<Found>({
    queryKey: key,
    queryFn: () => jsonFetch(`${BASE}/api/finance/invoices/${invoiceId}/transactions`) as Promise<Found>,
    // Still being read: ask again every few seconds, for up to two minutes.
    refetchInterval: (q) => (READING.includes(q.state.data?.invoice.readStatus ?? "") && q.state.dataUpdateCount < 40 ? 3000 : false),
  });
  useEffect(() => { if (found.data) onInvoice?.(found.data.invoice); }, [found.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/finance/invoices"] });
    queryClient.invalidateQueries({ queryKey: ["/api/finance/lines"] });
  };
  const post = (path: string, body: object) => jsonFetch(`${BASE}/api/finance/invoices/${invoiceId}/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const attach = useMutation({
    mutationFn: (lines: Suggestion[]) => post("attach", { lineIds: lines.map((l) => l.lineId) }),
    onSuccess: (r, lines) => {
      const done = (r as { autoDone?: number; attached?: number }).autoDone ?? 0;
      toast({
        title: `Attached to ${lines[0].supplier}, ${money(lines[0].amount)}`,
        description: done > 0 ? "Already posted in QuickBooks, so it's done and in Completed." : "It's in the Inbox under To be processed.",
      });
      refresh();
    },
    onError: (e: Error) => toast({ title: "Couldn't attach it", description: e.message, variant: "destructive" }),
  });
  const reject = useMutation({
    mutationFn: (lineId: number) => post("reject-line", { lineId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
    onError: (e: Error) => toast({ title: "Couldn't save that", description: e.message, variant: "destructive" }),
  });

  if (found.isLoading) return <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Looking for its transaction…</p>;
  if (found.isError || !found.data) return <p className="text-sm text-destructive">Couldn't look for its transaction: {(found.error as Error)?.message ?? "try again"}</p>;
  const d = found.data;
  const reading = READING.includes(d.invoice.readStatus ?? "");
  return (
    <div className="space-y-2">
      {d.copyOf != null && (
        <p className="text-sm text-amber-800 dark:text-amber-300 flex items-start gap-2">
          <Copy className="h-4 w-4 mt-0.5 shrink-0" /> Already in the library, so this works on that one. It won't be added twice.
        </p>
      )}
      {d.alreadyAttached ? (
        // Say where it went (Graeme, 26 Nov 2026: attached Klaviyo "seems to
        // have disappeared" — it had gone straight to Completed, already posted).
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 p-3 space-y-1">
          <p className="text-sm flex items-center gap-2 text-emerald-800 dark:text-emerald-300 font-semibold">
            <CheckCircle2 className="h-4 w-4 shrink-0" /> On a transaction: {d.alreadyAttached.descriptor}, {money(d.alreadyAttached.amount)} on {ukDate(d.alreadyAttached.lineDate)}
          </p>
          <p className="text-sm text-emerald-900/80 dark:text-emerald-200/80">
            {d.alreadyAttached.status === "done"
              ? "Already posted in QuickBooks, so it's done: Inbox → Completed. Nothing for the accounts team to post."
              : "In the Inbox under To be processed, for the accounts team to post in QuickBooks and mark as posted."}
          </p>
        </div>
      ) : reading ? (
        <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Reading the invoice, then looking for its transaction…</p>
      ) : d.invoice.docKind === "statement" ? null : (
        <MatchOptions quiet invoice={d.invoice} matches={d} busy={attach.isPending || reject.isPending}
          onAttach={(lines) => attach.mutate(lines)} onReject={(id) => reject.mutate(id)} />
      )}
    </div>
  );
}
