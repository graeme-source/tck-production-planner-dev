/**
 * Colours and small helpers for the marketing calendar (2026-10-20: phases +
 * Klaviyo emails). Phases are VIOLET bars; Klaviyo emails are TEAL chips —
 * a draft dashed, a scheduled one solid, a sent one faded.
 */

export const PHASE_TONE = {
  bar: "bg-violet-600 text-white",
  card: "border-violet-500/40",
  edge: "bg-violet-600",
  chip: "bg-violet-500/15 text-violet-800 dark:text-violet-200",
};

export const KLAVIYO_TONE = {
  solid: "bg-teal-600 text-white",
  draft: "border-2 border-dashed border-teal-600/70 bg-teal-500/10 text-teal-900 dark:text-teal-100",
  sent: "bg-teal-500/15 text-teal-900/70 dark:text-teal-100/70",
  icon: "text-teal-600",
};

/** "Approved" green and "Needs approval" amber — the only two states. */
export const APPROVAL_TONE = {
  approved: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border-emerald-500/40",
  needs_approval: "bg-amber-500/15 text-amber-900 dark:text-amber-200 border-amber-500/50",
} as const;

export function firstName(name: string | null | undefined): string {
  return name?.trim().split(/\s+/)[0] || "Someone";
}

/** "Draft" / "Scheduled" / "Sent" as the team says it. */
export function emailStatusLabel(status: string): string {
  if (status === "Draft") return "Draft in Klaviyo";
  if (status === "Sending") return "Sending";
  return status;
}
