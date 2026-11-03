/**
 * Finance → Invoices: the library of every invoice we hold (Graeme,
 * 2026-11-03). Drop a zip (or PDFs and photos) and every PDF and image in
 * it is stored and read automatically for supplier, date, number and
 * amounts; a card transaction marked done on Outstanding invoices files its
 * attachments here too, stamped with who posted it. Search by supplier,
 * financial year (April → March), period, or dates. Every action is kept
 * with who did it and when.
 */
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays, Download, ExternalLink, FileArchive, FileText, History, Image as ImageIcon, Loader2,
  RefreshCw, Search as SearchIcon, Upload, X, XCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function jsonFetch(url: string, init?: RequestInit) {
  const res = await fetch(url, { credentials: "include", ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

type Invoice = {
  id: number;
  fileName: string;
  fileMime: string;
  sourcePath: string | null;
  fileSizeBytes: number;
  source: "upload" | "transaction";
  lineId: number | null;
  supplierName: string | null;
  invoiceDate: string | null;
  invoiceNumber: string | null;
  totalAmount: string | null;
  vatAmount: string | null;
  currency: string;
  docKind: string;
  notes: string | null;
  readStatus: "pending" | "done" | "failed" | "not_available";
  readNote: string | null;
  uploadedByName: string | null;
  postedByName: string | null;
  postedAt: string | null;
  createdAt: string;
  filedOn: string;
  financialYear: string;
};

type ListResponse = { invoices: Invoice[]; financialYears: string[]; pendingReads: number };

type FinEvent = {
  id: number;
  entityType: "invoice" | "line";
  action: string;
  detail: Record<string, any>;
  userName: string | null;
  createdAt: string;
};

const PERIODS = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];
const KINDS: Record<string, string> = { invoice: "Invoice", receipt: "Receipt", credit_note: "Credit note", statement: "Statement", other: "Other" };

const fmtDate = (iso: string | null) => iso ? new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";
const fmtWhen = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const money = (v: string | null, cur = "GBP") => v == null ? "—" : `${cur === "GBP" ? "£" : `${cur} `}${Number(v).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const periodNo = (iso: string) => ((Number(iso.slice(5, 7)) + 8) % 12) + 1;

export function InvoicesLibraryPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [fy, setFy] = useState("all");
  const [period, setPeriod] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [source, setSource] = useState<"all" | "upload" | "transaction">("all");
  const [openId, setOpenId] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [lastUpload, setLastUpload] = useState<{ filesFound: number; filesAdded: number; duplicates: number; skipped: string[] } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q.trim());
  if (fy !== "all") params.set("fy", fy);
  if (fy !== "all" && period !== "all") params.set("period", period);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (source !== "all") params.set("source", source);
  const qs = params.toString();

  const list = useQuery<ListResponse>({
    queryKey: ["/api/finance/invoices", qs],
    queryFn: () => jsonFetch(`${BASE}/api/finance/invoices${qs ? `?${qs}` : ""}`),
    // While files are being read, refresh so the details fill in.
    refetchInterval: (query) => ((query.state.data as ListResponse | undefined)?.pendingReads ?? 0) > 0 ? 5000 : false,
  });

  const uploadMutation = useMutation({
    mutationFn: async (files: File[]) => {
      const form = new FormData();
      files.forEach((f) => form.append("files", f));
      return jsonFetch(`${BASE}/api/finance/invoices/upload`, { method: "POST", body: form });
    },
    onSuccess: (r) => {
      setLastUpload(r);
      toast({ title: `${r.filesAdded} invoice${r.filesAdded === 1 ? "" : "s"} added`, description: r.duplicates ? `${r.duplicates} already in the library.` : "Reading them now." });
      queryClient.invalidateQueries({ queryKey: ["/api/finance/invoices"] });
    },
    onError: (e: Error) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
  });
  const sendFiles = (files: FileList | File[] | null) => {
    const arr = Array.from(files ?? []);
    if (arr.length) uploadMutation.mutate(arr);
  };

  const invoices = list.data?.invoices ?? [];
  const total = useMemo(() => invoices.reduce((s, i) => s + Number(i.totalAmount ?? 0), 0), [invoices]);
  const filtered = Boolean(qs);
  const pending = list.data?.pendingReads ?? 0;

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-3">
        {/* Upload */}
        <Card className="md:col-span-2">
          <CardContent
            className={cn("p-5 rounded-xl transition-colors h-full flex flex-col justify-center gap-3",
              dragOver ? "bg-primary/10 outline-dashed outline-2 outline-primary" : "")}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); sendFiles(e.dataTransfer.files); }}
          >
            <div className="flex items-center gap-4 flex-wrap">
              <div className="h-12 w-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <FileArchive className="h-6 w-6" />
              </div>
              <div className="flex-1 min-w-[220px]">
                <div className="font-semibold">Add invoices</div>
                <div className="text-sm text-muted-foreground">Drop a zip folder, PDFs or photos here. Every PDF and image is kept; the rest is skipped. Files already in the library aren't added twice.</div>
              </div>
              <input ref={fileInput} type="file" multiple accept=".zip,application/zip,.pdf,application/pdf,image/*" className="hidden"
                onChange={(e) => { sendFiles(e.target.files); e.target.value = ""; }} />
              <Button onClick={() => fileInput.current?.click()} disabled={uploadMutation.isPending}>
                {uploadMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Upload className="h-4 w-4 mr-2" />}
                {uploadMutation.isPending ? "Unpacking…" : "Choose files"}
              </Button>
            </div>
            {pending > 0 && (
              <div className="text-sm flex items-center gap-2 text-sky-800 dark:text-sky-300">
                <Loader2 className="h-4 w-4 animate-spin" /> Reading {pending} invoice{pending === 1 ? "" : "s"} for supplier, date and amounts…
              </div>
            )}
            {lastUpload && (
              <div className="text-sm rounded-xl bg-secondary/50 px-3 py-2">
                Last upload: {lastUpload.filesFound} file{lastUpload.filesFound === 1 ? "" : "s"} found · <b>{lastUpload.filesAdded} added</b>
                {lastUpload.duplicates > 0 && ` · ${lastUpload.duplicates} already held`}
                {lastUpload.skipped.length > 0 && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-muted-foreground">{lastUpload.skipped.length} skipped</summary>
                    <ul className="mt-1 text-xs text-muted-foreground list-disc pl-5 max-h-40 overflow-y-auto">
                      {lastUpload.skipped.map((s, i) => <li key={i}>{s}</li>)}
                    </ul>
                  </details>
                )}
              </div>
            )}
          </CardContent>
        </Card>
        {/* Totals for what's shown */}
        <Card>
          <CardContent className="p-5 h-full flex flex-col justify-center">
            <div className="text-sm text-muted-foreground flex items-center gap-2"><FileText className="h-4 w-4" /> {filtered ? "Matching" : "In the library"}</div>
            <div className="text-3xl font-semibold mt-1">{invoices.length.toLocaleString("en-GB")}</div>
            <div className="text-sm text-muted-foreground">{money(total.toFixed(2))} total</div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="space-y-2">
        <div className="flex gap-2 flex-wrap items-center">
          <div className="relative flex-1 min-w-[220px]">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search supplier, invoice number, amount, file name…" className="pl-9" />
            {q && (
              <button onClick={() => setQ("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Clear search">
                <XCircle className="h-4 w-4" />
              </button>
            )}
          </div>
          <Select value={fy} onValueChange={(v) => { setFy(v); if (v === "all") setPeriod("all"); }}>
            <SelectTrigger className="w-44" aria-label="Financial year"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All financial years</SelectItem>
              {(list.data?.financialYears ?? []).map((y) => <SelectItem key={y} value={y}>FY {y}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={period} onValueChange={setPeriod} disabled={fy === "all"}>
            <SelectTrigger className="w-40" aria-label="Period"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Whole year</SelectItem>
              {PERIODS.map((m, i) => <SelectItem key={m} value={String(i + 1)}>P{i + 1} · {m}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <span className="text-xs font-medium text-muted-foreground">Dates</span>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" aria-label="From date" />
          <span className="text-xs text-muted-foreground">to</span>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" aria-label="To date" />
          <span className="text-xs font-medium text-muted-foreground ml-2">Came from</span>
          {([["all", "Anywhere"], ["upload", "Uploaded"], ["transaction", "Card transactions"]] as const).map(([k, label]) => (
            <Button key={k} size="sm" variant={source === k ? "default" : "outline"} onClick={() => setSource(k)}>{label}</Button>
          ))}
          {filtered && (
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => { setQ(""); setFy("all"); setPeriod("all"); setFrom(""); setTo(""); setSource("all"); }}>
              Clear filters
            </Button>
          )}
        </div>
      </div>

      {/* Results */}
      {list.isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : list.isError ? (
        <Card><CardContent className="py-10 text-center text-destructive">{(list.error as Error).message}</CardContent></Card>
      ) : invoices.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">
          {filtered ? "No invoices match — try clearing a filter." : "No invoices yet. Drop a zip of invoices above to start the library."}
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {invoices.map((inv) => (
            <button key={inv.id} onClick={() => setOpenId(inv.id)} className="w-full text-left">
              <Card className="hover:border-primary/50 transition-colors">
                <div className="flex items-center gap-3 px-4 py-3">
                  <div className="h-10 w-10 rounded-xl bg-secondary flex items-center justify-center shrink-0 text-muted-foreground">
                    {inv.fileMime === "application/pdf" ? <FileText className="h-5 w-5" /> : <ImageIcon className="h-5 w-5" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{inv.supplierName ?? <span className="text-muted-foreground italic">Supplier not known yet</span>}</div>
                    <div className="text-xs text-muted-foreground">
                      {fmtDate(inv.invoiceDate)}{inv.invoiceNumber ? ` · ${inv.invoiceNumber}` : ""} · FY {inv.financialYear} P{periodNo(inv.filedOn)}
                      {inv.source === "transaction"
                        ? ` · posted${inv.postedByName ? ` by ${inv.postedByName}` : ""}${inv.postedAt ? ` ${fmtWhen(inv.postedAt)}` : ""}`
                        : ` · uploaded${inv.uploadedByName ? ` by ${inv.uploadedByName}` : ""} ${fmtWhen(inv.createdAt)}`}
                    </div>
                  </div>
                  {inv.readStatus === "pending" && <Badge variant="outline" className="shrink-0"><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Reading</Badge>}
                  {(inv.readStatus === "failed" || inv.readStatus === "not_available") && <Badge variant="outline" className="shrink-0 text-amber-700 border-amber-400">Check details</Badge>}
                  {inv.docKind !== "invoice" && <Badge variant="outline" className="shrink-0">{KINDS[inv.docKind] ?? inv.docKind}</Badge>}
                  <Badge variant="outline" className={cn("shrink-0", inv.source === "transaction" ? "text-indigo-700 border-indigo-300" : "")}>
                    {inv.source === "transaction" ? "Card transaction" : "Uploaded"}
                  </Badge>
                  <div className="font-semibold tabular-nums shrink-0 w-28 text-right">{money(inv.totalAmount, inv.currency)}</div>
                </div>
              </Card>
            </button>
          ))}
        </div>
      )}

      {openId != null && (
        <InvoiceDetail invoice={invoices.find((i) => i.id === openId) ?? null} onClose={() => setOpenId(null)} />
      )}
    </div>
  );
}

function InvoiceDetail({ invoice, onClose }: { invoice: Invoice | null; onClose: () => void }) {
  if (!invoice) return null;
  const fileUrl = `${BASE}/api/finance/invoices/${invoice.id}/file`;
  return (
    <div className="fixed inset-0 z-[150] bg-black/60 flex items-center justify-center p-3 sm:p-4" onClick={onClose}>
      <div className="bg-background rounded-2xl w-full max-w-4xl max-h-[92dvh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 p-5 border-b">
          <div className="flex-1 min-w-0">
            <div className="text-lg font-semibold">{invoice.supplierName ?? "Supplier not known yet"}</div>
            <div className="text-sm text-muted-foreground break-all">{invoice.sourcePath ?? invoice.fileName}</div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close"><X className="h-5 w-5" /></Button>
        </div>
        <div className="overflow-y-auto p-5 space-y-5">
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant="outline" asChild>
              <a href={fileUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4 mr-1" /> Open the file</a>
            </Button>
            <Button size="sm" variant="outline" asChild>
              <a href={`${fileUrl}?download=1`}><Download className="h-4 w-4 mr-1" /> Download</a>
            </Button>
            <ReadAgainButton id={invoice.id} status={invoice.readStatus} />
          </div>
          {invoice.fileMime.startsWith("image/") && invoice.fileMime !== "image/heic" && (
            <img src={fileUrl} alt={invoice.fileName} className="max-h-[50dvh] rounded-xl border mx-auto" />
          )}
          {invoice.readNote && <p className="text-sm text-amber-700 dark:text-amber-400">{invoice.readNote}</p>}
          <InvoiceFields invoice={invoice} />
          <div className="rounded-xl bg-secondary/40 p-4 text-sm space-y-1">
            <div className="font-medium">Where it came from</div>
            {invoice.source === "transaction" ? (
              <div>Filed when its card transaction was marked done{invoice.postedByName ? ` by ${invoice.postedByName}` : ""}{invoice.postedAt ? `, ${fmtWhen(invoice.postedAt)}` : ""}.</div>
            ) : (
              <div>Uploaded{invoice.uploadedByName ? ` by ${invoice.uploadedByName}` : ""}, {fmtWhen(invoice.createdAt)}.</div>
            )}
          </div>
          <HistoryList type="invoice" id={invoice.id} />
        </div>
      </div>
    </div>
  );
}

function ReadAgainButton({ id, status }: { id: number; status: Invoice["readStatus"] }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const read = useMutation({
    mutationFn: () => jsonFetch(`${BASE}/api/finance/invoices/${id}/read`, { method: "POST" }),
    onSuccess: () => { toast({ title: "Reading it again" }); queryClient.invalidateQueries({ queryKey: ["/api/finance/invoices"] }); },
    onError: (e: Error) => toast({ title: "Couldn't start", description: e.message, variant: "destructive" }),
  });
  if (status === "pending") return null;
  return (
    <Button size="sm" variant="outline" onClick={() => read.mutate()} disabled={read.isPending}>
      <RefreshCw className="h-4 w-4 mr-1" /> Read again
    </Button>
  );
}

/** The invoice's details — each saves when you leave the field, with its save state shown. */
function InvoiceFields({ invoice }: { invoice: Invoice }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [form, setForm] = useState({
    supplierName: invoice.supplierName ?? "",
    invoiceDate: invoice.invoiceDate ?? "",
    invoiceNumber: invoice.invoiceNumber ?? "",
    totalAmount: invoice.totalAmount ?? "",
    vatAmount: invoice.vatAmount ?? "",
    docKind: invoice.docKind,
    notes: invoice.notes ?? "",
  });
  const save = useMutation({
    mutationFn: (patch: Record<string, unknown>) => jsonFetch(`${BASE}/api/finance/invoices/${invoice.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
    }),
    onMutate: () => setState("saving"),
    onSuccess: () => { setState("saved"); queryClient.invalidateQueries({ queryKey: ["/api/finance/invoices"] }); queryClient.invalidateQueries({ queryKey: ["/api/finance/history"] }); },
    onError: () => setState("error"),
  });
  const num = (v: string) => v.trim() === "" ? null : Number(v.replace(/[£,\s]/g, ""));
  const commit = (key: keyof typeof form, value: string) => {
    const patch: Record<string, unknown> =
      key === "totalAmount" || key === "vatAmount" ? { [key]: num(value) }
      : key === "invoiceDate" ? { invoiceDate: value || null }
      : { [key]: value };
    if ((key === "totalAmount" || key === "vatAmount") && patch[key] !== null && !Number.isFinite(patch[key] as number)) { setState("error"); return; }
    save.mutate(patch);
  };
  const field = (key: keyof typeof form, label: string, type = "text") => (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input type={type} inputMode={key === "totalAmount" || key === "vatAmount" ? "decimal" : undefined}
        value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        onBlur={(e) => { if (e.target.value !== String((invoice as any)[key] ?? "")) commit(key, e.target.value); }} />
    </div>
  );
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="font-medium">Details</div>
        <span className={cn("text-xs", state === "error" ? "text-destructive" : "text-muted-foreground")}>
          {state === "saving" ? "Saving…" : state === "saved" ? "Saved" : state === "error" ? "Not saved — check the value" : ""}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {field("supplierName", "Supplier")}
        {field("invoiceDate", "Invoice date", "date")}
        {field("invoiceNumber", "Invoice number")}
        {field("totalAmount", "Total (inc. VAT)")}
        {field("vatAmount", "VAT")}
        <div>
          <Label className="text-xs">Kind</Label>
          <Select value={form.docKind} onValueChange={(v) => { setForm({ ...form, docKind: v }); save.mutate({ docKind: v }); }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{Object.entries(KINDS).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <Label className="text-xs">Notes</Label>
        <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
          onBlur={(e) => { if (e.target.value !== (invoice.notes ?? "")) commit("notes", e.target.value); }} />
      </div>
    </div>
  );
}

