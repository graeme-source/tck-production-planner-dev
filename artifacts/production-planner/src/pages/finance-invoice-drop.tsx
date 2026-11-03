import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { FilePreview } from "@/pages/finance-invoices";
import { CheckCircle2, Eye, FileText, Loader2, Search as SearchIcon, Upload, X } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// Outstanding → "Drop an invoice" (Graeme, 3 Nov 2026): drop invoices,
// each is read and the transaction it belongs to is put forward —
// "I think it's this one" — and one press attaches it. Nothing is
// attached without that press.

type ReadInvoice = {
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

type Suggestion = {
  lineId: number;
  lineDate: string;
  supplier: string;
  descriptor: string;
  amount: string;
  cardLast4: string | null;
  cardholder: string | null;
  posted: boolean;
  strength: "weak" | "medium" | "strong" | "very_strong";
  reasons: string[];
};

type FindResult = {
  invoice: ReadInvoice | null;
  alreadyAttached: { id: number; lineDate: string; descriptor: string; amount: string } | null;
  suggestions: Suggestion[];
  confident: boolean;
};

type Item = {
  key: string;
  fileName: string;
  state: "reading" | "ready" | "error" | "attached";
  result?: FindResult;
  error?: string;
  attachedTo?: Suggestion;
  autoDone?: boolean;
};

async function jsonFetch(url: string, init?: RequestInit) {
  const res = await fetch(url, { credentials: "include", ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

const money = (v: string | null) => (v == null ? "—" : `£${Number(v).toFixed(2)}`);
const ukDate = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "no date");

export function InvoiceDropPanel() {
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
      <Card
        className={cn("border-2 border-dashed transition-colors", dragOver ? "border-primary bg-primary/10" : "border-primary/40")}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); void addFiles(Array.from(e.dataTransfer.files)); }}
      >
        <CardContent className="p-5 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="h-12 w-12 rounded-2xl bg-primary/15 flex items-center justify-center shrink-0">
            <FileText className="h-6 w-6 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-lg font-semibold">Drop an invoice — it finds the transaction</div>
            <div className="text-sm text-muted-foreground">PDFs or photos, one or several. Each is read and matched to its card transaction for you to confirm.</div>
          </div>
          <input
            ref={input}
            type="file"
            multiple
            accept="application/pdf,image/*,.pdf,.heic"
            className="hidden"
            onChange={(e) => { void addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }}
          />
          <Button size="lg" onClick={() => input.current?.click()}>
            <Upload className="h-4 w-4 mr-2" /> Add invoices
          </Button>
        </CardContent>
      </Card>

      {items.map((item) => (
        <InvoiceMatchCard
          key={item.key}
          item={item}
          onDismiss={() => setItems((all) => all.filter((i) => i.key !== item.key))}
          onChange={(p) => patch(item.key, p)}
        />
      ))}
    </div>
  );
}

function InvoiceMatchCard({ item, onDismiss, onChange }: { item: Item; onDismiss: () => void; onChange: (p: Partial<Item>) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showOthers, setShowOthers] = useState(false);
  const [showFile, setShowFile] = useState(false);
  // Once someone starts correcting the details, the boxes stay put even
  // when a match turns up halfway through.
  const [editing, setEditing] = useState(false);
  const inv = item.result?.invoice ?? null;
  const unread = inv ? inv.readStatus === "failed" || inv.readStatus === "not_available" : false;

  const attach = useMutation({
    mutationFn: (s: Suggestion) => jsonFetch(`${BASE}/api/finance/invoices/${inv!.id}/attach`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lineId: s.lineId }),
    }) as Promise<{ autoDone: boolean }>,
    onSuccess: (r, s) => {
      onChange({ state: "attached", attachedTo: s, autoDone: r.autoDone });
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

  const [top, ...others] = item.result?.suggestions ?? [];

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

        {item.state === "attached" && item.attachedTo && (
          <div className="rounded-xl bg-emerald-50 text-emerald-900 p-3 text-sm flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              Attached to {item.attachedTo.supplier}, {money(item.attachedTo.amount)} on {ukDate(item.attachedTo.lineDate)}.
              {item.autoDone ? " It was already posted in QuickBooks, so it's done and filed in Invoices." : " It's now under Document found."}
            </div>
          </div>
        )}

        {item.state === "ready" && item.result && (
          item.result.alreadyAttached ? (
            <p className="text-sm text-muted-foreground">
              Already attached to {item.result.alreadyAttached.descriptor}, {money(item.result.alreadyAttached.amount)} on {ukDate(item.result.alreadyAttached.lineDate)} — nothing to do.
            </p>
          ) : !top ? (
            <p className="text-sm">
              {unread
                ? "Couldn't read it automatically — type the supplier, date and total below and it will look again."
                : "No matching transaction is waiting for an invoice — it's filed in Invoices. If something was read wrong, correct it below."}
            </p>
          ) : (
            <div className="space-y-3">
              <SuggestionBox
                s={top}
                heading={item.result.confident ? "I think it's this one" : "Closest match — check it's right"}
                primary
                busy={attach.isPending}
                onAttach={() => attach.mutate(top)}
              />
              <div className="flex flex-wrap gap-2">
                {others.length > 0 && (
                  <Button variant="outline" size="sm" onClick={() => setShowOthers((v) => !v)}>
                    {showOthers ? "Hide the others" : `Not this one — show ${others.length} other${others.length === 1 ? "" : "s"}`}
                  </Button>
                )}
                {!editing && (
                  <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>Details wrong? Correct them</Button>
                )}
              </div>
              {showOthers && others.map((s) => (
                <SuggestionBox key={s.lineId} s={s} heading="Or this one?" busy={attach.isPending} onAttach={() => attach.mutate(s)} />
              ))}
            </div>
          )
        )}

        {item.state === "ready" && inv && !item.result?.alreadyAttached && (editing || !top) && (
          <DetailsEditor invoice={inv} onSaved={() => { setEditing(true); lookAgain.mutate(); }} busy={lookAgain.isPending} />
        )}
      </CardContent>
    </Card>
  );
}

function SuggestionBox({ s, heading, primary, busy, onAttach }: { s: Suggestion; heading: string; primary?: boolean; busy: boolean; onAttach: () => void }) {
  return (
    <div className={cn("rounded-xl border p-4 flex flex-col sm:flex-row sm:items-center gap-3", primary ? "border-primary/50 bg-primary/5" : "bg-secondary/30")}>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{heading}</div>
        <div className="text-base font-semibold break-words">{s.supplier}</div>
        <div className="text-sm break-words">
          {money(s.amount)} on {ukDate(s.lineDate)}
          {s.cardLast4 ? ` · card ${s.cardLast4}` : ""}{s.cardholder ? ` · ${s.cardholder}` : ""}
          {s.posted ? " · posted in QuickBooks" : ""}
        </div>
        <div className="text-xs text-muted-foreground mt-1">{s.reasons.join(" · ")}</div>
      </div>
      <Button size={primary ? "lg" : "default"} variant={primary ? "default" : "outline"} onClick={onAttach} disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
        {primary ? "Yes, attach" : "Attach this one"}
      </Button>
    </div>
  );
}

/** Correct what was read off the invoice; each field saves when you leave it. */
function DetailsEditor({ invoice, onSaved, busy }: { invoice: ReadInvoice; onSaved: () => void; busy: boolean }) {
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
