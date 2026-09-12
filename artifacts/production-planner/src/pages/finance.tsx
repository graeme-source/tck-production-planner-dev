import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  Banknote,
  Download,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileText,
  Inbox,
  Loader2,
  Mail,
  Paperclip,
  RefreshCw,
  Search as SearchIcon,
  Upload,
  XCircle,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// Finance / VAT invoice reconciliation — replaces the "Outstanding
// Transactions" Google Sheet. See docs/vat-reconciliation/PLAN.md.
// Access: admin or isBookkeeper (server-enforced; this page just mirrors it).

type FinLine = {
  id: number;
  source: string;
  lineDate: string;
  authDate: string | null;
  descriptor: string;
  merchant: string | null;
  amount: string;
  currency: string;
  originalAmount: string | null;
  originalCurrency: string | null;
  cardLast4: string | null;
  cardholder: string | null;
  vendorId: number | null;
  status: string;
  statusNote: string | null;
  orderReference: string | null;
  supplierEmail: string | null;
  supplierWebsite: string | null;
  chaseCount: number;
  lastChasedAt: string | null;
};

type FinVendor = {
  id: number;
  name: string;
  website: string | null;
  accountsEmail: string | null;
  phone: string | null;
  contactName: string | null;
  portalUrl: string | null;
  invoiceBehaviour: string;
  vatExpectation: string;
  notes: string | null;
  detailsConfirmed: boolean;
};

type FinDocMeta = { id: number; lineId: number; fileName: string; docKind: string; fileMime: string; createdAt: string };

// What a stored document IS — drives whether a line still needs chasing
// (an order confirmation is evidence you bought it, not a VAT invoice).
const DOC_KINDS: Array<{ value: string; label: string }> = [
  { value: "invoice", label: "VAT invoice" },
  { value: "order_confirmation", label: "Order confirmation" },
  { value: "receipt", label: "Receipt" },
  { value: "statement", label: "Statement" },
  { value: "other", label: "Other" },
];

type LinesResponse = {
  lines: FinLine[];
  documentsByLine: Record<number, FinDocMeta[]>;
  suggestionCounts: Record<number, number>;
  vendors: Record<number, FinVendor>;
};

type MatchRow = {
  id: number;
  score: number;
  signals?: number;
  strength?: "weak" | "medium" | "strong" | "very_strong";
  reasons: string[];
  state: string;
  fromAddress: string | null;
  subject: string | null;
  internalDate: string | null;
  hasPdf: boolean;
  snippet?: string | null;
};

async function jsonFetch(url: string, init?: RequestInit) {
  const res = await fetch(url, { credentials: "include", ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

const STATUS_LABELS: Record<string, { label: string; tone: string }> = {
  open: { label: "Needs invoice", tone: "bg-amber-100 text-amber-900" },
  identified: { label: "Identified", tone: "bg-blue-100 text-blue-900" },
  matched: { label: "Document found", tone: "bg-emerald-100 text-emerald-900" },
  done: { label: "Done", tone: "bg-neutral-200 text-neutral-700" },
  not_needed: { label: "Not needed", tone: "bg-neutral-100 text-neutral-500" },
};

const FILTERS = [
  { key: "outstanding", label: "Outstanding" },
  { key: "matched", label: "Document found" },
  { key: "done", label: "Completed" },
  { key: "all", label: "All" },
] as const;

export default function FinancePage() {
  const { state } = useAuth();
  const user = state.status === "authenticated" ? state.user : null;
  const isAdmin = user?.role === "admin";
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("outstanding");
  const [search, setSearch] = useState("");
  const [csvDragOver, setCsvDragOver] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const linesQuery = useQuery<LinesResponse>({
    queryKey: ["/api/finance/lines"],
    queryFn: () => jsonFetch(`${BASE}/api/finance/lines`),
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return jsonFetch(`${BASE}/api/finance/uploads`, { method: "POST", body: form });
    },
    onSuccess: (r: any) => {
      toast({ title: "Statement imported", description: `${r.new} new transaction${r.new === 1 ? "" : "s"}, ${r.duplicates} already known.` });
      queryClient.invalidateQueries({ queryKey: ["/api/finance/lines"] });
    },
    onError: (e: Error) => toast({ title: "Import failed", description: e.message, variant: "destructive" }),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status, statusNote }: { id: number; status: string; statusNote?: string | null }) =>
      jsonFetch(`${BASE}/api/finance/lines/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, statusNote }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/finance/lines"] }),
    onError: (e: Error) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const data = linesQuery.data;
  const filtered = useMemo(() => {
    const lines = data?.lines ?? [];
    let out = lines;
    if (filter === "outstanding") out = lines.filter((l) => l.status === "open" || l.status === "identified");
    else if (filter === "matched") out = lines.filter((l) => l.status === "matched");
    else if (filter === "done") out = lines.filter((l) => l.status === "done" || l.status === "not_needed");
    const q = search.trim().toLowerCase();
    if (q) {
      out = out.filter((l) => {
        const vendor = l.vendorId ? data?.vendors[l.vendorId] : null;
        return [l.descriptor, l.merchant, vendor?.name, l.cardholder, l.cardLast4, l.statusNote, l.amount, l.lineDate]
          .some((v) => v && String(v).toLowerCase().includes(q));
      });
    }
    return out;
  }, [data, filter, search]);

  const outstandingTotal = useMemo(() => {
    const lines = data?.lines ?? [];
    return lines
      .filter((l) => l.status === "open" || l.status === "identified")
      .reduce((s, l) => s + Number(l.amount), 0);
  }, [data]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Finance — outstanding invoices"
        description="Every card transaction that still needs its invoice or receipt. Upload the Capital on Tap export; the app hunts the mailbox and stores what it finds."
      />

      {/* Summary + upload */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-2"><Inbox className="h-4 w-4" /> Outstanding</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {(data?.lines ?? []).filter((l) => l.status === "open" || l.status === "identified").length}
            </div>
            <div className="text-sm text-muted-foreground">£{outstandingTotal.toFixed(2)} awaiting documents</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-2"><FileText className="h-4 w-4" /> Documents found</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{(data?.lines ?? []).filter((l) => l.status === "matched").length}</div>
            <div className="text-sm text-muted-foreground">ready for the bookkeeper</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-2"><Upload className="h-4 w-4" /> Card statement</CardTitle>
          </CardHeader>
          <CardContent
            className={`space-y-2 rounded-b-xl transition-colors ${csvDragOver ? "bg-primary/10 outline-dashed outline-2 outline-primary" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setCsvDragOver(true); }}
            onDragLeave={() => setCsvDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setCsvDragOver(false);
              const f = Array.from(e.dataTransfer.files).find((x) => x.name.toLowerCase().endsWith(".csv"));
              if (f) uploadMutation.mutate(f);
            }}
          >
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadMutation.mutate(f);
                e.target.value = "";
              }}
            />
            <Button onClick={() => fileInput.current?.click()} disabled={uploadMutation.isPending} className="w-full">
              {uploadMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Upload className="h-4 w-4 mr-2" />}
              Upload Capital on Tap CSV
            </Button>
            <p className="text-xs text-muted-foreground">Or drop the file anywhere on this card. Safe to re-upload overlapping exports — duplicates are ignored.</p>
          </CardContent>
        </Card>
      </div>

      {/* Filter tabs + search */}
      <div className="flex gap-2 flex-wrap items-center">
        {FILTERS.map((f) => (
          <Button key={f.key} size="sm" variant={filter === f.key ? "default" : "outline"} onClick={() => setFilter(f.key)}>
            {f.label}
          </Button>
        ))}
        <div className="relative flex-1 min-w-[200px] max-w-sm ml-auto">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search supplier, amount, card, note…"
            className="pl-9"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <XCircle className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Lines */}
      {linesQuery.isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">Nothing here — all caught up.</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((line) => (
            <LineRow
              key={line.id}
              line={line}
              vendor={line.vendorId ? data?.vendors[line.vendorId] ?? null : null}
              docs={data?.documentsByLine[line.id] ?? []}
              suggestionCount={data?.suggestionCounts[line.id] ?? 0}
              expanded={expanded === line.id}
              onToggle={() => setExpanded(expanded === line.id ? null : line.id)}
              onStatus={(status, note) => statusMutation.mutate({ id: line.id, status, statusNote: note })}
            />
          ))}
        </div>
      )}

      {isAdmin && <AdminPanel />}
    </div>
  );
}

