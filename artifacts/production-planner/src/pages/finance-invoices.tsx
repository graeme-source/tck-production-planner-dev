/**
 * Finance → Invoices: the library of every invoice we hold (Graeme,
 * 2026-11-03). Drop zips, PDFs or photos: the page unpacks zips itself and
 * sends the PDFs and images up in small batches (any size, nothing times
 * out, progress shown), skipping files already held. Each is read for
 * supplier, date, number and amounts. Organised by financial year (April →
 * March) and month; the same invoice arriving as a different file is set
 * aside as a possible duplicate. Every action is kept with who and when.
 */
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { unzipSync } from "fflate";
import {
  CalendarDays, ChevronDown, ChevronRight, Copy, Download, ExternalLink, FileArchive, FileText, History,
  Image as ImageIcon, Loader2, RefreshCw, Search as SearchIcon, Upload, X, XCircle,
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
  uploadId: number | null;
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
  duplicateOfId: number | null;
  duplicateOf: { supplierName: string | null; invoiceNumber: string | null; invoiceDate: string | null; fileName: string; sourcePath: string | null } | null;
  createdAt: string;
  financialYear: string | null;
};

type YearCount = { fy: string; n: number; total: string };
type ListResponse = { invoices: Invoice[]; years: YearCount[]; duplicateCount: number; pendingReads: number };

type UploadRow = {
  id: number; fileName: string; filesFound: number; duplicates: number; skipped: string[]; status: string;
  createdAt: string; uploadedByName: string | null; added: number; lastAddedAt: string | null;
};

type FinEvent = {
  id: number;
  entityType: "invoice" | "line";
  action: string;
  detail: Record<string, any>;
  userName: string | null;
  createdAt: string;
};

const KINDS: Record<string, string> = { invoice: "Invoice", receipt: "Receipt", credit_note: "Credit note", statement: "Statement", other: "Other" };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const fmtDate = (iso: string | null) => iso ? new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";
const fmtWhen = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const money = (v: string | number | null, cur = "GBP") => v == null ? "—" : `${cur === "GBP" ? "£" : `${cur} `}${Number(v).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const periodNo = (iso: string) => ((Number(iso.slice(5, 7)) + 8) % 12) + 1;

// ---------------------------------------------------------------------------
// Uploading: unpack in the browser, skip what's held, send in small batches.

const INVOICE_EXT = /\.(pdf|jpe?g|png|webp|gif|heic|heif)$/i;
const MIME: Record<string, string> = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", heic: "image/heic", heif: "image/heif" };
const isJunk = (path: string) => path.split("/").some((p) => p === "__MACOSX" || p.startsWith(".")) || /(^|\/)(Thumbs\.db|desktop\.ini)$/i.test(path);

type Prepared = { path: string; name: string; mime: string; bytes: Uint8Array; sha: string };

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Every PDF/photo in one dropped file (a zip, or a PDF/photo itself). */
async function unpack(file: File, skipped: string[]): Promise<Prepared[]> {
  const out: Prepared[] = [];
  const add = async (path: string, bytes: Uint8Array) => {
    const name = path.split("/").pop() || path;
    const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
    if (bytes.length === 0) { skipped.push(`${path} (empty file)`); return; }
    out.push({ path, name, mime: MIME[ext], bytes, sha: await sha256Hex(bytes) });
  };
  const walkZip = async (bytes: Uint8Array, prefix: string, depth: number) => {
    let entries: Record<string, Uint8Array>;
    try { entries = unzipSync(bytes); } catch { skipped.push(`${prefix || file.name} (couldn't be opened — is it a real .zip?)`); return; }
    for (const [p, b] of Object.entries(entries)) {
      if (p.endsWith("/") || isJunk(p)) continue;
      const path = prefix + p;
      if (/\.zip$/i.test(p)) {
        if (depth >= 1) skipped.push(`${path} (zip inside a zip inside a zip)`);
        else await walkZip(b, `${path}/`, depth + 1);
      } else if (INVOICE_EXT.test(p)) await add(path, b);
      else skipped.push(`${path} (not a PDF or photo)`);
    }
  };
  if (/\.zip$/i.test(file.name)) await walkZip(new Uint8Array(await file.arrayBuffer()), `${file.name}/`, 0);
  else if (INVOICE_EXT.test(file.name)) await add(file.name, new Uint8Array(await file.arrayBuffer()));
  else skipped.push(`${file.name} (not a zip, PDF or photo)`);
  return out;
}

