/**
 * Policy review list for the gated onboarding screen (Graeme, 2026-09-13):
 * new starters read and accept the company policies before they ever set
 * foot in the building. Each active policy expands inline (gated users
 * can't navigate to /documents/:id — the reader comes to them) and the
 * accept button records the versioned acceptance, which enrols them on
 * the Policies training matrix and ticks it. If a policy is updated
 * later, the acceptance goes stale and the entry re-opens by itself.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, CheckCircle2, ChevronDown, ChevronUp, ScrollText } from "lucide-react";
import { MarkdownBody } from "@/pages/document-viewer";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface PolicyRow {
  id: number;
  title: string;
  assessmentType: string;
  status: string;
}

export function PolicyReviewList() {
  const { data: docs = [], isLoading } = useQuery<PolicyRow[]>({
    queryKey: ["policy-review-list"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/risk-assessments`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load policies");
      return res.json();
    },
  });
  const policies = docs.filter(d => d.assessmentType === "policy" && d.status === "active");

  if (isLoading) return <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  if (policies.length === 0) return <p className="text-sm text-muted-foreground">No policies published yet.</p>;

  return (
    <div className="space-y-2">
      {policies.map(p => <PolicyEntry key={p.id} policy={p} />)}
    </div>
  );
}

function PolicyEntry({ policy }: { policy: PolicyRow }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: ack } = useQuery<{ policy?: { version: number; acceptedVersion: number | null; needsAcceptance: boolean } | null }>({
    queryKey: ["training-ack", policy.id],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/training-ack/status?documentId=${policy.id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const { data: body } = useQuery<{ bodyMarkdown: string }>({
    queryKey: ["policy-body", policy.id],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/risk-assessments/${policy.id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load the policy");
      return res.json();
    },
    enabled: open,
  });

  const confirm = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}/api/training-ack/confirm`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: policy.id }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to record");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["training-ack", policy.id] });
      toast({ title: "Accepted", description: `${policy.title} is recorded on your training file.` });
    },
    onError: (e) => toast({ title: "Couldn't record that", description: e instanceof Error ? e.message : String(e), variant: "destructive" }),
  });

  const accepted = ack?.policy ? !ack.policy.needsAcceptance && ack.policy.acceptedVersion != null : false;
  const isReReview = Boolean(ack?.policy?.needsAcceptance && ack.policy?.acceptedVersion != null);

  return (
    <div className={cn("rounded-xl border-2 overflow-hidden", accepted ? "border-emerald-500/50" : "border-border")}>
      <button onClick={() => setOpen(o => !o)} className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-secondary/30 transition-colors">
        <span className={cn(
          "w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0",
          accepted ? "bg-emerald-500 text-white" : "bg-secondary text-muted-foreground",
        )}>
          {accepted ? <CheckCircle2 className="w-4 h-4" /> : <ScrollText className="w-4 h-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{policy.title}</span>
          <span className="block text-xs text-muted-foreground">
            {accepted ? "Accepted — on your training file" : isReReview ? "Updated — please read and re-confirm" : "Please read and accept"}
          </span>
        </span>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
      </button>
      {open && (
        <div className="border-t border-border px-4 py-4 space-y-4">
          {body ? <MarkdownBody md={body.bodyMarkdown} /> : <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>}
          {!accepted && body && (
            <button
              onClick={() => confirm.mutate()}
              disabled={confirm.isPending}
              className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-bold disabled:opacity-60 inline-flex items-center justify-center gap-2"
            >
              {confirm.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
              I've read and understood this policy
            </button>
          )}
          {accepted && (
            <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400 inline-flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" /> Accepted — recorded on your training file.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