function LineRow({
  line,
  vendor,
  docs,
  suggestionCount,
  expanded,
  onToggle,
  onStatus,
}: {
  line: FinLine;
  vendor: FinVendor | null;
  docs: FinDocMeta[];
  suggestionCount: number;
  expanded: boolean;
  onToggle: () => void;
  onStatus: (status: string, note?: string | null) => void;
}) {
  // The pill says what we actually HOLD, not just "Document found": a VAT
  // invoice beats an order confirmation beats the generic label (Graeme,
  // 2026-09-10).
  const baseStatus = STATUS_LABELS[line.status] ?? STATUS_LABELS.open;
  const hasInvoiceDoc = docs.some(d => d.docKind === "invoice");
  const hasConfirmationDoc = docs.some(d => d.docKind === "order_confirmation");
  const status = (line.status === "matched" || line.status === "identified") && hasInvoiceDoc
    ? { label: "Invoice attached", tone: "bg-emerald-100 text-emerald-900" }
    : (line.status === "matched" || line.status === "identified") && hasConfirmationDoc
      ? { label: "Order confirmation attached", tone: "bg-sky-100 text-sky-900" }
      : baseStatus;
  return (
    <Card>
      <button className="w-full text-left" onClick={onToggle}>
        <div className="flex items-center gap-3 px-4 py-3">
          {expanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
          <div className="flex-1 min-w-0">
            <div className="font-medium truncate">{vendor?.name ?? line.merchant ?? line.descriptor}</div>
            <div className="text-xs text-muted-foreground truncate">
              {line.lineDate}
              {line.cardholder ? ` · ${line.cardholder}` : ""}
              {line.cardLast4 ? ` · card ${line.cardLast4}` : ""}
              {line.originalCurrency && line.originalCurrency !== "GBP" ? ` · ${line.originalAmount} ${line.originalCurrency}` : ""}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="font-semibold tabular-nums">£{Number(line.amount).toFixed(2)}</div>
          </div>
          <Badge className={`${status.tone} shrink-0`}>{status.label}</Badge>
          {docs.length > 0 && <Paperclip className="h-4 w-4 text-emerald-600 shrink-0" />}
          {line.chaseCount > 0 && line.status !== "done" && (
            <Badge variant="outline" className="shrink-0 text-amber-700 border-amber-400">chased {line.chaseCount}×</Badge>
          )}
          {suggestionCount > 0 && line.status !== "done" && (
            <Badge variant="outline" className="shrink-0"><Mail className="h-3 w-3 mr-1" />{suggestionCount}</Badge>
          )}
        </div>
      </button>
      {expanded && (
        <CardContent className="border-t pt-4 space-y-4">
          {line.statusNote && <p className="text-sm text-muted-foreground italic">“{line.statusNote}”</p>}
          <DocumentsBlock line={line} docs={docs} />
          {line.status !== "done" && line.status !== "not_needed" && <SupplierFieldsBlock line={line} />}
          {line.status !== "done" && line.status !== "not_needed" && <AddFileControl line={line} />}
          {(line.status === "open" || line.status === "identified" || line.status === "matched") && (
            <SuggestionsBlock lineId={line.id} />
          )}
          {line.status !== "done" && line.status !== "not_needed" && <ChaseSupplierBlock line={line} />}
          {vendor && <VendorBlock vendor={vendor} />}
          <StatusButtons line={line} onStatus={onStatus} />
        </CardContent>
      )}
    </Card>
  );
}

/** Supplier contact + order reference — extracted from an attached order
 *  confirmation or typed by hand. Autosaves on blur with visible state.
 *  The chase button lives further down the card, below the mailbox
 *  suggestions (Graeme, 2026-09-10). */
function SupplierFieldsBlock({ line }: { line: FinLine }) {
  const queryClient = useQueryClient();
  const [orderRef, setOrderRef] = useState(line.orderReference ?? "");
  const [supEmail, setSupEmail] = useState(line.supplierEmail ?? "");
  const [supSite, setSupSite] = useState(line.supplierWebsite ?? "");
  const [fieldState, setFieldState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const saveFields = useMutation({
    mutationFn: () =>
      jsonFetch(`${BASE}/api/finance/lines/${line.id}/supplier`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderReference: orderRef || null,
          supplierEmail: supEmail || null,
          supplierWebsite: supSite || null,
        }),
      }),
    onMutate: () => setFieldState("saving"),
    onSuccess: () => {
      setFieldState("saved");
      queryClient.invalidateQueries({ queryKey: ["/api/finance/lines"] });
    },
    onError: () => setFieldState("error"),
  });
  const dirty =
    (orderRef || "") !== (line.orderReference ?? "") ||
    (supEmail || "") !== (line.supplierEmail ?? "") ||
    (supSite || "") !== (line.supplierWebsite ?? "");
  const onBlur = () => { if (dirty) saveFields.mutate(); };

  return (
    <div>
      <div className="text-sm font-medium mb-2 flex items-center justify-between gap-2">
        <span>Supplier &amp; order</span>
        <span className={`text-xs ${fieldState === "error" ? "text-destructive" : fieldState === "saved" ? "text-emerald-600" : "text-muted-foreground"}`}>
          {fieldState === "saving" && "Saving…"}
          {fieldState === "saved" && "Saved ✓"}
          {fieldState === "error" && "Not saved — check the values"}
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <div>
          <Label className="text-xs">Order number</Label>
          <Input value={orderRef} onChange={(e) => { setOrderRef(e.target.value); setFieldState("idle"); }} onBlur={onBlur} placeholder="e.g. ALX-2214" />
        </div>
        <div>
          <Label className="text-xs">Supplier email</Label>
          <Input value={supEmail} onChange={(e) => { setSupEmail(e.target.value); setFieldState("idle"); }} onBlur={onBlur} placeholder="sales@supplier.co.uk" />
        </div>
        <div>
          <Label className="text-xs">Website</Label>
          <Input value={supSite} onChange={(e) => { setSupSite(e.target.value); setFieldState("idle"); }} onBlur={onBlur} placeholder="https://supplier.co.uk" />
        </div>
      </div>
      {supSite && (
        <a href={supSite} target="_blank" rel="noopener noreferrer" className="inline-block mt-1 text-xs underline text-muted-foreground hover:text-foreground">
          {supSite.replace(/^https?:\/\//, "")}
        </a>
      )}
    </div>
  );
}

/** "Add file" with an up-front kind choice — sits with the other ways of
 *  getting evidence onto the line (just above the mailbox suggestions),
 *  away from the stored-documents list so the two kind dropdowns can't be
 *  confused (Graeme, 2026-09-10). */
function AddFileControl({ line }: { line: FinLine }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [uploadKind, setUploadKind] = useState("invoice");
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      form.append("docKind", uploadKind);
      return jsonFetch(`${BASE}/api/finance/lines/${line.id}/documents`, { method: "POST", body: form });
    },
    onSuccess: () => {
      toast({ title: `${DOC_KINDS.find(k => k.value === uploadKind)?.label ?? "Document"} stored` });
      queryClient.invalidateQueries({ queryKey: ["/api/finance/lines"] });
    },
    onError: (e: Error) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
  });
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-sm font-medium">Attach from this device:</span>
      <select
        value={uploadKind}
        onChange={(e) => setUploadKind(e.target.value)}
        className="h-9 rounded-md border bg-background text-sm px-2"
        title="What the file you're about to add is"
      >
        {DOC_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
      </select>
      <input
        ref={input}
        type="file"
        accept=".pdf,image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          for (const f of Array.from(e.target.files ?? [])) upload.mutate(f);
          e.target.value = "";
        }}
      />
      <Button size="sm" variant="outline" onClick={() => input.current?.click()} disabled={upload.isPending}>
        {upload.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />} Add file
      </Button>
    </div>
  );
}