type Progress = { phase: "unpacking" | "checking" | "sending" | "done" | "stopped"; done: number; total: number; added: number; held: number; skipped: string[]; error?: string };

/** One drop = one upload batch. Zips go one at a time to keep memory down. */
async function uploadAll(files: File[], onProgress: (p: Progress) => void): Promise<Progress> {
  const p: Progress = { phase: "unpacking", done: 0, total: 0, added: 0, held: 0, skipped: [] };
  onProgress({ ...p });
  const batch = await jsonFetch(`${BASE}/api/finance/invoices/uploads`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: files.map((f) => f.name).join(", ").slice(0, 500), filesFound: 0 }),
  });
  const seen = new Set<string>();
  try {
    for (const file of files) {
      p.phase = "unpacking"; onProgress({ ...p });
      const items = (await unpack(file, p.skipped)).filter((i) => {
        if (seen.has(i.sha)) { p.held++; return false; } // the same file twice in this drop
        seen.add(i.sha); return true;
      });
      p.total += items.length;
      p.phase = "checking"; onProgress({ ...p });
      const existing = new Set<string>();
      for (let i = 0; i < items.length; i += 1000) {
        const r = await jsonFetch(`${BASE}/api/finance/invoices/check`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hashes: items.slice(i, i + 1000).map((x) => x.sha) }),
        });
        (r.existing as string[]).forEach((h) => existing.add(h));
      }
      const toSend = items.filter((i) => !existing.has(i.sha));
      p.held += items.length - toSend.length;
      p.done += items.length - toSend.length;
      p.phase = "sending"; onProgress({ ...p });
      // Small batches: ~20 files or ~12 MB, whichever first; each retried twice.
      for (let i = 0; i < toSend.length;) {
        const chunk: Prepared[] = [];
        let size = 0;
        while (i < toSend.length && chunk.length < 20 && (chunk.length === 0 || size + toSend[i].bytes.length < 12 * 1024 * 1024)) {
          size += toSend[i].bytes.length; chunk.push(toSend[i]); i++;
        }
        const form = new FormData();
        form.append("uploadId", String(batch.id));
        form.append("paths", JSON.stringify(chunk.map((c) => c.path)));
        chunk.forEach((c) => form.append("files", new Blob([c.bytes as Uint8Array<ArrayBuffer>], { type: c.mime }), c.name));
        let r: any; let lastErr: unknown;
        for (let attempt = 0; attempt < 3 && !r; attempt++) {
          try { r = await jsonFetch(`${BASE}/api/finance/invoices/upload`, { method: "POST", body: form }); }
          catch (e) { lastErr = e; await new Promise((res) => setTimeout(res, 1500 * (attempt + 1))); }
        }
        if (!r) throw lastErr;
        p.added += r.filesAdded; p.held += r.duplicates; p.done += chunk.length;
        p.skipped.push(...(r.skipped ?? []));
        onProgress({ ...p });
      }
    }
    p.phase = "done";
  } catch (e) {
    p.phase = "stopped";
    p.error = `${(e as Error).message || "Upload stopped"} — what arrived is kept; drop the same files again to carry on (anything already in is skipped).`;
  }
  await jsonFetch(`${BASE}/api/finance/invoices/uploads/${batch.id}/finish`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ duplicates: p.held, skipped: p.skipped.slice(0, 5000) }),
  }).catch(() => undefined);
  onProgress({ ...p });
  return p;
}

// ---------------------------------------------------------------------------

