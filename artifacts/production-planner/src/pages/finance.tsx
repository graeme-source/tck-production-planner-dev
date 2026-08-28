import { useMemo, useRef, useState } from "react";
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
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileText,
  Inbox,
  Loader2,
  Mail,
  Paperclip,
  RefreshCw,
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

type LinesResponse = {
  lines: FinLine[];
  documentsByLine: Record<number, FinDocMeta[]>;
  suggestionCounts: Record<number, number>;
  vendors: Record<number, FinVendor>;
};

type MatchRow = {
  id: number;
  score: number;
  reasons: string[];
  state: string;
  fromAddress: string | null;
  subject: string | null;
  internalDate: string | null;
  hasPdf: boolean;
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
    if (filter === "all") return lines;
    if (filter === "outstanding") return lines.filter((l) => l.status === "open" || l.status === "identified");
    if (filter === "matched") return lines.filter((l) => l.status === "matched");
    return lines.filter((l) => l.status === "done" || l.status === "not_needed");
  }, [data, filter]);

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
          <CardContent className="space-y-2">
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
            <p className="text-xs text-muted-foreground">Safe to re-upload overlapping exports — duplicates are ignored.</p>
          </CardContent>
        </Card>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {FILTERS.map((f) => (
          <Button key={f.key} size="sm" variant={filter === f.key ? "default" : "outline"} onClick={() => setFilter(f.key)}>
            {f.label}
          </Button>
        ))}
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
  const status = STATUS_LABELS[line.status] ?? STATUS_LABELS.open;
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
          {suggestionCount > 0 && line.status !== "done" && (
            <Badge variant="outline" className="shrink-0"><Mail className="h-3 w-3 mr-1" />{suggestionCount}</Badge>
          )}
        </div>
      </button>
      {expanded && (
        <CardContent className="border-t pt-4 space-y-4">
          {line.statusNote && <p className="text-sm text-muted-foreground italic">“{line.statusNote}”</p>}
          <DocumentsBlock line={line} docs={docs} />
          {(line.status === "open" || line.status === "identified" || line.status === "matched") && (
            <SuggestionsBlock lineId={line.id} />
          )}
          {vendor && <VendorBlock vendor={vendor} />}
          <StatusButtons line={line} onStatus={onStatus} />
        </CardContent>
      )}
    </Card>
  );
}

function DocumentsBlock({ line, docs }: { line: FinLine; docs: FinDocMeta[] }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return jsonFetch(`${BASE}/api/finance/lines/${line.id}/documents`, { method: "POST", body: form });
    },
    onSuccess: () => {
      toast({ title: "Document stored" });
      queryClient.invalidateQueries({ queryKey: ["/api/finance/lines"] });
    },
    onError: (e: Error) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div>
      <div className="text-sm font-medium mb-2">Documents</div>
      {docs.length === 0 && <p className="text-sm text-muted-foreground mb-2">None yet.</p>}
      <div className="flex flex-wrap gap-2">
        {docs.map((d) => (
          <a
            key={d.id}
            href={`${BASE}/api/finance/documents/${d.id}/file`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-sm hover:bg-accent"
          >
            <FileText className="h-4 w-4" />
            <span className="max-w-[220px] truncate">{d.fileName}</span>
          </a>
        ))}
        <input
          ref={input}
          type="file"
          accept=".pdf,image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload.mutate(f);
            e.target.value = "";
          }}
        />
        <Button size="sm" variant="outline" onClick={() => input.current?.click()} disabled={upload.isPending}>
          {upload.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />} Add file
        </Button>
      </div>
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
  const decide = useMutation({
    mutationFn: ({ id, action }: { id: number; action: "confirm" | "reject" }) =>
      jsonFetch(`${BASE}/api/finance/matches/${id}/${action}`, { method: "POST" }),
    onSuccess: (_r, vars) => {
      toast({ title: vars.action === "confirm" ? "Email attached as document" : "Suggestion dismissed" });
      queryClient.invalidateQueries({ queryKey: ["/api/finance/lines"] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const open = (matches.data ?? []).filter((m) => m.state === "suggested");
  if (matches.isLoading) return <div className="text-sm text-muted-foreground">Checking mailbox suggestions…</div>;
  if (open.length === 0) return null;

  return (
    <div>
      <div className="text-sm font-medium mb-2">Found in the mailbox — is one of these it?</div>
      <div className="space-y-2">
        {open.map((m) => (
          <div key={m.id} className="flex items-center gap-3 rounded border px-3 py-2">
            <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="flex-1 min-w-0">
              <div className="text-sm truncate">{m.subject ?? "(no subject)"}</div>
              <div className="text-xs text-muted-foreground truncate">
                {m.fromAddress} · {m.internalDate ? new Date(m.internalDate).toLocaleDateString("en-GB") : ""}
                {m.hasPdf ? " · PDF attached" : ""} · {m.reasons.join("; ")}
              </div>
            </div>
            <Badge variant="outline" className="shrink-0">{m.score}</Badge>
            <Button size="sm" onClick={() => decide.mutate({ id: m.id, action: "confirm" })} disabled={decide.isPending}>
              <CheckCircle2 className="h-4 w-4 mr-1" /> Attach
            </Button>
            <Button size="sm" variant="ghost" onClick={() => decide.mutate({ id: m.id, action: "reject" })} disabled={decide.isPending}>
              <XCircle className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
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
    onSuccess: (r: any) => {
      if (r.error) toast({ title: "Sync problem", description: r.error, variant: "destructive" });
      else toast({ title: "Mailbox synced", description: `Scanned ${r.scanned}, indexed ${r.indexed}, suggestions for ${r.suggestionsRefreshed} lines.` });
      queryClient.invalidateQueries({ queryKey: ["/api/finance/mailbox"] });
      queryClient.invalidateQueries({ queryKey: ["/api/finance/lines"] });
    },
    onError: (e: Error) => toast({ title: "Sync failed", description: e.message, variant: "destructive" }),
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
          <div className="flex gap-2 mt-3">
            <Button size="sm" onClick={() => saveMailbox.mutate()} disabled={saveMailbox.isPending || !email || !password}>
              {saveMailbox.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />} Save connection
            </Button>
            <Button size="sm" variant="outline" onClick={() => syncNow.mutate()} disabled={syncNow.isPending || !mailbox.data}>
              {syncNow.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />} Sync now
            </Button>
          </div>
        </div>

        <div>
          <div className="text-sm font-medium mb-2">Who can see finance</div>
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
