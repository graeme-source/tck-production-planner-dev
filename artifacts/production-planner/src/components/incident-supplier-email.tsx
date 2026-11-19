/**
 * "Was it a supplier's product?" on an incident report (Graeme, 2026-11-19:
 * mouldy in-date cheese, bone in the duck — "choose the supplier … then we
 * can choose to actually email them a report, and you could draft a
 * relevant email"). Objectives B and F.
 *
 * One step at a time: pick the supplier (the AI has usually picked it from
 * what was said), then the product and the batch code if anyone has it,
 * then "Draft the email" shows the email to read and edit, and one Send
 * sends it with the report's photos. Once sent, it shows what went and to
 * whom. Server: routes/incidents.ts (supplier-email/draft, /send).
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Mail, Truck, CheckCircle2, PackageSearch, Send } from "lucide-react";
import { format } from "date-fns";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface SupplierFields {
  id: number;
  supplierIssue: boolean;
  supplierId: number | null;
  ingredientId: number | null;
  productBatchCode: string | null;
  productUseBy: string | null;
  supplierEmailTo: string | null;
  supplierEmailSubject: string | null;
  supplierEmailBody: string | null;
  supplierEmailSentAt: string | null;
  supplierEmailSentByName: string | null;
}

interface SupplierOptions {
  suppliers: Array<{ id: number; name: string; emailTo: string | null; recipientName: string | null }>;
  ingredients: Array<{ id: number; name: string; supplierIds: number[] }>;
}

interface Draft { to: string; recipientName: string | null; subject: string; body: string; photoCount: number; usedAi: boolean }

async function errorText(res: Response, fallback: string): Promise<string> {
  return (await res.json().catch(() => ({}))).error ?? fallback;
}

export function IncidentSupplierSection({ report, locked, patch, onChanged }: {
  report: SupplierFields;
  locked: boolean;
  patch: (body: Record<string, unknown>) => Promise<void>;
  onChanged: () => void;
}) {
  const sent = !!report.supplierEmailSentAt;
  const { data: opts } = useQuery<SupplierOptions>({
    queryKey: ["incident-supplier-options"],
    enabled: report.supplierIssue && !sent,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/incidents/supplier-options`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load suppliers");
      return res.json();
    },
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const save = async (name: string, body: Record<string, unknown>) => {
    setBusy(name);
    try { await patch(body); setDraft(null); }
    catch (e) { toast({ title: "That didn't save", description: e instanceof Error ? e.message : String(e), variant: "destructive" }); }
    finally { setBusy(null); }
  };

  const makeDraft = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}/api/incidents/${report.id}/supplier-email/draft`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      if (!res.ok) throw new Error(await errorText(res, "Couldn't draft the email"));
      return res.json() as Promise<Draft>;
    },
    onSuccess: d => setDraft(d),
    onError: e => toast({ title: "Couldn't draft the email", description: e instanceof Error ? e.message : String(e), variant: "destructive" }),
  });

  const send = useMutation({
    mutationFn: async (d: Draft) => {
      const res = await fetch(`${BASE}/api/incidents/${report.id}/supplier-email/send`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: d.to, subject: d.subject, body: d.body }),
      });
      if (!res.ok) throw new Error(await errorText(res, "The email didn't send"));
      return res.json();
    },
    onSuccess: async () => {
      setDraft(null);
      onChanged();
      toast({ title: "Emailed the supplier", description: "A copy went to Graeme and the accounts mailbox. Replies come back to Graeme." });
    },
    onError: e => toast({ title: "Not sent", description: e instanceof Error ? e.message : String(e), variant: "destructive" }),
  });

  // Not flagged as a supplier issue: one quiet question.
  if (!report.supplierIssue && !sent) {
    return (
      <button type="button" disabled={locked || busy !== null} onClick={() => void save("flag", { supplierIssue: true })}
        className="w-full text-left rounded-xl border-2 border-dashed border-border p-4 flex items-center gap-3 hover:bg-secondary/30 disabled:opacity-60">
        {busy === "flag" ? <Loader2 className="w-5 h-5 animate-spin" /> : <Truck className="w-5 h-5 text-muted-foreground" />}
        <span className="text-sm font-semibold">Was it a supplier's product? Tap to tell the supplier</span>
      </button>
    );
  }

  if (sent) {
    return (
      <div className="rounded-xl border-2 border-emerald-500/60 bg-emerald-500/10 p-4 space-y-2">
        <p className="text-sm font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-emerald-600" />
          Supplier emailed — to {report.supplierEmailTo} by {report.supplierEmailSentByName ?? "the team"} on{" "}
          {format(new Date(report.supplierEmailSentAt!), "d MMM yyyy 'at' HH:mm")}
        </p>
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">What was sent</summary>
          <p className="mt-2 font-semibold">{report.supplierEmailSubject}</p>
          <pre className="mt-1 whitespace-pre-wrap font-sans text-sm">{report.supplierEmailBody}</pre>
        </details>
      </div>
    );
  }

  const supplier = opts?.suppliers.find(s => s.id === report.supplierId) ?? null;
  const products = (opts?.ingredients ?? []).filter(i => report.supplierId == null || i.supplierIds.includes(report.supplierId));
  const inputCls = "mt-1 block w-full min-h-12 px-3 py-2.5 bg-background border border-border rounded-xl text-base font-normal normal-case";
  const labelCls = "text-xs font-semibold text-muted-foreground uppercase tracking-wide block";

  return (
    <div className="rounded-xl border-2 border-amber-500/60 bg-amber-500/5 p-4 space-y-4">
      <p className="text-base font-bold flex items-center gap-2"><Truck className="w-5 h-5 text-amber-600" /> Tell the supplier</p>

      {/* Step 1 — which supplier */}
      <label className={labelCls}>
        Which supplier?
        <select value={report.supplierId ?? ""} disabled={locked || !opts || busy !== null}
          onChange={e => void save("supplier", { supplierId: e.target.value ? Number(e.target.value) : null, ingredientId: null })}
          className={inputCls}>
          <option value="">{opts ? "Choose the supplier…" : "Loading…"}</option>
          {opts?.suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>

      {/* Step 2 — which product, batch, use-by (all optional) */}
      {report.supplierId != null && (
        <div className="grid sm:grid-cols-3 gap-3">
          <label className={cn(labelCls, "sm:col-span-3")}>
            Which product?
            <select value={report.ingredientId ?? ""} disabled={locked || busy !== null}
              onChange={e => void save("product", { ingredientId: e.target.value ? Number(e.target.value) : null })}
              className={inputCls}>
              <option value="">Not sure / not listed</option>
              {products.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </label>
          <label className={cn(labelCls, "sm:col-span-2")}>
            Batch / lot code on the pack (if you have it)
            <input key={report.productBatchCode ?? ""} defaultValue={report.productBatchCode ?? ""} disabled={locked}
              placeholder="e.g. L23456"
              onBlur={e => { const v = e.target.value.trim(); if (v !== (report.productBatchCode ?? "")) void save("batch", { productBatchCode: v || null }); }}
              className={inputCls} />
          </label>
          <label className={labelCls}>
            Use-by on the pack
            <input type="date" key={report.productUseBy ?? ""} defaultValue={report.productUseBy ?? ""} disabled={locked}
              onBlur={e => { const v = e.target.value; if (v !== (report.productUseBy ?? "")) void save("useby", { productUseBy: v || null }); }}
              className={inputCls} />
          </label>
        </div>
      )}

      {/* Step 3 — draft, read, send */}
      {report.supplierId != null && !draft && (
        <button type="button" onClick={() => makeDraft.mutate()} disabled={makeDraft.isPending || busy !== null}
          className="w-full min-h-14 rounded-2xl bg-primary text-primary-foreground text-base font-bold inline-flex items-center justify-center gap-2 disabled:opacity-60">
          {makeDraft.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Mail className="w-5 h-5" />}
          {makeDraft.isPending ? "Writing the email…" : `Draft the email to ${supplier?.name ?? "the supplier"}`}
        </button>
      )}

      {draft && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <label className={labelCls}>
            To{draft.recipientName ? ` (${draft.recipientName})` : ""}
            <input value={draft.to} onChange={e => setDraft({ ...draft, to: e.target.value })}
              placeholder="No email saved for this supplier — type it in" className={inputCls} />
          </label>
          <label className={labelCls}>
            Subject
            <input value={draft.subject} onChange={e => setDraft({ ...draft, subject: e.target.value })} className={inputCls} />
          </label>
          <label className={labelCls}>
            Email — change anything you like
            <textarea rows={14} value={draft.body} onChange={e => setDraft({ ...draft, body: e.target.value })}
              className={cn(inputCls, "leading-relaxed")} />
          </label>
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <PackageSearch className="w-4 h-4" />
            {draft.photoCount ? `${draft.photoCount} photo${draft.photoCount === 1 ? "" : "s"} attached.` : "No photos yet — add them above first if you can."} Copied to Graeme and accounts.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <button type="button" onClick={() => setDraft(null)} disabled={send.isPending}
              className="min-h-14 px-5 rounded-2xl border-2 border-border text-base font-semibold">
              Not now
            </button>
            <button type="button" onClick={() => send.mutate(draft)} disabled={send.isPending || !draft.to.trim() || !draft.subject.trim() || !draft.body.trim()}
              className="flex-1 min-h-14 rounded-2xl bg-emerald-600 text-white text-base font-bold inline-flex items-center justify-center gap-2 disabled:opacity-60">
              {send.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />} Send to {supplier?.name ?? "the supplier"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
