/**
 * Colours and small helpers for the marketing calendar (2026-10-20: phases +
 * Klaviyo emails). Phases are drawn in their own LIGHT pastel (Graeme,
 * 2026-10-21 — the old dark violet was distracting); Klaviyo emails are TEAL
 * chips — a draft dashed, a scheduled one solid, a sent one grey.
 */
import type { CSSProperties } from "react";
import { phaseColour } from "@workspace/marketing-calendar";

/**
 * A phase's colour as CSS variables, for the element that draws it (or any
 * parent). Pair with PHASE_CLS. The palette itself is data in
 * @workspace/marketing-calendar (phase-colours.ts); null = soft lavender.
 */
export function phaseVars(color: string | null | undefined): CSSProperties {
  const c = phaseColour(color);
  return {
    "--ph-bg": c.light.bg, "--ph-border": c.light.border, "--ph-text": c.light.text, "--ph-stripe": c.light.stripe,
    "--ph-bg-d": c.dark.bg, "--ph-border-d": c.dark.border, "--ph-text-d": c.dark.text, "--ph-stripe-d": c.dark.stripe,
  } as CSSProperties;
}

/** Classes that read phaseVars(): a filled bar / banner / chip, or a stripe / swatch. */
export const PHASE_CLS = {
  fill: "bg-[var(--ph-bg)] text-[var(--ph-text)] border-[var(--ph-border)] dark:bg-[var(--ph-bg-d)] dark:text-[var(--ph-text-d)] dark:border-[var(--ph-border-d)]",
  stripe: "bg-[var(--ph-stripe)] dark:bg-[var(--ph-stripe-d)]",
  text: "text-[var(--ph-text)] dark:text-[var(--ph-text-d)]",
} as const;

export const KLAVIYO_TONE = {
  solid: "bg-teal-600 text-white",
  draft: "border-2 border-dashed border-teal-600/70 bg-teal-500/10 text-teal-900 dark:text-teal-100",
  sent: "bg-secondary text-muted-foreground border border-border",
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