export function InvoicesLibraryPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  // null until the first load picks the latest year; "all" = every year.
  const [fy, setFy] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [source, setSource] = useState<"all" | "upload" | "transaction">("all");
  const [dupes, setDupes] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [openMonths, setOpenMonths] = useState<Set<string>>(new Set());
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q.trim());
  if (!dupes && fy && fy !== "all") params.set("fy", fy);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (source !== "all") params.set("source", source);
  if (dupes) params.set("duplicates", "only");
  const qs = params.toString();

  const list = useQuery<ListResponse>({
    queryKey: ["/api/finance/invoices", qs],
    queryFn: () => jsonFetch(`${BASE}/api/finance/invoices${qs ? `?${qs}` : ""}`),
    // Hold off fetching every year until the latest year is known.
    enabled: fy !== null || dupes,
    refetchInterval: (query) => ((query.state.data as ListResponse | undefined)?.pendingReads ?? 0) > 0 ? 8000 : false,
  });
  // First visit: the year tabs come from a cheap call, then open on the latest year.
  const firstYears = useQuery<ListResponse>({
    queryKey: ["/api/finance/invoices", "years-only"],
    queryFn: () => jsonFetch(`${BASE}/api/finance/invoices?yearsOnly=1`),
    enabled: fy === null,
  });
  if (fy === null && firstYears.data) {
    const latest = firstYears.data.years.find((y) => y.fy !== "none")?.fy;
    setFy(latest ?? (firstYears.data.years.length ? "none" : "all"));
  }
  const uploads = useQuery<{ uploads: UploadRow[] }>({
    queryKey: ["/api/finance/invoices/uploads"],
    queryFn: () => jsonFetch(`${BASE}/api/finance/invoices/uploads`),
  });

  const busy = progress != null && progress.phase !== "done" && progress.phase !== "stopped";
  const sendFiles = async (files: FileList | File[] | null) => {
    const arr = Array.from(files ?? []);
    if (!arr.length || busy) return;
    const result = await uploadAll(arr, setProgress).catch((e: Error) => {
      toast({ title: "Upload couldn't start", description: e.message, variant: "destructive" });
      return null;
    });
    if (result) {
      toast(result.phase === "done"
        ? { title: `${result.added} invoice${result.added === 1 ? "" : "s"} added`, description: result.held ? `${result.held} were already in the library.` : "Reading them now." }
        : { title: "Upload stopped part-way", description: result.error, variant: "destructive" });
    }
    queryClient.invalidateQueries({ queryKey: ["/api/finance/invoices"] });
    queryClient.invalidateQueries({ queryKey: ["/api/finance/invoices/uploads"] });
  };

  const data = list.data ?? (fy === null ? firstYears.data : undefined);
  const invoices = list.data?.invoices ?? [];
  const years = data?.years ?? [];
  const total = useMemo(() => invoices.reduce((s, i) => s + Number(i.totalAmount ?? 0), 0), [invoices]);
  const searching = Boolean(q.trim() || from || to || source !== "all");
  const pending = data?.pendingReads ?? 0;

  // Month sections (by the invoice's own date); "Not dated yet" is flat.
  const months = useMemo(() => {
    const groups = new Map<string, Invoice[]>();
    for (const inv of invoices) {
      const key = inv.invoiceDate ? inv.invoiceDate.slice(0, 7) : "none";
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(inv);
    }
    return [...groups.entries()];
  }, [invoices]);
  const expandAll = searching || dupes || invoices.length <= 40;
  const toggleMonth = (k: string) => setOpenMonths((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

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
                <div className="text-sm text-muted-foreground">Drop zip folders, PDFs or photos here — several at once is fine, any size. Files already in the library are skipped, never added twice.</div>
              </div>
              <input ref={fileInput} type="file" multiple accept=".zip,application/zip,.pdf,application/pdf,image/*" className="hidden"
                onChange={(e) => { const f = e.target.files ? Array.from(e.target.files) : []; e.target.value = ""; sendFiles(f); }} />
              <Button onClick={() => fileInput.current?.click()} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Upload className="h-4 w-4 mr-2" />}
                {busy ? "Uploading…" : "Choose files"}
              </Button>
            </div>
            {progress && <UploadProgress p={progress} />}
            {pending > 0 && (
              <div className="text-sm flex items-center gap-2 text-sky-800 dark:text-sky-300">
                <Loader2 className="h-4 w-4 animate-spin" /> Reading {pending.toLocaleString("en-GB")} invoice{pending === 1 ? "" : "s"} for supplier, date and amounts — they move into their year as each is read.
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 h-full flex flex-col justify-center">
            <div className="text-sm text-muted-foreground flex items-center gap-2"><FileText className="h-4 w-4" />
              {dupes ? "Possible duplicates" : fy === "all" ? "All years" : fy === "none" ? "Not dated yet" : fy ? `FY ${fy}` : "Library"}{searching ? " · matching" : ""}
            </div>
            <div className="text-3xl font-semibold mt-1">{invoices.length.toLocaleString("en-GB")}</div>
            <div className="text-sm text-muted-foreground">{money(total.toFixed(2))} total</div>
          </CardContent>
        </Card>
      </div>

      <UploadHistory rows={uploads.data?.uploads ?? []} />

      {/* Years */}
      <div className="flex gap-2 flex-wrap items-center">
        {years.filter((y) => y.fy !== "none").map((y) => (
          <Button key={y.fy} size="sm" variant={!dupes && fy === y.fy ? "default" : "outline"} onClick={() => { setDupes(false); setFy(y.fy); }}>
            {y.fy} <span className="ml-1.5 opacity-70">{y.n.toLocaleString("en-GB")}</span>
          </Button>
        ))}
        {years.some((y) => y.fy === "none") && (
          <Button size="sm" variant={!dupes && fy === "none" ? "default" : "outline"} onClick={() => { setDupes(false); setFy("none"); }}>
            Not dated yet <span className="ml-1.5 opacity-70">{years.find((y) => y.fy === "none")!.n.toLocaleString("en-GB")}</span>
          </Button>
        )}
        <Button size="sm" variant={!dupes && fy === "all" ? "default" : "outline"} onClick={() => { setDupes(false); setFy("all"); }}>All years</Button>
        {(data?.duplicateCount ?? 0) > 0 && (
          <Button size="sm" variant={dupes ? "default" : "outline"} className={dupes ? "" : "text-amber-700 border-amber-400"} onClick={() => setDupes(!dupes)}>
            <Copy className="h-3.5 w-3.5 mr-1.5" /> Possible duplicates <span className="ml-1.5 opacity-70">{data!.duplicateCount}</span>
          </Button>
        )}
      </div>

      {/* Search */}
      <div className="flex gap-2 flex-wrap items-center">
        <div className="relative flex-1 min-w-[220px]">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${fy === "all" || dupes ? "every year" : fy === "none" ? "undated invoices" : `FY ${fy ?? ""}`} — supplier, invoice number, amount, file name…`} className="pl-9" />
          {q && (
            <button onClick={() => setQ("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Clear search">
              <XCircle className="h-4 w-4" />
            </button>
          )}
        </div>
        {q.trim() && fy !== "all" && !dupes && (
          <Button size="sm" variant="ghost" onClick={() => setFy("all")}>Search all years</Button>
        )}
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
        {searching && (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => { setQ(""); setFrom(""); setTo(""); setSource("all"); }}>Clear filters</Button>
        )}
      </div>

      {/* Results, by month */}
      {list.isLoading || (fy === null && !dupes) ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : list.isError ? (
        <Card><CardContent className="py-10 text-center text-destructive">{(list.error as Error).message}</CardContent></Card>
      ) : invoices.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">
          {searching ? "No invoices match — try another year, or Search all years." : years.length ? "Nothing in this view." : "No invoices yet. Drop a zip of invoices above to start the library."}
        </CardContent></Card>
      ) : fy === "none" && !dupes ? (
        <InvoiceList invoices={invoices} onOpen={setOpenId} />
      ) : (
        <div className="space-y-3">
          {months.map(([key, rows]) => {
            const open = expandAll || openMonths.has(key);
            const label = key === "none" ? "Not dated yet" : `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
            const sum = rows.reduce((s, i) => s + Number(i.totalAmount ?? 0), 0);
            return (
              <div key={key}>
                <button onClick={() => toggleMonth(key)} disabled={expandAll}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border bg-card hover:bg-secondary/40 text-left">
                  {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                  <span className="font-semibold flex-1">{label}{key !== "none" && <span className="text-muted-foreground font-normal"> · P{periodNo(`${key}-01`)}</span>}</span>
                  <span className="text-sm text-muted-foreground">{rows.length} invoice{rows.length === 1 ? "" : "s"}</span>
                  <span className="font-semibold tabular-nums w-28 text-right">{money(sum.toFixed(2))}</span>
                </button>
                {open && <div className="mt-2 pl-2 sm:pl-6"><InvoiceList invoices={rows} onOpen={setOpenId} /></div>}
              </div>
            );
          })}
        </div>
      )}

      {openId != null && (
        <InvoiceDetail invoice={invoices.find((i) => i.id === openId) ?? null} onClose={() => setOpenId(null)} />
      )}
    </div>
  );
}

