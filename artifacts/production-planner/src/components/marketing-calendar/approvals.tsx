/**
 * Approval status on the marketing calendar (Graeme, 2026-09-30).
 *
 * Everyone who can open Sales & Marketing SEES whether each email is
 * approved: a green "Approved by Graeme", an amber "Needs approval" or
 * "Changed since approval". Only approvers (the founder, or a
 * marketing.approve_emails grant) get the Approve / Undo approval button —
 * and the server checks again, so hiding the button isn't the lock.
 *
 * The rules (one approval per thing, stage from Klaviyo, changed since
 * approval, needs approval) are buildApprovalItems() & co. in
 * @workspace/marketing-calendar — the same functions the server's reminder
 * count uses, so the badge and the banner can't disagree.
 */
import { useMemo } from "react";
import { format, parseISO } from "date-fns";
import { AlertTriangle, BadgeCheck, CircleDashed, Loader2, ShieldCheck, Undo2 } from "lucide-react";
import { approvalBadge, buildApprovalItems, type ApprovalItem } from "@workspace/marketing-calendar";
import { cn } from "@/lib/utils";
import { useApprovals, useSetApproval, type Approval, type ApprovalTarget, type KlaviyoEmail, type PlannedEmail } from "./api";
import { APPROVAL_TONE, firstName } from "./constants";

export type Item = ApprovalItem<PlannedEmail, KlaviyoEmail>;

/** Every approvable thing in view, looked up by plan or Klaviyo campaign. */
export function useApprovalIndex(planned: readonly PlannedEmail[], klaviyo: readonly KlaviyoEmail[], today: string) {
  const q = useApprovals();
  const approvals = q.data?.approvals;
  return useMemo(() => {
    const rows = new Map((approvals ?? []).map(a => [a.key, a]));
    const items = buildApprovalItems({
      planned, klaviyo, today,
      approvals: (approvals ?? []).map(a => ({ key: a.key, approved: a.approved, subject: a.subject })),
    });
    const byPlan = new Map<number, Item>();
    const byKlaviyo = new Map<string, Item>();
    for (const it of items) {
      if (it.plan) byPlan.set(it.plan.id, it);
      else if (it.klaviyo) byKlaviyo.set(it.klaviyo.id, it);
    }
    return {
      loaded: approvals != null,
      canApprove: q.data?.canApprove === true,
      items,
      row: (key: string): Approval | null => rows.get(key) ?? null,
      forPlan: (id: number) => byPlan.get(id) ?? null,
      forKlaviyo: (id: string) => byKlaviyo.get(id) ?? null,
    };
  }, [approvals, planned, klaviyo, today, q.data?.canApprove]);
}

export type ApprovalIndex = ReturnType<typeof useApprovalIndex>;

export function badgeFor(item: Item, row: Approval | null) {
  return approvalBadge(item.state, item.needsApproval, row?.approvedBy?.name);
}

/** The small pill on list cards and in modals. */
export function ApprovalBadge({ item, row, className }: { item: Item; row: Approval | null; className?: string }) {
  const b = badgeFor(item, row);
  // "Not approved" on an email that isn't real in Klaviyo yet is noise.
  if (b.tone === "grey" && (item.stage === "planned" || item.stage === "sent")) return null;
  const Icon = b.tone === "green" ? BadgeCheck : b.tone === "amber" ? AlertTriangle : CircleDashed;
  return (
    <span className={cn("px-2 py-0.5 rounded-full border text-xs font-semibold inline-flex items-center gap-1", APPROVAL_TONE[b.tone], className)}>
      <Icon className="w-3.5 h-3.5" /> {b.label}
    </span>
  );
}

/** A dot for the tiny month-grid chips: green approved, amber needs it. */
export function ApprovalDot({ item, onLight }: { item: Item | null; onLight?: boolean }) {
  if (!item) return null;
  if (item.state === "approved") {
    return <BadgeCheck className={cn("w-3.5 h-3.5 flex-shrink-0", onLight ? "text-emerald-600" : "text-emerald-300")} aria-label="Approved" />;
  }
  if (item.needsApproval) {
    return <span className={cn("w-2.5 h-2.5 rounded-full bg-amber-400 flex-shrink-0 ring-2", onLight ? "ring-amber-600/40" : "ring-white/70")} aria-label="Needs approval" />;
  }
  return null;
}

