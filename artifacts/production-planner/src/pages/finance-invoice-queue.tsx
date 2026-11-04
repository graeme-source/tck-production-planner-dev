import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { DetailsEditor, jsonFetch, money, SuggestionBox, ukDate, type ReadInvoice, type Suggestion } from "@/pages/finance-invoice-drop";
import { FilePreview } from "@/pages/finance-invoices";
import { ChevronDown, ChevronRight, Eye } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// Add an invoice once (Graeme, 4 Nov 2026): whatever was dropped on
// Outstanding and hasn't got a transaction yet. The undeniable matches attach
// themselves, so this shows only what needs a person, and what's still waiting.

type QueueEntry = { invoice: ReadInvoice; suggestions: Suggestion[]; confident: boolean };
type InvoiceQueue = { check: QueueEntry[]; waiting: QueueEntry[] };

const QUEUE_KEY = ["/api/finance/invoices", "queue"];

function plural(n: number, one: string) {
  return `${n} ${one}${n === 1 ? "" : "s"}`;
}

export function InvoiceQueuePanel({ hiddenIds }: { hiddenIds: number[] }) {
  const queue = useQuery<InvoiceQueue>({
    queryKey: QUEUE_KEY,
    queryFn: () => jsonFetch(`${BASE}/api/finance/invoices/queue`),
  });
  const [showWaiting, setShowWaiting] = useState(false);
  const visible = (entries: QueueEntry[] | undefined) => (entries ?? []).filter((e) => !hiddenIds.includes(e.invoice.id));
  const check = visible(queue.data?.check);
  const waiting = visible(queue.data?.waiting);
  if (check.length === 0 && waiting.length === 0) return null;

  return (
    <div className="space-y-3">
      {check.length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="font-semibold">{plural(check.length, "invoice")} to check</div>
            {check.map((e) => <QueueRow key={e.invoice.id} entry={e} />)}
          </CardContent>
        </Card>
      )}
      {waiting.length > 0 && (
        <Card>
          <button className="w-full text-left px-4 py-3 flex items-center gap-2 font-semibold" onClick={() => setShowWaiting((v) => !v)} aria-expanded={showWaiting}>
            {showWaiting ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
            {plural(waiting.length, "invoice")} waiting for a transaction
          </button>
          {showWaiting && (
            <CardContent className="px-4 pb-4 pt-0 space-y-3">
              {waiting.map((e) => <QueueRow key={e.invoice.id} entry={e} />)}
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}

function QueueRow({ entry }: { entry: QueueEntry }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { invoice: inv, suggestions } = entry;
  const [showFile, setShowFile] = useState(false);
  const [editing, setEditing] = useState(false);
  const [top] = suggestions;
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: QUEUE_KEY });
    queryClient.invalidateQueries({ queryKey: ["/api/finance/lines"] });
  };
  const post = (path: string, body: object = {}) => jsonFetch(`${BASE}/api/finance/invoices/${inv.id}/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const fail = (title: string) => (e: Error) => toast({ title, description: e.message, variant: "destructive" });

  const attach = useMutation({
    mutationFn: (lineId: number) => post("attach", { lineId }),
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
    onSuccess: () => { toast({ title: "Taken out of the queue", description: "It's still in Invoices." }); refresh(); },
    onError: fail("Couldn't save that"),
  });
  const busy = attach.isPending || reject.isPending || leave.isPending;
  const unread = inv.readStatus === "failed" || inv.readStatus === "not_available";

  return (
    <div className="rounded-xl border p-3 space-y-3">
      <div>
        <div className="font-medium break-words">{inv.supplierName ?? inv.fileName}</div>
        <div className="text-sm text-muted-foreground break-words">
          {inv.invoiceDate ? ukDate(inv.invoiceDate) : "date not read"} · {inv.totalAmount ? money(inv.totalAmount) : "total not read"}
          {inv.invoiceNumber ? ` · No. ${inv.invoiceNumber}` : ""}
        </div>
        {unread && <div className="text-sm text-destructive">Couldn't be read: correct the details so it can be matched.</div>}
      </div>

      {top && <SuggestionBox s={top} heading="Is it this one?" primary busy={busy} onAttach={() => attach.mutate(top.lineId)} />}

      <div className="flex flex-wrap gap-2">
        {top && <Button variant="outline" size="sm" disabled={busy} onClick={() => reject.mutate(top.lineId)}>Not this one</Button>}
        <Button variant="ghost" size="sm" onClick={() => setShowFile((v) => !v)}><Eye className="h-4 w-4 mr-1" /> {showFile ? "Hide invoice" : "View invoice"}</Button>
        <Button variant="ghost" size="sm" onClick={() => setEditing((v) => !v)}>Correct details</Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => leave.mutate()}>No card transaction</Button>
      </div>

      {showFile && <FilePreview url={`${BASE}/api/finance/invoices/${inv.id}/file`} mime={inv.fileMime} name={inv.fileName} />}
      {editing && <DetailsEditor invoice={inv} busy={false} onSaved={refresh} />}
    </div>
  );
}