/** The chase-for-VAT-invoice button + history. Reads the supplier email
 *  from the line (kept fresh by the fields block's autosave). */
function ChaseSupplierBlock({ line }: { line: FinLine }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [chaseOpen, setChaseOpen] = useState(false);
  const supEmail = line.supplierEmail ?? "";
  const orderRef = line.orderReference ?? "";
  const merchant = line.merchant ?? line.descriptor;
  const defaultSubject = `VAT invoice request${orderRef ? ` — order ${orderRef}` : ""}`;
  const defaultMessage =
    `Hi,\n\nPlease could you send us a VAT invoice for ${orderRef ? `order ${orderRef}` : "our recent order"}` +
    ` (${merchant}, £${Number(line.amount).toFixed(2)}, ${line.lineDate})?\n\n` +
    `Please reply to accounts@thecalzonekitchen.co.uk.\n\nThanks,\nThe Calzone Kitchen — Accounts`;
  const [chaseTo, setChaseTo] = useState("");
  const [chaseSubject, setChaseSubject] = useState("");
  const [chaseMessage, setChaseMessage] = useState("");
  const openChase = () => {
    setChaseTo(supEmail);
    setChaseSubject(defaultSubject);
    setChaseMessage(defaultMessage);
    setChaseOpen(true);
  };
  const chase = useMutation({
    mutationFn: () =>
      jsonFetch(`${BASE}/api/finance/lines/${line.id}/chase`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toEmail: chaseTo.trim(), subject: chaseSubject.trim(), message: chaseMessage }),
      }),
    onSuccess: () => {
      toast({ title: "Chase email sent", description: `Sent to ${chaseTo.trim()} — replies go to accounts@, and a copy is in the accounts mailbox.` });
      setChaseOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/finance/lines"] });
    },
    onError: (e: Error) => toast({ title: "Chase not sent", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <Button size="sm" onClick={openChase} disabled={!supEmail.trim()}>
        <Mail className="h-4 w-4 mr-1" /> Chase supplier for VAT invoice
      </Button>
      {!supEmail.trim() && <span className="text-xs text-muted-foreground">Needs a supplier email first (Supplier &amp; order above).</span>}
      {line.chaseCount > 0 && (
        <Badge variant="outline" className="text-amber-700 border-amber-400">
          Chased {line.chaseCount}× — last {line.lastChasedAt ? new Date(line.lastChasedAt).toLocaleDateString("en-GB") : ""}
        </Badge>
      )}

      {chaseOpen && (
        <div className="fixed inset-0 z-[150] bg-black/60 flex items-center justify-center p-4" onClick={() => setChaseOpen(false)}>
          <div className="bg-background rounded-2xl w-full max-w-xl p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="font-semibold">Chase {merchant} for a VAT invoice</div>
            {line.chaseCount > 0 && (
              <p className="text-sm text-amber-700 dark:text-amber-400 font-medium">
                ⚠ Already chased {line.chaseCount}× — last on {line.lastChasedAt ? new Date(line.lastChasedAt).toLocaleDateString("en-GB") : "?"}. Send again?
              </p>
            )}
            <div>
              <Label className="text-xs">To</Label>
              <Input value={chaseTo} onChange={(e) => setChaseTo(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Subject</Label>
              <Input value={chaseSubject} onChange={(e) => setChaseSubject(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Message</Label>
              <textarea
                value={chaseMessage}
                onChange={(e) => setChaseMessage(e.target.value)}
                rows={8}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Sends from The Calzone Kitchen — Accounts; replies and a copy go to accounts@thecalzonekitchen.co.uk.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setChaseOpen(false)}>Cancel</Button>
              <Button size="sm" onClick={() => chase.mutate()} disabled={chase.isPending || !chaseTo.trim() || !chaseSubject.trim() || !chaseMessage.trim()}>
                {chase.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Mail className="h-4 w-4 mr-1" />} Send
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DocumentsBlock({ line, docs }: { line: FinLine; docs: FinDocMeta[] }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState<FinDocMeta | null>(null);
  // Drag-drop assumes the dropped file is the invoice (the overwhelmingly
  // common case) — the per-document selector re-tags in one tap. Choosing a
  // kind up front lives on the Add file control further down the card.
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      form.append("docKind", "invoice");
      return jsonFetch(`${BASE}/api/finance/lines/${line.id}/documents`, { method: "POST", body: form });
    },
    onSuccess: () => {
      toast({ title: "Document stored" });
      queryClient.invalidateQueries({ queryKey: ["/api/finance/lines"] });
    },
    onError: (e: Error) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
  });
  const retag = useMutation({
    mutationFn: ({ id, docKind }: { id: number; docKind: string }) =>
      jsonFetch(`${BASE}/api/finance/documents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docKind }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/finance/lines"] }),
    onError: (e: Error) => toast({ title: "Couldn't change the type", description: e.message, variant: "destructive" }),
  });

  return (
    <div
      className={`rounded-lg transition-colors ${dragOver ? "bg-primary/10 outline-dashed outline-2 outline-primary p-2 -m-2" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        for (const f of Array.from(e.dataTransfer.files)) upload.mutate(f);
      }}
    >
      <div className="text-sm font-medium mb-2">Documents</div>
      {docs.length === 0 && (
        <p className="text-sm text-muted-foreground mb-2">None yet — drop a PDF or photo here, or use Add file below.</p>
      )}
      <div className="flex flex-wrap gap-2">
        {docs.map((d) => (
          <div key={d.id} className="inline-flex items-center rounded border text-sm overflow-hidden">
            <button
              onClick={() => setPreview(d)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 hover:bg-accent"
              title="Preview"
            >
              <FileText className="h-4 w-4" />
              <span className="max-w-[220px] truncate">{d.fileName}</span>
            </button>
            <select
              value={d.docKind}
              onChange={(e) => retag.mutate({ id: d.id, docKind: e.target.value })}
              className="border-l bg-transparent text-xs px-1.5 py-1.5 text-muted-foreground hover:bg-accent cursor-pointer"
              title="What this document is"
            >
              {DOC_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
            <a
              href={`${BASE}/api/finance/documents/${d.id}/file?download=1`}
              className="px-2 py-1.5 border-l hover:bg-accent text-muted-foreground"
              title="Download"
            >
              <Download className="h-4 w-4" />
            </a>
          </div>
        ))}
      </div>

      {/* Same-origin iframe preview — never blob: URLs (the CSP frame-src
          'self' lesson). */}
      {preview && (
        <div className="fixed inset-0 z-[150] bg-black/60 flex items-center justify-center p-4" onClick={() => setPreview(null)}>
          <div className="bg-background rounded-2xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 px-4 py-3 border-b">
              <FileText className="h-4 w-4 shrink-0" />
              <span className="font-medium truncate flex-1">{preview.fileName}</span>
              <Button size="sm" variant="outline" asChild>
                <a href={`${BASE}/api/finance/documents/${preview.id}/file?download=1`}>
                  <Download className="h-4 w-4 mr-1" /> Download
                </a>
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPreview(null)}>
                <XCircle className="h-4 w-4" />
              </Button>
            </div>
            {preview.fileMime.startsWith("image/") ? (
              <div className="flex-1 overflow-auto flex items-center justify-center bg-secondary/30 p-4">
                <img src={`${BASE}/api/finance/documents/${preview.id}/file`} alt={preview.fileName} className="max-w-full max-h-full object-contain" />
              </div>
            ) : (
              <iframe
                src={`${BASE}/api/finance/documents/${preview.id}/file`}
                title={preview.fileName}
                className="flex-1 w-full border-0"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SuggestionsBlock({ lineId }: { lineId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const matches = useQuery<MatchRow[]>({
    queryKey: ["/api/finance/lines", lineId, "matches"],
    queryFn: () => jsonFetch(`${BASE}/api/finance/lines/${lineId}/matches`),
  });
  // What each suggested email IS, chosen before attaching (defaults: a PDF
  // is presumed the invoice, a bare email an order confirmation).
  const [attachKinds, setAttachKinds] = useState<Record<number, string>>({});
  const decide = useMutation({
    mutationFn: ({ id, action, docKind }: { id: number; action: "confirm" | "reject"; docKind?: string }) =>
      jsonFetch(`${BASE}/api/finance/matches/${id}/${action}`, {
        method: "POST",
        ...(docKind ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ docKind }) } : {}),
      }),
    onSuccess: (_r, vars) => {
      toast({
        title: vars.action === "confirm"
          ? `Attached as ${DOC_KINDS.find(k => k.value === vars.docKind)?.label?.toLowerCase() ?? "document"}`
          : "Suggestion dismissed",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/finance/lines"] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const open = (matches.data ?? []).filter((m) => m.state === "suggested");
  const [expandedMatch, setExpandedMatch] = useState<number | null>(null);
  const [fullEmail, setFullEmail] = useState<{ matchId: number; loading: boolean; error?: string; text?: string; from?: string; attachments?: Array<{ filename: string }> } | null>(null);
  const openFullEmail = async (matchId: number) => {
    setFullEmail({ matchId, loading: true });
    try {
      const body = await jsonFetch(`${BASE}/api/finance/matches/${matchId}/email`);
      setFullEmail({ matchId, loading: false, text: body.text, from: body.from, attachments: body.attachments });
    } catch (e) {
      setFullEmail({ matchId, loading: false, error: (e as Error).message });
    }
  };
  if (matches.isLoading) return <div className="text-sm text-muted-foreground">Checking mailbox suggestions…</div>;
  if (open.length === 0) return null;

  return (
    <div>
      <div className="text-sm font-medium mb-2">Found in the mailbox — is one of these it?</div>
      <div className="space-y-2">
        {open.map((m) => (
          <div key={m.id} className="rounded border px-3 py-2">
          <div className="flex items-center gap-3">
            <button onClick={() => setExpandedMatch(expandedMatch === m.id ? null : m.id)} className="shrink-0 text-muted-foreground hover:text-foreground" aria-label="Show email content">
              {expandedMatch === m.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
            <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setExpandedMatch(expandedMatch === m.id ? null : m.id)}>
              <div className="text-sm truncate">{m.subject ?? "(no subject)"}</div>
              <div className="text-xs text-muted-foreground truncate">
                {m.fromAddress} · {m.internalDate ? new Date(m.internalDate).toLocaleDateString("en-GB") : ""}
                {m.hasPdf ? " · PDF attached" : ""} · {m.reasons.join("; ")}
              </div>
            </div>
            <Badge
              className={`shrink-0 ${
                m.strength === "very_strong" ? "bg-emerald-600 text-white"
                : m.strength === "strong" ? "bg-emerald-100 text-emerald-900"
                : m.strength === "medium" ? "bg-amber-100 text-amber-900"
                : "bg-neutral-100 text-neutral-600"
              }`}
            >
              {m.strength === "very_strong" ? "Very strong" : m.strength === "strong" ? "Strong" : m.strength === "medium" ? "Medium" : "Weak"}
            </Badge>
            <select
              value={attachKinds[m.id] ?? (m.hasPdf ? "invoice" : "order_confirmation")}
              onChange={(e) => setAttachKinds(prev => ({ ...prev, [m.id]: e.target.value }))}
              className="h-8 shrink-0 rounded-md border bg-background text-xs px-1.5"
              title="What this email is"
            >
              {DOC_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
            <Button
              size="sm"
              onClick={() => decide.mutate({ id: m.id, action: "confirm", docKind: attachKinds[m.id] ?? (m.hasPdf ? "invoice" : "order_confirmation") })}
              disabled={decide.isPending}
            >
              <CheckCircle2 className="h-4 w-4 mr-1" /> Attach
            </Button>
            <Button size="sm" variant="ghost" onClick={() => decide.mutate({ id: m.id, action: "reject" })} disabled={decide.isPending}>
              <XCircle className="h-4 w-4" />
            </Button>
          </div>
          {expandedMatch === m.id && (
            <div className="mt-2 ml-11 rounded bg-secondary/40 p-3 text-sm space-y-2">
              {m.snippet ? (
                <p className="whitespace-pre-wrap text-foreground/90">{m.snippet}{m.snippet.length >= 400 ? "…" : ""}</p>
              ) : (
                <p className="text-muted-foreground italic">No summary stored for this email yet — read the full email below.</p>
              )}
              <Button size="sm" variant="outline" onClick={() => openFullEmail(m.id)}>
                <Mail className="h-4 w-4 mr-1" /> Read the full email
              </Button>
            </div>
          )}
          </div>
        ))}
      </div>

      {fullEmail && (
        <div className="fixed inset-0 z-[150] bg-black/60 flex items-center justify-center p-4" onClick={() => setFullEmail(null)}>
          <div className="bg-background rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 px-4 py-3 border-b">
              <Mail className="h-4 w-4 shrink-0" />
              <span className="font-medium truncate flex-1">{fullEmail.from ?? "Email"}</span>
              <Button size="sm" variant="ghost" onClick={() => setFullEmail(null)}><XCircle className="h-4 w-4" /></Button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              {fullEmail.loading ? (
                <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Fetching from the mailbox…</div>
              ) : fullEmail.error ? (
                <p className="text-sm text-destructive">{fullEmail.error}</p>
              ) : (
                <>
                  {(fullEmail.attachments?.length ?? 0) > 0 && (
                    <p className="text-xs text-muted-foreground mb-3">
                      Attachments: {fullEmail.attachments!.map((a) => a.filename).join(", ")}
                    </p>
                  )}
                  <pre className="whitespace-pre-wrap text-sm font-sans">{fullEmail.text || "(no text content)"}</pre>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function VendorBlock({ vendor }: { vendor: FinVendor }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    website: vendor.website ?? "",
    accountsEmail: vendor.accountsEmail ?? "",
    phone: vendor.phone ?? "",
    contactName: vendor.contactName ?? "",
    portalUrl: vendor.portalUrl ?? "",
    notes: vendor.notes ?? "",
  });
  const save = useMutation({
    mutationFn: () =>
      jsonFetch(`${BASE}/api/finance/vendors/${vendor.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim() === "" ? null : v.trim()]))
        ),
      }),
    onSuccess: () => {
      toast({ title: "Supplier details saved" });
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: ["/api/finance/lines"] });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const known = [
    vendor.website && ["Website", vendor.website],
    vendor.accountsEmail && ["Accounts email", vendor.accountsEmail],
    vendor.phone && ["Phone", vendor.phone],
    vendor.contactName && ["Contact", vendor.contactName],
    vendor.portalUrl && ["Invoice portal", vendor.portalUrl],
    vendor.notes && ["Notes", vendor.notes],
  ].filter(Boolean) as [string, string][];

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <div className="text-sm font-medium">Supplier: {vendor.name}</div>
        {!vendor.detailsConfirmed && known.length > 0 && <Badge variant="outline">estimates</Badge>}
        <Button size="sm" variant="ghost" onClick={() => setEditing(!editing)}>{editing ? "Cancel" : "Edit"}</Button>
      </div>
      {!editing ? (
        known.length === 0 ? (
          <p className="text-sm text-muted-foreground">No supplier details yet — click Edit to add what you know.</p>
        ) : (
          <dl className="text-sm grid gap-x-6 gap-y-1 sm:grid-cols-2">
            {known.map(([k, v]) => (
              <div key={k} className="flex gap-2 min-w-0">
                <dt className="text-muted-foreground shrink-0">{k}:</dt>
                <dd className="truncate">{/^https?:\/\//.test(v) ? <a className="underline" href={v} target="_blank" rel="noreferrer">{v}</a> : v}</dd>
              </div>
            ))}
          </dl>
        )
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ["website", "Website"],
              ["accountsEmail", "Accounts email"],
              ["phone", "Phone"],
              ["contactName", "Contact name"],
              ["portalUrl", "Invoice portal URL"],
            ] as const
          ).map(([key, label]) => (
            <div key={key}>
              <Label className="text-xs">{label}</Label>
              <Input value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
            </div>
          ))}
          <div className="sm:col-span-2">
            <Label className="text-xs">Notes</Label>
            <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
          </div>
          <div className="sm:col-span-2">
            <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />} Save supplier
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusButtons({ line, onStatus }: { line: FinLine; onStatus: (status: string, note?: string | null) => void }) {
  const [note, setNote] = useState(line.statusNote ?? "");
  const isClosed = line.status === "done" || line.status === "not_needed";
  return (
    <div className="space-y-2 border-t pt-3">
      <Label className="text-xs">Note (what happened / where things stand)</Label>
      <div className="flex gap-2 flex-wrap items-center">
        <Input className="flex-1 min-w-[220px]" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. posted to factory equipment, invoice attached" />
        {!isClosed ? (
          <>
            <Button size="sm" onClick={() => onStatus("done", note || null)}>
              <CheckCircle2 className="h-4 w-4 mr-1" /> Mark done
            </Button>
            <Button size="sm" variant="outline" onClick={() => onStatus("not_needed", note || null)}>
              Not needed
            </Button>
            {note !== (line.statusNote ?? "") && (
              <Button size="sm" variant="ghost" onClick={() => onStatus(line.status, note || null)}>Save note</Button>
            )}
          </>
        ) : (
          <Button size="sm" variant="outline" onClick={() => onStatus("open", note || null)}>Reopen</Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Admin panel: mailbox connection + finance access

function AdminPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const mailbox = useQuery<any>({
    queryKey: ["/api/finance/mailbox"],
    queryFn: () => jsonFetch(`${BASE}/api/finance/mailbox`),
  });
  const users = useQuery<any[]>({
    queryKey: ["/api/finance/access"],
    queryFn: () => jsonFetch(`${BASE}/api/finance/access`),
  });

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [scanSince, setScanSince] = useState("");
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");

  const saveMailbox = useMutation({
    mutationFn: () =>
      jsonFetch(`${BASE}/api/finance/mailbox`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailAddress: email, password, ...(scanSince ? { scanSince } : {}) }),
      }),
    onSuccess: () => {
      toast({ title: "Mailbox saved", description: "Password stored encrypted. Run a sync to start indexing." });
      setPassword("");
      queryClient.invalidateQueries({ queryKey: ["/api/finance/mailbox"] });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const syncNow = useMutation({
    mutationFn: () => jsonFetch(`${BASE}/api/finance/mailbox/sync`, { method: "POST" }),
    onSuccess: () => {
      toast({
        title: "Sync started",
        description: "Running in the background — a first backfill can take a while. Check back here; suggestions appear as it indexes.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/finance/mailbox"] });
    },
    onError: (e: Error) => toast({ title: "Sync failed to start", description: e.message, variant: "destructive" }),
  });

  const qbo = useQuery<any>({
    queryKey: ["/api/finance/qbo/status"],
    queryFn: () => jsonFetch(`${BASE}/api/finance/qbo/status`),
  });
  const qboSync = useMutation({
    mutationFn: () => jsonFetch(`${BASE}/api/finance/qbo/sync`, { method: "POST" }),
    onSuccess: () => {
      toast({ title: "QuickBooks sync started", description: "Posted transactions will close their card lines as it runs." });
      queryClient.invalidateQueries({ queryKey: ["/api/finance/qbo/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/finance/lines"] });
    },
    onError: (e: Error) => toast({ title: "Sync failed to start", description: e.message, variant: "destructive" }),
  });

  // Auto-import: which QBO account's purchases become lines automatically
  // (the Capital on Tap card — replaces the CSV upload).
  const qboAccounts = useQuery<{ accounts: Array<{ name: string; purchases: number }> }>({
    queryKey: ["/api/finance/qbo/accounts"],
    queryFn: () => jsonFetch(`${BASE}/api/finance/qbo/accounts`),
    enabled: Boolean(qbo.data?.connected),
  });
  const [autoImportPick, setAutoImportPick] = useState("");
  useEffect(() => {
    setAutoImportPick(qbo.data?.autoImportAccount ?? "");
  }, [qbo.data?.autoImportAccount]);
  const saveAutoImport = useMutation({
    mutationFn: (account: string | null) =>
      jsonFetch(`${BASE}/api/finance/qbo/auto-import`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account }),
      }) as Promise<{ imported: number }>,
    onSuccess: (d, account) => {
      toast({
        title: account ? "Auto-import on" : "Auto-import off",
        description: account ? `${d.imported} line${d.imported === 1 ? "" : "s"} imported now; new card purchases arrive with every hourly sync.` : "Card lines come from CSV uploads again.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/finance/qbo/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/finance/lines"] });
    },
    onError: (e: Error) => toast({ title: "Couldn't save", description: e.message, variant: "destructive" }),
  });

  const scanRange = useMutation({
    mutationFn: () =>
      jsonFetch(`${BASE}/api/finance/mailbox/scan-range`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: rangeFrom, ...(rangeTo ? { to: rangeTo } : {}) }),
      }),
    onSuccess: () => {
      toast({ title: "Period scan started", description: "Running in the background — suggestions appear as it indexes that period." });
      queryClient.invalidateQueries({ queryKey: ["/api/finance/mailbox"] });
    },
    onError: (e: Error) => toast({ title: "Scan failed to start", description: e.message, variant: "destructive" }),
  });

  // Invite an external accountant: viewer role + bookkeeper flag on the
  // invite itself, so on accepting they land straight in the finance-only
  // view — no employment contract, no onboarding gate, no lean curriculum
  // (Graeme, 2026-09-09). Lives here because Settings is charter-frozen
  // and finance access is managed on this page anyway.
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteFallbackUrl, setInviteFallbackUrl] = useState<string | null>(null);
  const inviteAccountant = useMutation({
    mutationFn: async (): Promise<{ emailSent: boolean; inviteUrl?: string }> =>
      jsonFetch(`${BASE}/api/auth/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim(), role: "viewer", isBookkeeper: true }),
      }),
    onSuccess: (r) => {
      setInviteFallbackUrl(r.emailSent ? null : r.inviteUrl ?? null);
      toast(r.emailSent
        ? { title: "Invite sent", description: `${inviteEmail.trim()} has 48 hours to accept — they'll land straight on this page.` }
        : { title: "Invite created — email didn't send", description: "Copy the link below and send it to them yourself.", variant: "destructive" });
      setInviteEmail("");
      queryClient.invalidateQueries({ queryKey: ["/api/finance/access"] });
    },
    onError: (e: Error) => toast({ title: "Couldn't create the invite", description: e.message, variant: "destructive" }),
  });

  const toggleAccess = useMutation({
    mutationFn: ({ userId, isBookkeeper }: { userId: number; isBookkeeper: boolean }) =>
      jsonFetch(`${BASE}/api/finance/access/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isBookkeeper }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/finance/access"] }),
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Banknote className="h-4 w-4" /> Admin — connections & access</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <div className="text-sm font-medium mb-2 flex items-center gap-2"><Mail className="h-4 w-4" /> Mailbox (one.com IMAP)</div>
          {mailbox.data ? (
            <p className="text-sm text-muted-foreground mb-2">
              Connected: <span className="font-medium">{mailbox.data.emailAddress}</span>
              {mailbox.data.lastSyncAt ? ` · last synced ${new Date(mailbox.data.lastSyncAt).toLocaleString("en-GB")}` : " · never synced"}
              {mailbox.data.lastError && <span className="text-destructive"> · {mailbox.data.lastError}</span>}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground mb-2">Not connected yet. Enter the mailbox and its password (stored encrypted; the app only ever reads).</p>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label className="text-xs">Email address</Label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="graeme@thecalzonekitchen.co.uk" autoComplete="off" />
            </div>
            <div>
              <Label className="text-xs">Mailbox password</Label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            </div>
            <div>
              <Label className="text-xs">Scan mail since (backfill)</Label>
              <Input type="date" value={scanSince} onChange={(e) => setScanSince(e.target.value)} />
            </div>
          </div>
          <div className="flex gap-2 mt-3 flex-wrap">
            <Button size="sm" onClick={() => saveMailbox.mutate()} disabled={saveMailbox.isPending || !email || !password}>
              {saveMailbox.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />} Save connection
            </Button>
            <Button size="sm" variant="outline" onClick={() => syncNow.mutate()} disabled={syncNow.isPending || !mailbox.data}>
              {syncNow.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />} Sync now
            </Button>
          </div>
          <div className="mt-4 pt-3 border-t">
            <Label className="text-xs">Scan a specific period (e.g. June, to cover old transactions)</Label>
            <div className="flex gap-2 mt-1 flex-wrap items-center">
              <Input type="date" value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} className="w-40" />
              <span className="text-muted-foreground text-sm">to</span>
              <Input type="date" value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} className="w-40" />
              <Button size="sm" variant="outline" onClick={() => scanRange.mutate()} disabled={scanRange.isPending || !rangeFrom || !mailbox.data}>
                {scanRange.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Mail className="h-4 w-4 mr-1" />} Scan this period
              </Button>
            </div>
          </div>
        </div>

        <div>
          <div className="text-sm font-medium mb-2 flex items-center gap-2"><Banknote className="h-4 w-4" /> QuickBooks (read-only)</div>
          {!qbo.data?.configured ? (
            <p className="text-sm text-muted-foreground">
              Needs the Intuit app credentials first: create an app at developer.intuit.com
              (Accounting scope), set its redirect URI to <code className="text-xs bg-secondary px-1 rounded">{`${window.location.origin}/api/finance/qbo/callback`}</code>,
              then add <code className="text-xs bg-secondary px-1 rounded">QBO_CLIENT_ID</code> and <code className="text-xs bg-secondary px-1 rounded">QBO_CLIENT_SECRET</code> to the server environment.
            </p>
          ) : qbo.data?.connected ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Connected to company {qbo.data.realmId}
                {qbo.data.lastSyncAt ? ` · last synced ${new Date(qbo.data.lastSyncAt).toLocaleString("en-GB")}` : " · never synced"}
                {typeof qbo.data.mirroredTxns === "number" ? ` · ${qbo.data.mirroredTxns} posted transactions mirrored` : ""}
                {qbo.data.lastError && <span className="text-destructive"> · {qbo.data.lastError}</span>}
              </p>
              <Button size="sm" variant="outline" onClick={() => qboSync.mutate()} disabled={qboSync.isPending}>
                {qboSync.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />} Sync now
              </Button>

              {/* Auto-import: purchases from one QBO account (the Capital on
                  Tap card) become lines here automatically — the CSV
                  upload's replacement (Graeme, 2026-09-12). Freshness note:
                  QuickBooks' API only shows ACCEPTED transactions, so a
                  card purchase appears once it has left the bank feed's
                  "For review" (or instantly, when CoT posts it itself). */}
              <div className="pt-3 border-t border-border space-y-1.5">
                <div className="text-sm font-medium">Auto-import card transactions</div>
                <p className="text-xs text-muted-foreground">
                  Purchases paid from the chosen QuickBooks account appear here as lines
                  automatically — no more CSV exports. Only transactions from the switch-on
                  date forward are imported{qbo.data.autoImportSince ? ` (importing since ${new Date(`${qbo.data.autoImportSince}T00:00:00`).toLocaleDateString("en-GB")})` : ""}.
                  A purchase shows up once it's been accepted into QuickBooks from the bank feed.
                </p>
                <div className="flex gap-2 items-center flex-wrap">
                  <select
                    className="px-3 py-2 bg-background border border-border rounded-lg text-sm min-w-[220px]"
                    value={autoImportPick}
                    onChange={(e) => setAutoImportPick(e.target.value)}
                  >
                    <option value="">Off — don't auto-import</option>
                    {(qboAccounts.data?.accounts ?? []).map((a: { name: string; purchases: number }) => (
                      <option key={a.name} value={a.name}>{a.name} ({a.purchases} purchases)</option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    onClick={() => saveAutoImport.mutate(autoImportPick || null)}
                    disabled={saveAutoImport.isPending || autoImportPick === (qbo.data.autoImportAccount ?? "")}
                  >
                    {saveAutoImport.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null} Save
                  </Button>
                  {qbo.data.autoImportAccount && (
                    <span className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">
                      Importing from “{qbo.data.autoImportAccount}”
                    </span>
                  )}
                </div>
                {(qboAccounts.data?.accounts ?? []).length === 0 && (
                  <p className="text-xs text-muted-foreground">No payment accounts seen yet — run a sync first; account names arrive with the next mirrored purchases.</p>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Not connected. Connecting lets the app see which transactions are already
                posted and close their card lines automatically — read-only, it never
                changes anything in QuickBooks.
              </p>
              <Button size="sm" asChild>
                <a href={`${BASE}/api/finance/qbo/connect`}>Connect QuickBooks</a>
              </Button>
            </div>
          )}
        </div>

        <div>
          <div className="text-sm font-medium mb-2">Accountants — who can see finance</div>
          <p className="text-xs text-muted-foreground mb-2">
            Switched-on users get an accountant view: this page plus Deliveries, and
            nothing of the production app — no onboarding, contracts or lean lessons.
            Admins always see everything.
          </p>
          <div className="flex gap-2 mb-3 flex-wrap items-end">
            <div className="flex-1 min-w-[220px]">
              <Label className="text-xs">Invite an accountant by email</Label>
              <Input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="accounts@yourbookkeeper.co.uk"
                autoComplete="off"
              />
            </div>
            <Button
              size="sm"
              onClick={() => inviteAccountant.mutate()}
              disabled={inviteAccountant.isPending || !inviteEmail.trim()}
            >
              {inviteAccountant.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />} Send invite
            </Button>
          </div>
          {inviteFallbackUrl && (
            <p className="text-xs text-amber-700 dark:text-amber-400 mb-3 break-all">
              Email failed to send — give them this link instead (valid 48h):{" "}
              <span className="font-mono">{inviteFallbackUrl}</span>
            </p>
          )}
          <div className="space-y-1">
            {(users.data ?? []).map((u) => (
              <div key={u.id} className="flex items-center justify-between rounded border px-3 py-2">
                <div className="text-sm">
                  {u.name} <span className="text-muted-foreground">({u.email}{u.role === "admin" ? " · admin, always has access" : ""})</span>
                </div>
                {u.role !== "admin" && (
                  <Switch
                    checked={u.isBookkeeper}
                    onCheckedChange={(v) => toggleAccess.mutate({ userId: u.id, isBookkeeper: v })}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