export function approvalTitle(item: Item | null, row: Approval | null): string {
  if (!item) return "";
  const b = badgeFor(item, row);
  return b.tone === "grey" ? "" : ` · ${b.label}`;
}

/**
 * The Approval card inside the email modals: who approved which subject
 * line and when, "changed since approval" with the old and new subject
 * lines, and — for approvers only — Approve / Approve again / Undo.
 */
export function ApprovalPanel({ item, row, canApprove, target, disabled }: {
  item: Item | null;
  row: Approval | null;
  canApprove: boolean;
  target: ApprovalTarget | null;
  disabled?: boolean;
}) {
  const set = useSetApproval();
  if (!item) return null;
  const b = badgeFor(item, row);
  const approvedAt = row?.approvedAt ? format(parseISO(row.approvedAt), "EEE d MMM, HH:mm") : null;
  const tone = b.tone === "green" ? "border-emerald-500/40 bg-emerald-500/5" : b.tone === "amber" ? "border-amber-500/50 bg-amber-500/5" : "border-border";

  return (
    <section className={cn("rounded-2xl border-2 p-4 space-y-3", tone)} aria-label="Approval">
      <div className="flex items-center gap-2 flex-wrap">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5 mr-auto">
          <ShieldCheck className="w-4 h-4" /> Approval
        </h3>
        <span className={cn("px-3 py-1 rounded-full border text-sm font-bold inline-flex items-center gap-1.5", APPROVAL_TONE[b.tone])}>
          {b.tone === "green" ? <BadgeCheck className="w-4 h-4" /> : b.tone === "amber" ? <AlertTriangle className="w-4 h-4" /> : <CircleDashed className="w-4 h-4" />}
          {b.label}
        </span>
      </div>

      {item.state === "approved" && row && (
        <p className="text-base">
          <b>{firstName(row.approvedBy?.name)}</b> approved the subject line <b>“{row.subject ?? "(none)"}”</b>{approvedAt ? ` on ${approvedAt}` : ""}.
        </p>
      )}
      {item.state === "changed" && row && (
        <div className="text-base space-y-1">
          <p><b>{firstName(row.approvedBy?.name)}</b> approved <b>“{row.subject ?? "(none)"}”</b>{approvedAt ? ` on ${approvedAt}` : ""}.</p>
          <p>The subject line is now <b>“{item.subject ?? "(none)"}”</b> — it needs approving again.</p>
        </div>
      )}
      {item.state === "none" && (
        <p className="text-sm text-muted-foreground">
          {item.stage === "planned"
            ? "Not approved yet. Once it's built in Klaviyo it goes on the approval list."
            : item.stage === "sent"
              ? "Not approved — it has already gone out."
              : "Not approved yet."}
          {row?.unapprovedBy && row.unapprovedAt && ` ${firstName(row.unapprovedBy.name)} undid the last approval on ${format(parseISO(row.unapprovedAt), "d MMM, HH:mm")}.`}
        </p>
      )}

      {canApprove && target && (
        <div className="flex gap-2 flex-wrap">
          {item.state !== "approved" ? (
            <button type="button" disabled={disabled || set.isPending} onClick={() => set.mutate({ target, approve: true })}
              className="px-4 py-2.5 rounded-xl bg-emerald-600 text-white font-semibold flex items-center gap-2 hover:bg-emerald-700 disabled:opacity-60">
              {set.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <BadgeCheck className="w-4 h-4" />}
              {item.state === "changed" ? "Approve the new subject line" : "Approve"}
            </button>
          ) : (
            <button type="button" disabled={disabled || set.isPending} onClick={() => set.mutate({ target, approve: false })}
              className="px-4 py-2.5 rounded-xl border-2 border-border font-semibold flex items-center gap-2 hover:bg-secondary/50 disabled:opacity-60">
              {set.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Undo2 className="w-4 h-4" />} Undo approval
            </button>
          )}
          {item.state === "changed" && (
            <button type="button" disabled={disabled || set.isPending} onClick={() => set.mutate({ target, approve: false })}
              className="px-4 py-2.5 rounded-xl border-2 border-border font-semibold flex items-center gap-2 hover:bg-secondary/50 disabled:opacity-60">
              <Undo2 className="w-4 h-4" /> Undo approval
            </button>
          )}
        </div>
      )}
      {set.isError && <p className="text-sm text-destructive flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> {(set.error as Error).message}</p>}
    </section>
  );
}