function UploadProgress({ p }: { p: Progress }) {
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  return (
    <div className={cn("text-sm rounded-xl px-3 py-2 space-y-1.5", p.phase === "stopped" ? "bg-destructive/10" : "bg-secondary/50")}>
      <div>
        {p.phase === "unpacking" && "Unpacking…"}
        {p.phase === "checking" && `Found ${p.total.toLocaleString("en-GB")} files — checking which are already in…`}
        {p.phase === "sending" && `Sending ${p.done.toLocaleString("en-GB")} of ${p.total.toLocaleString("en-GB")}…`}
        {p.phase === "done" && <>Done: {p.total.toLocaleString("en-GB")} files found · <b>{p.added.toLocaleString("en-GB")} added</b>{p.held > 0 && ` · ${p.held.toLocaleString("en-GB")} already in the library`}</>}
        {p.phase === "stopped" && <span className="text-destructive">Stopped at {p.done.toLocaleString("en-GB")} of {p.total.toLocaleString("en-GB")} ({p.added} added). {p.error}</span>}
      </div>
      {(p.phase === "sending" || p.phase === "checking") && (
        <div className="h-2 rounded-full bg-background overflow-hidden"><div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} /></div>
      )}
      {p.skipped.length > 0 && (p.phase === "done" || p.phase === "stopped") && (
        <details>
          <summary className="cursor-pointer text-muted-foreground">{p.skipped.length} skipped (not PDFs or photos)</summary>
          <ul className="mt-1 text-xs text-muted-foreground list-disc pl-5 max-h-40 overflow-y-auto">
            {p.skipped.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

/** Every upload and what it actually added — the answer to "did that go in?". */
function UploadHistory({ rows }: { rows: UploadRow[] }) {
  if (rows.length === 0) return null;
  return (
    <details className="rounded-xl border bg-card px-4 py-3">
      <summary className="cursor-pointer font-medium">Upload history <span className="text-muted-foreground font-normal">· {rows.length} upload{rows.length === 1 ? "" : "s"}</span></summary>
      <ul className="mt-3 space-y-2">
        {rows.map((u) => {
          const stalled = u.status === "open" && Date.now() - new Date(u.lastAddedAt ?? u.createdAt).getTime() > 10 * 60_000;
          return (
            <li key={u.id} className="text-sm flex flex-wrap gap-x-3 gap-y-0.5 items-baseline border-t pt-2 first:border-0 first:pt-0">
              <span className="text-muted-foreground tabular-nums">{fmtWhen(u.createdAt)}</span>
              <span className="font-medium break-all">{u.fileName}</span>
              <span>{u.uploadedByName ?? ""}</span>
              <span><b>{u.added.toLocaleString("en-GB")} added</b>{u.duplicates > 0 && ` · ${u.duplicates.toLocaleString("en-GB")} already held`}{u.skipped.length > 0 && ` · ${u.skipped.length} skipped`}</span>
              {u.status === "open" && (stalled
                ? <Badge variant="outline" className="text-amber-700 border-amber-400">Stopped part-way — drop it again to finish</Badge>
                : <Badge variant="outline"><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Uploading</Badge>)}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

function InvoiceList({ invoices, onOpen }: { invoices: Invoice[]; onOpen: (id: number) => void }) {
  return (
    <div className="space-y-2">
      {invoices.map((inv) => (
        <button key={inv.id} onClick={() => onOpen(inv.id)} className="w-full text-left">
          <Card className="hover:border-primary/50 transition-colors">
            <div className="flex items-center gap-3 px-4 py-3">
              <div className="h-10 w-10 rounded-xl bg-secondary flex items-center justify-center shrink-0 text-muted-foreground">
                {inv.fileMime === "application/pdf" ? <FileText className="h-5 w-5" /> : <ImageIcon className="h-5 w-5" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium">{inv.supplierName ?? <span className="text-muted-foreground italic">Supplier not known yet</span>}</div>
                <div className="text-xs text-muted-foreground">
                  {fmtDate(inv.invoiceDate)}{inv.invoiceNumber ? ` · ${inv.invoiceNumber}` : ""}{inv.financialYear ? ` · FY ${inv.financialYear} P${periodNo(inv.invoiceDate!)}` : ""}
                  {inv.source === "transaction"
                    ? ` · posted${inv.postedByName ? ` by ${inv.postedByName}` : ""}${inv.postedAt ? ` ${fmtWhen(inv.postedAt)}` : ""}`
                    : ` · uploaded${inv.uploadedByName ? ` by ${inv.uploadedByName}` : ""} ${fmtWhen(inv.createdAt)}`}
                </div>
              </div>
              {inv.duplicateOfId && <Badge variant="outline" className="shrink-0 text-amber-700 border-amber-400"><Copy className="h-3 w-3 mr-1" /> Same as another</Badge>}
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
  );
}

/** The file itself, shown in the page: PDFs in a frame (served without a
 *  sandbox so every browser shows them), photos as images. */
export function FilePreview({ url, mime, name, className }: { url: string; mime: string; name: string; className?: string }) {
  if (mime.startsWith("image/") && mime !== "image/heic" && mime !== "image/heif") {
    return <img src={url} alt={name} className={cn("w-full max-h-[70dvh] object-contain rounded-xl border bg-secondary/30", className)} />;
  }
  if (mime === "application/pdf") {
    return <iframe src={`${url}#view=FitH`} title={name} className={cn("w-full h-[70dvh] rounded-xl border bg-white", className)} />;
  }
  return <p className="text-sm text-muted-foreground">This kind of file can't be shown here — open or download it.</p>;
}

function InvoiceDetail({ invoice, onClose }: { invoice: Invoice | null; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const notDup = useMutation({
    mutationFn: (notDuplicate: boolean) => jsonFetch(`${BASE}/api/finance/invoices/${invoice!.id}/duplicate`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notDuplicate }),
    }),
    onSuccess: () => { toast({ title: "Kept as its own invoice" }); queryClient.invalidateQueries({ queryKey: ["/api/finance/invoices"] }); onClose(); },
    onError: (e: Error) => toast({ title: "Couldn't save", description: e.message, variant: "destructive" }),
  });
  if (!invoice) return null;
  const fileUrl = `${BASE}/api/finance/invoices/${invoice.id}/file`;
  return (
    <div className="fixed inset-0 z-[150] bg-black/60 flex items-center justify-center p-3 sm:p-4" onClick={onClose}>
      <div className="bg-background rounded-2xl w-full max-w-5xl max-h-[92dvh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 p-5 border-b">
          <div className="flex-1 min-w-0">
            <div className="text-lg font-semibold">{invoice.supplierName ?? "Supplier not known yet"}</div>
            <div className="text-sm text-muted-foreground break-all">{invoice.sourcePath ?? invoice.fileName}</div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close"><X className="h-5 w-5" /></Button>
        </div>
        <div className="overflow-y-auto p-5 space-y-5">
          {invoice.duplicateOf && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-4 text-sm space-y-2">
              <div className="font-medium text-amber-900 dark:text-amber-200 flex items-center gap-2"><Copy className="h-4 w-4" /> Looks like the same invoice as one already in the library</div>
              <div className="text-amber-900/80 dark:text-amber-200/80">
                {invoice.duplicateOf.supplierName ?? "?"}{invoice.duplicateOf.invoiceNumber ? ` · ${invoice.duplicateOf.invoiceNumber}` : ""} · {fmtDate(invoice.duplicateOf.invoiceDate)} · {invoice.duplicateOf.sourcePath ?? invoice.duplicateOf.fileName}.
                It's kept but left out of the library.
              </div>
              <Button size="sm" variant="outline" onClick={() => notDup.mutate(true)} disabled={notDup.isPending}>It's a different invoice — keep both</Button>
            </div>
          )}
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant="outline" asChild>
              <a href={fileUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4 mr-1" /> Open in a new tab</a>
            </Button>
            <Button size="sm" variant="outline" asChild>
              <a href={`${fileUrl}?download=1`}><Download className="h-4 w-4 mr-1" /> Download</a>
            </Button>
            <ReadAgainButton id={invoice.id} status={invoice.readStatus} />
          </div>
          <FilePreview url={fileUrl} mime={invoice.fileMime} name={invoice.fileName} />
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
  flagged_duplicate: () => "Set aside: looks like the same invoice as one already in the library",
  marked_not_duplicate: () => "Marked as a different invoice (not a duplicate)",
  unmarked_not_duplicate: () => "Unmarked as a different invoice",
  document_relabelled: (d) => `File relabelled${d.docKind ? ` as ${d.docKind === "invoice" ? "VAT invoice" : String(d.docKind).replace(/_/g, " ")}` : ""}`,
  auto_done: () => "Marked done automatically: posted with a VAT invoice",
  found_posted_in_quickbooks: () => "Found posted in QuickBooks",
  marked_done: () => "Transaction marked done",
  marked_not_needed: () => "Transaction marked not needed",
  marked_no_vat_dla: () => "Marked no VAT invoice — DLA (post to the Director's Loan Account)",
  marked_no_vat_other: () => "Marked no VAT invoice",
  unmarked_no_vat: () => "Put back to needing a VAT invoice",
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
  supplierName: "supplier", invoiceDate: "date", invoiceNumber: "invoice number", totalAmount: "total", vatAmount: "VAT", docKind: "kind", paymentStatus: "paid status", notes: "notes",
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
