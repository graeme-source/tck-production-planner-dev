import { describe, it, expect } from "vitest";
import { decideAccess } from "./access";
import {
  FOUNDER_EMAIL,
  FOUNDER_FEATURES,
  allowedFounderTabs,
  canGrantFeature,
  decideFounderFeatureAccess,
  isFounderOnlyFeature,
} from "./founder";

const TOMMY = "noithipt08@gmail.com";
const JANE = "jane@example.com";

describe("decideFounderFeatureAccess — The Business (Graeme, 2026-09-29)", () => {
  it("lets the founder into both", () => {
    for (const key of Object.values(FOUNDER_FEATURES)) {
      expect(decideFounderFeatureAccess({ email: FOUNDER_EMAIL, grantedKeys: [], featureKey: key })).toBe(true);
    }
  });

  it("lets a grantee into exactly what they were granted", () => {
    expect(decideFounderFeatureAccess({ email: TOMMY, grantedKeys: ["founder.sales"], featureKey: "founder.sales" })).toBe(true);
    expect(decideFounderFeatureAccess({ email: TOMMY, grantedKeys: ["founder.sales"], featureKey: "founder.numbers" })).toBe(false);
  });

  it("keeps everyone else out — no email, no grant, no entry", () => {
    expect(decideFounderFeatureAccess({ email: JANE, grantedKeys: [], featureKey: "founder.numbers" })).toBe(false);
    expect(decideFounderFeatureAccess({ email: null, grantedKeys: [], featureKey: "founder.numbers" })).toBe(false);
  });

  it("only matches the founder email exactly", () => {
    expect(decideFounderFeatureAccess({ email: FOUNDER_EMAIL.toUpperCase(), grantedKeys: [], featureKey: "founder.sales" })).toBe(false);
  });

  it("won't open an ordinary feature through the founder door, even with a grant", () => {
    expect(decideFounderFeatureAccess({ email: TOMMY, grantedKeys: ["settings.team"], featureKey: "settings.team" })).toBe(false);
  });
});

describe("decideAccess with founder-only features", () => {
  it("does NOT give an admin a founder-only feature", () => {
    expect(decideAccess({ userRole: "admin", grantedKeys: [], featureKey: "founder.numbers" })).toBe(false);
    expect(decideAccess({ userRole: "admin", grantedKeys: [], featureKey: "founder.sales" })).toBe(false);
  });

  it("opens it for the founder or a grant", () => {
    expect(decideAccess({ userRole: "admin", grantedKeys: [], featureKey: "founder.sales", isFounder: true })).toBe(true);
    expect(decideAccess({ userRole: "viewer", grantedKeys: ["founder.sales"], featureKey: "founder.sales" })).toBe(true);
  });

  it("still gives an admin every ordinary feature", () => {
    expect(decideAccess({ userRole: "admin", grantedKeys: [], featureKey: "settings.team" })).toBe(true);
  });
});

describe("canGrantFeature", () => {
  it("lets only the founder grant founder-only features", () => {
    expect(canGrantFeature({ actorEmail: FOUNDER_EMAIL, featureKey: "founder.numbers" })).toBe(true);
    expect(canGrantFeature({ actorEmail: JANE, featureKey: "founder.numbers" })).toBe(false);
    expect(canGrantFeature({ actorEmail: null, featureKey: "founder.sales" })).toBe(false);
  });

  it("leaves ordinary features to the admin check", () => {
    expect(canGrantFeature({ actorEmail: JANE, featureKey: "settings.sensors" })).toBe(true);
  });

  it("knows which keys are founder-only", () => {
    expect(isFounderOnlyFeature("founder.numbers")).toBe(true);
    expect(isFounderOnlyFeature("founder.sales")).toBe(true);
    expect(isFounderOnlyFeature("page.sales")).toBe(false);
    expect(isFounderOnlyFeature("founder.pnl")).toBe(false);
  });
});

describe("allowedFounderTabs", () => {
  const hrefs = (email: string | null, grantedKeys: string[]) =>
    allowedFounderTabs({ email, grantedKeys }).map(t => t.href);

  it("gives the founder every tab", () => {
    expect(hrefs(FOUNDER_EMAIL, [])).toEqual(["/founder/numbers", "/founder/focus", "/founder/pnl", "/founder/sales"]);
  });

  it("gives Tommy Numbers + Sales & Marketing only", () => {
    expect(hrefs(TOMMY, ["founder.numbers", "founder.sales"])).toEqual(["/founder/numbers", "/founder/sales"]);
  });

  it("gives a Sales-only grantee just that tab", () => {
    expect(hrefs(TOMMY, ["founder.sales"])).toEqual(["/founder/sales"]);
  });

  it("gives an admin with no grant nothing", () => {
    expect(hrefs(JANE, [])).toEqual([]);
  });

  it("never lists Contracts or Fix queue — they moved out of The Business", () => {
    const all = hrefs(FOUNDER_EMAIL, []);
    expect(all).not.toContain("/founder/contracts");
    expect(all).not.toContain("/founder/fix-queue");
  });
});
