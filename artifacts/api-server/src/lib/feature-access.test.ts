import { describe, it, expect } from "vitest";
import { decideFeatureAccess } from "./feature-access-rules";

describe("decideFeatureAccess — the two-key rule", () => {
  it("denies without a grant regardless of everything else", () => {
    expect(decideFeatureAccess({ granted: false, gateEnforced: false, requiredSopId: null, trainedOnSop: true }))
      .toEqual({ allowed: false, reason: "not_granted" });
    expect(decideFeatureAccess({ granted: false, gateEnforced: true, requiredSopId: 5, trainedOnSop: true }))
      .toEqual({ allowed: false, reason: "not_granted" });
  });

  it("gate OFF: a grant alone is enough, trained or not", () => {
    expect(decideFeatureAccess({ granted: true, gateEnforced: false, requiredSopId: 5, trainedOnSop: false }).allowed).toBe(true);
  });

  it("gate ON: untrained users wait, trained users pass", () => {
    expect(decideFeatureAccess({ granted: true, gateEnforced: true, requiredSopId: 5, trainedOnSop: false }))
      .toEqual({ allowed: false, reason: "awaiting_training" });
    expect(decideFeatureAccess({ granted: true, gateEnforced: true, requiredSopId: 5, trainedOnSop: true }).allowed).toBe(true);
  });

  it("gate ON but the feature has no SOP set: grant alone is enough", () => {
    expect(decideFeatureAccess({ granted: true, gateEnforced: true, requiredSopId: null, trainedOnSop: false }).allowed).toBe(true);
  });
});
