import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { ArrowLeft, FileText, ScrollText, Download, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import type { JSX } from "react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// Staff-facing reader for any document in the Documents repository
// (risk_assessments table). This page is the ONE place a document is read —
// the Employee Hub, the HACCP evidence tab and the training matrix all link
// here, so the policy text never exists in more than one place.

interface DocumentRow {
  id: number;
  assessmentType: string;
  title: string;
  bodyMarkdown: string;
  status: string;
  reviewFrequencyMonths: number;
  nextReviewDue: string | null;
  originalIssueDate: string | null;
  fileName: string | null;
  fileSizeBytes: number | null;
  updatedAt: string;
}

function typeLabel(t: string): string {
  switch (t) {
    case "fire": return "Fire";
    case "food_safety": return "Food Safety";
    case "general_safety": return "Health & Safety";
    case "insurance": return "Insurance";
    case "certification": return "Certification";
    case "licence": return "Licence";
    case "sop": return "SOP";
    case "policy": return "Policy";
    default: return t.charAt(0).toUpperCase() + t.slice(1);
  }
}

// ── Minimal markdown renderer ───────────────────────────────────────────────
// Supports what our policy documents actually use: ## headings, bullet and
// numbered lists, **bold**, and paragraphs. No library, no HTML injection —
// everything renders through React elements.

function renderInline(text: string): (string | JSX.Element)[] {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return parts.map((p, i) => (i % 2 === 1 ? <strong key={i}>{p}</strong> : p));
}

function MarkdownBody({ md }: { md: string }) {
  const blocks: JSX.Element[] = [];
  const lines = md.split("\n");
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];
  let key = 0;

  const flushList = () => {
    if (!list) return;
    const items = list.items.map((t, i) => <li key={i} className="leading-relaxed">{renderInline(t)}</li>);
    blocks.push(list.ordered
      ? <ol key={key++} className="list-decimal pl-5 space-y-1.5 text-sm">{items}</ol>
      : <ul key={key++} className="list-disc pl-5 space-y-1.5 text-sm">{items}</ul>);
    list = null;
  };
  const flushPara = () => {
    if (para.length === 0) return;
    blocks.push(<p key={key++} className="text-sm leading-relaxed">{renderInline(para.join(" "))}</p>);
    para = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    const numbered = /^\d+\.\s+(.*)$/.exec(line);
    if (h) {
      flushList(); flushPara();
      blocks.push(<h2 key={key++} className="text-base font-semibold mt-5 first:mt-0">{renderInline(h[2])}</h2>);
    } else if (bullet) {
      flushPara();
      if (!list || list.ordered) { flushList(); list = { ordered: false, items: [] }; }
      list.items.push(bullet[1]);
    } else if (numbered) {
      flushPara();
      if (!list || !list.ordered) { flushList(); list = { ordered: true, items: [] }; }
      list.items.push(numbered[1]);
    } else if (line === "") {
      flushList(); flushPara();
    } else {
      flushList();
      para.push(line);
    }
  }
  flushList(); flushPara();
  return <div className="space-y-3">{blocks}</div>;
}

// ── Read-and-understood confirmation ────────────────────────────────────────
// When this document is a linked item on a training matrix the signed-in
// colleague is enrolled in, they confirm their reading right here and the
// tick lands on the matrix immediately — no "tell your manager" loop
// (Graeme, 2026-09-11: review it there and then, and it ticks itself off).

interface AckItem {
  itemId: number;
  itemLabel: string;
  matrixName: string;
  trained: boolean | null;
  trainedAt: string | null;
  signedOffByName: string | null;
}

