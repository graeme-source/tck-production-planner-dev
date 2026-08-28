// Pure decision logic for feature grants — no DB imports, so it stays
// unit-testable (charter: tests are pure logic only). DB-touching helpers
// live in feature-access.ts, which re-exports these.

export interface FeatureDecisionInput {
  granted: boolean;
  gateEnforced: boolean;
  requiredSopId: number | null;
  trainedOnSop: boolean;
}

export interface FeatureDecision {
  allowed: boolean;
  reason: "not_granted" | "awaiting_training" | "ok";
}

/** The two-key rule: granted AND (gate off | no SOP required | trained). */
export function decideFeatureAccess(input: FeatureDecisionInput): FeatureDecision {
  if (!input.granted) return { allowed: false, reason: "not_granted" };
  if (input.gateEnforced && input.requiredSopId !== null && !input.trainedOnSop) {
    return { allowed: false, reason: "awaiting_training" };
  }
  return { allowed: true, reason: "ok" };
}
