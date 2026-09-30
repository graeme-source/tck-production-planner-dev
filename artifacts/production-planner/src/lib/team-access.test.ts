import { describe, expect, it } from "vitest";
import {
  accessSummary, accountLockedReason, extrasCount, featureSwitchState, filterTeam,
  groupPagesByLevel, pageBoardSummary, trainingBadge,
} from "./team-access";

const page = (baselineRole: "viewer" | "manager" | "admin") => ({ baselineRole });

describe("featureSwitchState", () => {
  it("shows role-covered features ticked, locked and labelled", () => {
    const s = featureSwitchState({ feature: page("viewer"), targetRole: "manager", targetIsFounder: false, granted: false, viewerIsFounder: false });
    expect(s).toEqual({ on: true, editable: false, source: "role", note: "Included with Manager" });
  });

  it("keeps role-covered features locked even with a leftover grant", () => {
    const s = featureSwitchState({ feature: page("manager"), targetRole: "admin", targetIsFounder: false, granted: true, viewerIsFounder: false });
    expect(s.source).toBe("role");
    expect(s.editable).toBe(false);
  });

  it("makes features above the role a switch that follows the grant", () => {
    const off = featureSwitchState({ feature: page("admin"), targetRole: "viewer", targetIsFounder: false, granted: false, viewerIsFounder: false });
    expect(off).toEqual({ on: false, editable: true, source: "none", note: null });
    const on = featureSwitchState({ feature: page("admin"), targetRole: "viewer", targetIsFounder: false, granted: true, viewerIsFounder: false });
    expect(on.on).toBe(true);
    expect(on.source).toBe("grant");
  });

  it("founder-only features: never from a role (even admin), and only Graeme can move them", () => {
    const f = { baselineRole: null, founderOnly: true };
    const forAdmin = featureSwitchState({ feature: f, targetRole: "admin", targetIsFounder: false, granted: false, viewerIsFounder: false });
    expect(forAdmin).toEqual({ on: false, editable: false, source: "none", note: "Only Graeme can change this" });
    const byFounder = featureSwitchState({ feature: f, targetRole: "admin", targetIsFounder: false, granted: true, viewerIsFounder: true });
    expect(byFounder).toEqual({ on: true, editable: true, source: "grant", note: null });
  });

  it("the founder's own account has everything and nothing to switch", () => {
    const s = featureSwitchState({ feature: { baselineRole: null, founderOnly: true }, targetRole: "admin", targetIsFounder: true, granted: false, viewerIsFounder: true });
    expect(s.on).toBe(true);
    expect(s.editable).toBe(false);
    expect(s.source).toBe("founder");
  });

  it("retired grants can only be switched off", () => {
    const held = featureSwitchState({ feature: { baselineRole: null, retired: true }, targetRole: "viewer", targetIsFounder: false, granted: true, viewerIsFounder: false });
    expect(held.editable).toBe(true);
    const notHeld = featureSwitchState({ feature: { baselineRole: null, retired: true }, targetRole: "viewer", targetIsFounder: false, granted: false, viewerIsFounder: false });
    expect(notHeld.editable).toBe(false);
  });
});

describe("trainingBadge", () => {
  it("says nothing without a grant or a required SOP", () => {
    expect(trainingBadge({ granted: false, requiredSopId: 4, trained: false, gateEnforced: true })).toBeNull();
    expect(trainingBadge({ granted: true, requiredSopId: null, trained: false, gateEnforced: true })).toBeNull();
  });
  it("distinguishes trained, locked (gate on) and not-yet (gate off)", () => {
    expect(trainingBadge({ granted: true, requiredSopId: 4, trained: true, gateEnforced: true })?.tone).toBe("good");
    expect(trainingBadge({ granted: true, requiredSopId: 4, trained: false, gateEnforced: true })?.label).toMatch(/Locked/);
    expect(trainingBadge({ granted: true, requiredSopId: 4, trained: false, gateEnforced: false })?.label).toMatch(/Not yet/);
  });
});

