import { useRef, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { FilePreview } from "@/pages/finance-invoices";
import { MatchOptions, type InvoiceMatches, type Suggestion } from "@/pages/finance-invoice-match";
import { InvoiceQueuePanel } from "@/pages/finance-invoice-queue";
import { Eye, FileText, Loader2, Search as SearchIcon, Upload, X } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// Outstanding → "Drop an invoice" (Graeme, 3 Nov 2026): drop invoices,
// each is read and the transaction it belongs to is put forward —
// "I think it's this one" — and one press attaches it. If its transaction
// isn't in yet it waits in the queue (finance-invoice-queue.tsx).

export type ReadInvoice = {
  id: number;
  fileName: string;
  fileMime: string;
  supplierName: string | null;
  invoiceDate: string | null;
  invoiceNumber: string | null;
  totalAmount: string | null;
  vatAmount: string | null;
  docKind: string;
  readStatus: string;
  readNote: string | null;
};

type FindResult = InvoiceMatches & {
  invoice: ReadInvoice | null;
  alreadyAttached: { id: number; lineDate: string; descriptor: string; amount: string } | null;
};

type Item = {
  key: string;
  fileName: string;
  state: "reading" | "ready" | "error";
  result?: FindResult;
  error?: string;
};

export async function jsonFetch(url: string, init?: RequestInit) {
  const res = await fetch(url, { credentials: "include", ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

export const money = (v: string | null) => (v == null ? "—" : `£${Number(v).toFixed(2)}`);
export const ukDate = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "no date");

/** `companion` sits beside the drop card on wide screens (the card
 *  statement upload); results run full width underneath. */
export function InvoiceDropPanel({ companion }: { companion?: ReactNode }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [items, setItems] = useState<Item[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const patch = (key: string, p: Partial<Item>) => setItems((all) => all.map((i) => (i.key === key ? { ...i, ...p } : i)));

  const find = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return jsonFetch(`${BASE}/api/finance/invoices/find-transaction`, { method: "POST", body: form }) as Promise<FindResult>;
    },
  });

  async function addFiles(files: File[]) {
    const wanted = files.filter((f) => /\.(pdf|png|jpe?g|webp|heic|heif)$/i.test(f.name) || f.type === "application/pdf" || f.type.startsWith("image/"));
    if (wanted.length < files.length) toast({ title: "Some files were skipped", description: "Only PDFs and photos can be invoices." });
    const fresh = wanted.map((f) => ({ file: f, item: { key: `${Date.now()}-${Math.random()}`, fileName: f.name, state: "reading" as const } }));
    setItems((all) => [...fresh.map((x) => x.item), ...all]);
    // One at a time: each is read by Claude, and the answers arrive in order.
    for (const { file, item } of fresh) {
      try {
        patch(item.key, { state: "ready", result: await find.mutateAsync(file) });
      } catch (e) {
        patch(item.key, { state: "error", error: e instanceof Error ? e.message : String(e) });
      }
    }
    queryClient.invalidateQueries({ queryKey: ["/api/finance/invoices"] });
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
      <Card
        className={cn("border-2 border-dashed transition-colors", dragOver ? "border-primary bg-primary/10" : "border-primary/40")}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); void addFiles(Array.from(e.dataTransfer.files)); }}
      >
        <CardContent className="p-4 h-full flex flex-col xl:flex-row xl:items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="font-semibold flex items-start gap-2"><FileText className="h-4 w-4 mt-1 shrink-0 text-primary" /> Drop an invoice — it finds the transaction</div>
            <div className="text-xs text-muted-foreground">PDFs or photos, one or several. If the transaction isn't in yet, the invoice waits for it.</div>
          </div>
          <input
            ref={input}
            type="file"
            multiple
            accept="application/pdf,image/*,.pdf,.heic"
            className="hidden"
            onChange={(e) => { void addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }}
          />
          <Button onClick={() => input.current?.click()} className="shrink-0 self-start xl:self-auto">
            <Upload className="h-4 w-4 mr-2" /> Add invoices
          </Button>
        </CardContent>
      </Card>
      {companion}
      </div>

      {items.map((item) => (
        <InvoiceMatchCard
          key={item.key}
          item={item}
          onDismiss={() => setItems((all) => all.filter((i) => i.key !== item.key))}
          onChange={(p) => patch(item.key, p)}
        />
      ))}

      {/* What's on a card above isn't shown twice. */}
      <InvoiceQueuePanel hiddenIds={items.flatMap((i) => (i.state === "ready" && i.result?.invoice ? [i.result.invoice.id] : []))} />
    </div>
  );
}

