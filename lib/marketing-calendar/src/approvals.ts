/**
 * Email stages and approvals (Graeme, 2026-09-30) — the pure rules, shared
 * by the server (routes/marketing-approvals.ts) and the page. Tested in
 * approvals.test.ts.
 *
 * STAGE: Planned → Created in Klaviyo → Scheduled → Sent. A plan linked to a
 * Klaviyo campaign takes its stage FROM Klaviyo; unlinked, the stage is the
 * one somebody set by hand.
 *
 * APPROVAL is a separate yes/no. There is ONE approval per thing, keyed by
 * approvalKey(): a plan not linked to Klaviyo is 'plan:<id>'; a Klaviyo
 * campaign — on its own, or the one a plan is linked to — is
 * 'klaviyo:<campaign id>', so the plan and its campaign share one answer.
 * If the subject line has changed since it was approved, it needs
 * approving again.
 */

export const EMAIL_STAGES = ["planned", "created", "scheduled", "sent"] as const;
export type EmailStage = (typeof EMAIL_STAGES)[number];

/** What Klaviyo's campaign status means as a stage (null = not one we show). */
export function stageFromKlaviyo(status: string | null | undefined): EmailStage | null {
  switch (status) {
    case "Draft": return "created";
    case "Scheduled":
    case "Sending": return "scheduled";
    case "Sent": return "sent";
    default: return null;
  }
}

function asStage(s: string): EmailStage {
  return (EMAIL_STAGES as readonly string[]).includes(s) ? (s as EmailStage) : "planned";
}

/**
 * The stage to show for a planned email. Linked + Klaviyo known → Klaviyo's
 * answer (`fromKlaviyo: true`). Otherwise the stored, hand-set stage (a link
 * whose campaign we can't see right now falls back to it rather than lie).
 */
export function effectiveStage(
  plan: { status: string; klaviyoCampaignId: string | null },
  klaviyo: { status: string } | null | undefined,
): { stage: EmailStage; fromKlaviyo: boolean } {
  if (plan.klaviyoCampaignId && klaviyo) {
    const s = stageFromKlaviyo(klaviyo.status);
    if (s) return { stage: s, fromKlaviyo: true };
  }
  return { stage: asStage(plan.status), fromKlaviyo: false };
}

// ── Keys ────────────────────────────────────────────────────────────────

export function planKey(emailId: number): string { return `plan:${emailId}`; }
export function klaviyoKey(campaignId: string): string { return `klaviyo:${campaignId}`; }

/** The one approval that governs this thing. */
export function approvalKey(target:
  | { kind: "plan"; emailId: number; klaviyoCampaignId: string | null }
  | { kind: "klaviyo"; klaviyoCampaignId: string }): string {
  if (target.klaviyoCampaignId) return klaviyoKey(target.klaviyoCampaignId);
  return planKey((target as { emailId: number }).emailId);
}

// ── Approval state ──────────────────────────────────────────────────────

export interface ApprovalLike {
  key: string;
  approved: boolean;
  /** Subject line as it was when approved. */
  subject: string | null;
}

export type ApprovalState = "approved" | "changed" | "none";

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().replace(/\s+/g, " ");
}

/**
 * approved — approved and the subject line is what was approved.
 * changed  — approved, but the subject line is different now: "Changed since
 *            approval", needs approving again.
 * none     — not approved (never, or approval undone).
 * An unknown current subject (Klaviyo out of reach) never flags a change.
 */
export function approvalState(approval: ApprovalLike | null | undefined, currentSubject: string | null | undefined): ApprovalState {
  if (!approval || !approval.approved) return "none";
  if (currentSubject === undefined) return "approved";
  return norm(approval.subject) === norm(currentSubject) ? "approved" : "changed";
}

/**
 * THE NEEDS-APPROVAL RULE. Something nags an approver when ALL hold:
 *  - it sends today or later (London day), and
 *  - it is real in Klaviyo: stage "created" (a draft) or "scheduled"
 *    (a plan still only "planned" doesn't nag; "sent" is too late), and
 *  - it is not approved, or it changed since approval.
 * No send day → it can't be placed, so it doesn't nag.
 */