describe("extrasCount + accessSummary", () => {
  const features = [
    { key: "a", baselineRole: "viewer" as const },
    { key: "b", baselineRole: "manager" as const },
    { key: "c", baselineRole: "admin" as const },
    { key: "biz", baselineRole: null, founderOnly: true },
    { key: "old", baselineRole: null, retired: true },
  ];
  it("counts only grants above the role (not redundant or retired ones)", () => {
    const grantedKeys = new Set(["a", "b", "c", "biz", "old"]);
    expect(extrasCount({ features, grantedKeys, targetRole: "viewer", targetIsFounder: false })).toBe(3);
    expect(extrasCount({ features, grantedKeys, targetRole: "manager", targetIsFounder: false })).toBe(2);
    expect(extrasCount({ features, grantedKeys, targetRole: "admin", targetIsFounder: false })).toBe(1);
    expect(extrasCount({ features, grantedKeys, targetRole: "admin", targetIsFounder: true })).toBe(0);
  });
  it("reads the way Graeme described it", () => {
    expect(accessSummary({ role: "viewer", isFounder: false, extras: 3, peopleAccess: false })).toBe("Viewer + 3 extras");
    expect(accessSummary({ role: "viewer", isFounder: false, extras: 1, peopleAccess: false })).toBe("Viewer + 1 extra");
    expect(accessSummary({ role: "manager", isFounder: false, extras: 0, peopleAccess: true })).toBe("Manager · People access");
    expect(accessSummary({ role: "admin", isFounder: true, extras: 0, peopleAccess: true })).toBe("Founder");
  });
});

describe("accountLockedReason (mirrors the server's checkUserWrite rule 3)", () => {
  const plain = { id: 5, isFounder: false, hasPeopleAccess: false };
  it("leaves ordinary accounts open to any admin", () => {
    expect(accountLockedReason({ viewerIsFounder: false, viewerId: 1, target: plain })).toBeNull();
  });
  it("locks People-access and founder accounts for other admins", () => {
    expect(accountLockedReason({ viewerIsFounder: false, viewerId: 1, target: { ...plain, hasPeopleAccess: true } })).toMatch(/People access/);
    expect(accountLockedReason({ viewerIsFounder: false, viewerId: 1, target: { ...plain, isFounder: true } })).toMatch(/Graeme/);
  });
  it("lets the founder, or the owner, change them", () => {
    expect(accountLockedReason({ viewerIsFounder: true, viewerId: 1, target: { ...plain, hasPeopleAccess: true } })).toBeNull();
    expect(accountLockedReason({ viewerIsFounder: false, viewerId: 5, target: { ...plain, hasPeopleAccess: true } })).toBeNull();
  });
});

describe("filterTeam", () => {
  const people = [
    { name: "Zoe Baker", email: "zoe@x.co", isActive: true },
    { name: "Adam Cole", email: "adam@x.co", isActive: false },
    { name: "Lorna Day", email: "lorna@x.co", isActive: true },
  ];
  it("sorts by name and folds inactive people apart", () => {
    const r = filterTeam(people, "");
    expect(r.active.map(p => p.name)).toEqual(["Lorna Day", "Zoe Baker"]);
    expect(r.inactive.map(p => p.name)).toEqual(["Adam Cole"]);
  });
  it("matches every word against name or email", () => {
    expect(filterTeam(people, "lorna").active).toHaveLength(1);
    expect(filterTeam(people, "adam@").inactive).toHaveLength(1);
    expect(filterTeam(people, "zoe cole").active).toHaveLength(0);
  });
});

describe("page board", () => {
  const pages = [
    { minRole: "viewer" as const }, { minRole: "viewer" as const }, { minRole: "manager" as const }, { minRole: "admin" as const },
  ];
  it("groups pages into the three columns", () => {
    const g = groupPagesByLevel(pages);
    expect([g.viewer.length, g.manager.length, g.admin.length]).toEqual([2, 1, 1]);
  });
  it("summarises in one line", () => {
    expect(pageBoardSummary(pages)).toBe("4 pages: 2 everyone, 1 managers+, 1 admins only");
  });
});