const ACTION_LABELS: Record<string, (d: Record<string, any>) => string> = {
  uploaded: (d) => `Uploaded${d.from ? ` (from ${d.from})` : ""}`,
  added_from_transaction: () => "Filed from its card transaction when it was marked done",
  linked_to_transaction: () => "Already in the library — linked to its card transaction when it was marked done",
  read: () => "Read automatically: supplier, date and amounts filled in",
  read_failed: (d) => `Couldn't be read automatically${d.reason ? ` (${d.reason})` : ""}`,
  read_requested: () => "Asked to read it again",
  edited: (d) => `Edited ${Object.keys(d.changes ?? {}).map((k) => FIELD_NAMES[k] ?? k).join(", ")}`,
  marked_done: () => "Transaction marked done",
  marked_not_needed: () => "Transaction marked not needed",
  reopened: () => "Transaction reopened",
  note_saved: (d) => `Note saved${d.note ? `: “${d.note}”` : ""}`,
  ticked_posted: () => "Ticked Posted in QuickBooks",
  unticked_posted: () => "Unticked Posted in QuickBooks",
  chased: (d) => `Chase email sent${d.to ? ` to ${d.to}` : ""}`,
  document_added: (d) => `File attached${d.fileName ? `: ${d.fileName}` : ""}`,
  document_attached_from_email: () => "File attached from the mailbox",
  added_by_hand: () => "Transaction added by hand",
};
const FIELD_NAMES: Record<string, string> = {
  supplierName: "supplier", invoiceDate: "date", invoiceNumber: "invoice number", totalAmount: "total", vatAmount: "VAT", docKind: "kind", notes: "notes",
};

/** Who did what, when — for an invoice (with its transaction's story) or a card transaction. */
export function HistoryList({ type, id }: { type: "invoice" | "line"; id: number }) {
  const history = useQuery<{ events: FinEvent[] }>({
    queryKey: ["/api/finance/history", type, id],
    queryFn: () => jsonFetch(`${BASE}/api/finance/invoices/history/${type}/${id}`),
  });
  const events = history.data?.events ?? [];
  return (
    <div className="space-y-2">
      <div className="font-medium flex items-center gap-2"><History className="h-4 w-4" /> History</div>
      {history.isLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : events.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing recorded yet — history starts from 3 Nov 2026.</p>
      ) : (
        <ol className="space-y-1.5">
          {events.map((e) => (
            <li key={e.id} className="text-sm flex gap-3">
              <span className="text-muted-foreground tabular-nums shrink-0 w-40 flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />{fmtWhen(e.createdAt)}</span>
              <span>
                {(ACTION_LABELS[e.action] ?? ((): string => e.action.replace(/_/g, " ")))(e.detail ?? {})}
                <span className="text-muted-foreground"> — {e.userName ?? "the app"}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