function InvoiceMatchCard({ item, onDismiss, onChange }: { item: Item; onDismiss: () => void; onChange: (p: Partial<Item>) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showFile, setShowFile] = useState(false);
  // Once someone starts correcting the details, the boxes stay put even
  // when a match turns up halfway through.
  const [editing, setEditing] = useState(false);
  const inv = item.result?.invoice ?? null;
  const unread = inv ? inv.readStatus === "failed" || inv.readStatus === "not_available" : false;

  const post = (path: string, body: object = {}) => jsonFetch(`${BASE}/api/finance/invoices/${inv!.id}/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });

  const attach = useMutation({
    mutationFn: (lines: Suggestion[]) => post("attach", { lineIds: lines.map((l) => l.lineId) }) as Promise<{ attached: number; autoDone: number }>,
    onSuccess: (r, lines) => {
      // The card's job is done, so it goes (Graeme, 4 Nov 2026).
      toast({
        title: lines.length === 1 ? `Attached to ${lines[0].supplier}, ${money(lines[0].amount)}` : `Attached to ${lines.length} ${lines[0].supplier} transactions`,
        description: r.autoDone === r.attached ? "Already posted in QuickBooks, so it's done and filed in Invoices."
          : r.autoDone > 0 ? `${r.autoDone} already posted went to Completed. The rest are under To be processed.`
          : "It's now under To be processed.",
      });
      onDismiss();
      queryClient.invalidateQueries({ queryKey: ["/api/finance/lines"] });
      queryClient.invalidateQueries({ queryKey: ["/api/finance/invoices"] });
    },
    onError: (e: Error) => toast({ title: "Couldn't attach it", description: e.message, variant: "destructive" }),
  });

  const lookAgain = useMutation({
    mutationFn: () => jsonFetch(`${BASE}/api/finance/invoices/${inv!.id}/transactions`) as Promise<FindResult>,
    onSuccess: (result) => onChange({ result }),
    onError: (e: Error) => toast({ title: "Couldn't look again", description: e.message, variant: "destructive" }),
  });

  const reject = useMutation({
    mutationFn: (lineId: number) => post("reject-line", { lineId }),
    onSuccess: () => lookAgain.mutate(),
    onError: (e: Error) => toast({ title: "Couldn't save that", description: e.message, variant: "destructive" }),
  });

  const leaveQueue = useMutation({
    mutationFn: () => post("leave-queue"),
    onSuccess: () => {
      toast({ title: "Taken out of the queue", description: "It's still in Invoices." });
      onDismiss();
      queryClient.invalidateQueries({ queryKey: ["/api/finance/invoices"] });
    },
    onError: (e: Error) => toast({ title: "Couldn't save that", description: e.message, variant: "destructive" }),
  });

  const hasOptions = (item.result?.suggestions.length ?? 0) > 0;
  const busy = attach.isPending || reject.isPending || leaveQueue.isPending || lookAgain.isPending;

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="font-semibold break-words">{inv?.supplierName ?? item.fileName}</div>
            <div className="text-sm text-muted-foreground break-words">
              {inv ? <>Invoice {inv.invoiceDate ? ukDate(inv.invoiceDate) : "date not read"} · {inv.totalAmount ? money(inv.totalAmount) : "total not read"}{inv.invoiceNumber ? ` · No. ${inv.invoiceNumber}` : ""} · {item.fileName}</> : item.fileName}
            </div>
            {inv && inv.docKind !== "invoice" && (
              <Badge variant="secondary" className="mt-1">Reads as a {inv.docKind.replace("_", " ")}, not a VAT invoice</Badge>
            )}
          </div>
          {inv && (
            <Button variant="ghost" size="sm" onClick={() => setShowFile((v) => !v)}>
              <Eye className="h-4 w-4 mr-1" /> {showFile ? "Hide" : "View"}
            </Button>
          )}
          {item.state !== "reading" && (
            <Button variant="ghost" size="icon" onClick={onDismiss} aria-label="Dismiss"><X className="h-4 w-4" /></Button>
          )}
        </div>

        {showFile && inv && <FilePreview url={`${BASE}/api/finance/invoices/${inv.id}/file`} mime={inv.fileMime} name={inv.fileName} />}

        {item.state === "reading" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Reading the invoice and looking for its transaction…
          </div>
        )}

        {item.state === "error" && <p className="text-sm text-destructive">{item.error}</p>}

        {item.state === "ready" && item.result && (
          item.result.alreadyAttached ? (
            <p className="text-sm text-muted-foreground">
              Already attached to {item.result.alreadyAttached.descriptor}, {money(item.result.alreadyAttached.amount)} on {ukDate(item.result.alreadyAttached.lineDate)} — nothing to do.
            </p>
          ) : inv && (
            <div className="space-y-3">
              {unread && !inv.totalAmount && <p className="text-sm">Couldn't read it automatically: type the supplier, date and total below and it will look again.</p>}
              <MatchOptions invoice={inv} matches={item.result} busy={busy} onAttach={(lines) => attach.mutate(lines)} onReject={(id) => reject.mutate(id)} />
              <div className="flex flex-wrap gap-2">
                {!editing && hasOptions && <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>Details wrong? Correct them</Button>}
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => leaveQueue.mutate()}>No card transaction</Button>
              </div>
            </div>
          )
        )}

        {item.state === "ready" && inv && !item.result?.alreadyAttached && (editing || !hasOptions) && (
          <DetailsEditor invoice={inv} onSaved={() => { setEditing(true); lookAgain.mutate(); }} busy={lookAgain.isPending} />
        )}
      </CardContent>
    </Card>
  );
}

/** Correct what was read off the invoice; each field saves when you leave it. */
export function DetailsEditor({ invoice, onSaved, busy }: { invoice: ReadInvoice; onSaved: () => void; busy: boolean }) {
  const { toast } = useToast();
  const [supplier, setSupplier] = useState(invoice.supplierName ?? "");
  const [date, setDate] = useState(invoice.invoiceDate ?? "");
  const [total, setTotal] = useState(invoice.totalAmount ?? "");
  const [saved, setSaved] = useState<"idle" | "saving" | "saved">("idle");

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => jsonFetch(`${BASE}/api/finance/invoices/${invoice.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }),
    onMutate: () => setSaved("saving"),
    onSuccess: () => { setSaved("saved"); onSaved(); },
    onError: (e: Error) => { setSaved("idle"); toast({ title: "Couldn't save", description: e.message, variant: "destructive" }); },
  });

  return (
    <div className="rounded-xl border p-3 space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <SearchIcon className="h-4 w-4" /> Correct the details and look again
        <span className="ml-auto text-xs text-muted-foreground">
          {saved === "saving" || busy ? "Saving and looking…" : saved === "saved" ? "Saved" : ""}
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <Input aria-label="Supplier" placeholder="Supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)}
          onBlur={() => supplier !== (invoice.supplierName ?? "") && save.mutate({ supplierName: supplier.trim() || null })} />
        <Input aria-label="Invoice date" type="date" value={date} onChange={(e) => setDate(e.target.value)}
          onBlur={() => date && date !== (invoice.invoiceDate ?? "") && save.mutate({ invoiceDate: date })} />
        <Input aria-label="Total" inputMode="decimal" placeholder="Total £" value={total} onChange={(e) => setTotal(e.target.value)}
          onBlur={() => {
            const n = Number(total.replace(/[£,\s]/g, ""));
            if (total && Number.isFinite(n) && n.toFixed(2) !== (invoice.totalAmount ?? "")) save.mutate({ totalAmount: n });
          }} />
      </div>
    </div>
  );
}