function ReadConfirmation({ documentId, docTypeLabel, isPolicy }: {
  documentId: number;
  docTypeLabel: string;
  isPolicy: boolean;
}) {
  const queryClient = useQueryClient();
  const { data } = useQuery<{ items: AckItem[] }>({
    queryKey: ["training-ack", documentId],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/training-ack/status?documentId=${documentId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const confirm = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}/api/training-ack/confirm`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to record");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["training-ack", documentId] });
      toast({ title: "Recorded", description: "Your training matrix has been ticked — nothing else to do." });
    },
    onError: (e) => {
      toast({ title: "Couldn't record that", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    },
  });

  const items = data?.items ?? [];
  if (items.length === 0) {
    // Not on this person's training matrix. For a policy, keep the gentle
    // pointer so the expectation ("reading these matters") survives.
    return isPolicy ? (
      <p className="text-xs text-muted-foreground">
        Once you have read and understood this policy, tell your manager — your sign-off is recorded on the training matrix.
      </p>
    ) : null;
  }

  const unread = items.filter(i => !i.trained);
  if (unread.length === 0) {
    const first = items[0];
    return (
      <div className="rounded-2xl border border-emerald-500/50 bg-emerald-500/10 p-4 flex items-center gap-3">
        <CheckCircle2 className="w-6 h-6 text-emerald-600 flex-shrink-0" />
        <div className="text-sm">
          <p className="font-semibold text-emerald-800 dark:text-emerald-300">You've confirmed this {docTypeLabel}</p>
          <p className="text-muted-foreground">
            Recorded on your training matrix{first.trainedAt ? ` — ${format(new Date(`${first.trainedAt}T00:00:00`), "d MMM yyyy")}` : ""}.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border-2 border-primary/40 bg-primary/5 p-5 space-y-3">
      <p className="text-sm font-medium">
        This {docTypeLabel} is on your training matrix
        {unread.length === 1 ? ` (“${unread[0].itemLabel}”)` : ""}. Once you've read it, confirm below and it's ticked off for you — no need to tell a manager.
      </p>
      <button
        onClick={() => confirm.mutate()}
        disabled={confirm.isPending}
        className="w-full sm:w-auto px-5 py-3 rounded-xl bg-primary text-primary-foreground text-base font-bold hover:bg-primary/90 active:scale-[0.99] transition-all disabled:opacity-60 inline-flex items-center justify-center gap-2"
      >
        {confirm.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
        I've read and understood this {docTypeLabel}
      </button>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────
export default function DocumentViewer() {
  const [, params] = useRoute("/documents/:id");
  const id = Number(params?.id);

  const { data, isLoading, error } = useQuery<DocumentRow>({
    queryKey: ["document", id],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/risk-assessments/${id}`, { credentials: "include" });
      if (!res.ok) throw new Error(res.status === 404 ? "Document not found" : `HTTP ${res.status}`);
      return res.json();
    },
    enabled: Number.isInteger(id),
  });

  const hasFile = data?.fileSizeBytes != null && data.fileSizeBytes > 0;

  return (
    <div className="space-y-6 max-w-3xl">
      <Link href="/hub" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-4 h-4" /> Back to my hub
      </Link>

      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : error || !data ? (
        <p className="text-sm text-muted-foreground">{error instanceof Error ? error.message : "Document unavailable."}</p>
      ) : (
        <>
          <PageHeader title={data.title} description={`${typeLabel(data.assessmentType)} · ${data.status === "active" ? "Active" : data.status}`} />
          <div className="rounded-2xl border border-border bg-card p-6 space-y-4">
            <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
              <span className="inline-flex items-center gap-1.5">
                <ScrollText className="w-3.5 h-3.5" /> {typeLabel(data.assessmentType)}
              </span>
              {data.originalIssueDate && <span>Issued {format(new Date(data.originalIssueDate + "T00:00:00"), "d MMM yyyy")}</span>}
              {data.nextReviewDue && <span>Next review {format(new Date(data.nextReviewDue + "T00:00:00"), "d MMM yyyy")}</span>}
            </div>

            {data.bodyMarkdown ? (
              <MarkdownBody md={data.bodyMarkdown} />
            ) : !hasFile ? (
              <p className="text-sm text-muted-foreground">This document has no content yet.</p>
            ) : null}

            {hasFile && (
              <div className="flex items-center gap-2 pt-3 border-t border-border">
                <a href={`${BASE}/api/risk-assessments/${data.id}/file`} target="_blank" rel="noopener noreferrer"
                  className="text-xs px-3 py-1.5 rounded-lg bg-secondary hover:bg-secondary/80 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5" /> View PDF
                </a>
                <a href={`${BASE}/api/risk-assessments/${data.id}/file?download=1`}
                  className="text-xs px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-1.5">
                  <Download className="w-3.5 h-3.5" /> Download
                </a>
              </div>
            )}
          </div>

          <ReadConfirmation documentId={data.id} docTypeLabel={typeLabel(data.assessmentType).toLowerCase()} isPolicy={data.assessmentType === "policy"} />
        </>
      )}
    </div>
  );
}