export function needsApproval(input: { date: string | null; stage: EmailStage; approval: ApprovalState; today: string }): boolean {
  if (!input.date || input.date < input.today) return false;
  if (input.stage !== "created" && input.stage !== "scheduled") return false;
  return input.approval !== "approved";
}

// ── Every approvable thing in a range, with its answer ──────────────────

export interface PlanForApproval { id: number; sendDate: string; subject: string; status: string; klaviyoCampaignId: string | null }
export interface KlaviyoForApproval { id: string; name: string; status: string; date: string; subject: string | null }

export interface ApprovalItem<P, K> {
  key: string;
  kind: "plan" | "klaviyo";
  /** The day it sends: a draft's day in Klaviyo is only a placeholder, so a
   *  linked plan's own day wins while the campaign is a draft. */
  date: string;
  subject: string | null;
  stage: EmailStage;
  state: ApprovalState;
  needsApproval: boolean;
  plan: P | null;
  klaviyo: K | null;
}

/**
 * Plans + Klaviyo campaigns → one item per approvable thing. A plan linked
 * to a campaign is ONE item (the campaign isn't listed again). The subject
 * compared against the approval is Klaviyo's when the campaign is known,
 * otherwise the plan's own (for a linked plan whose campaign is out of
 * view, "unknown" — no false "changed").
 */
export function buildApprovalItems<P extends PlanForApproval, K extends KlaviyoForApproval>(input: {
  planned: readonly P[];
  klaviyo: readonly K[];
  approvals: readonly ApprovalLike[];
  today: string;
}): Array<ApprovalItem<P, K>> {
  const byKey = new Map(input.approvals.map(a => [a.key, a]));
  const kById = new Map(input.klaviyo.map(k => [k.id, k]));
  const linked = new Set<string>();
  const out: Array<ApprovalItem<P, K>> = [];
  for (const p of input.planned) {
    const k = p.klaviyoCampaignId ? kById.get(p.klaviyoCampaignId) ?? null : null;
    if (p.klaviyoCampaignId) linked.add(p.klaviyoCampaignId);
    const key = approvalKey({ kind: "plan", emailId: p.id, klaviyoCampaignId: p.klaviyoCampaignId });
    const { stage } = effectiveStage(p, k);
    const subject = p.klaviyoCampaignId ? (k ? k.subject : undefined) : p.subject;
    const state = approvalState(byKey.get(key), subject);
    const date = k && k.status !== "Draft" ? k.date : p.sendDate;
    out.push({
      // Klaviyo's subject when we can see the campaign (even if it's still
      // blank there), otherwise the plan's own.
      key, kind: "plan", date, subject: subject === undefined ? p.subject : subject, stage, state,
      needsApproval: needsApproval({ date, stage, approval: state, today: input.today }),
      plan: p, klaviyo: k,
    });
  }
  for (const k of input.klaviyo) {
    if (linked.has(k.id)) continue;
    const stage = stageFromKlaviyo(k.status);
    if (!stage) continue;
    const key = klaviyoKey(k.id);
    const state = approvalState(byKey.get(key), k.subject);
    out.push({
      key, kind: "klaviyo", date: k.date, subject: k.subject, stage, state,
      needsApproval: needsApproval({ date: k.date, stage, approval: state, today: input.today }),
      plan: null, klaviyo: k,
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
}

/** "Approved by Graeme" / "Changed since approval" / "Needs approval" /
 *  "Not approved" — the badge words, one place. */
export function approvalBadge(state: ApprovalState, needs: boolean, approvedByName: string | null | undefined): { label: string; tone: "green" | "amber" | "grey" } {
  if (state === "approved") {
    const who = approvedByName?.trim().split(/\s+/)[0];
    return { label: who ? `Approved by ${who}` : "Approved", tone: "green" };
  }
  if (state === "changed") return { label: "Changed since approval", tone: "amber" };
  if (needs) return { label: "Needs approval", tone: "amber" };
  return { label: "Not approved", tone: "grey" };
}
