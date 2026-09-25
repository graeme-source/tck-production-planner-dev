import { describe, it, expect } from "vitest";
import {
  peopleAccessState, canGrantPeopleAccess, checkPeopleAccessChange, canClearPrivatePin,
} from "./people-access-rules";
import { isFounderEmail } from "./founder-email";

const FOUNDER = { id: 2, email: "graeme@thecalzonekitchen.co.uk" };
// Another admin — Jane on live. Admin, but NOT the founder.
const OTHER_ADMIN = { id: 7, email: "jane@thecalzonekitchen.co.uk" };
const LORNA_ID = 6;

describe("peopleAccessState", () => {
  it("is 'none' without access, whatever the PIN", () => {
    expect(peopleAccessState({ hasAccess: false, hasPrivatePin: false })).toBe("none");
    expect(peopleAccessState({ hasAccess: false, hasPrivatePin: true })).toBe("none");
  });
  it("is 'pin_needed' with access but no private PIN yet", () => {
    expect(peopleAccessState({ hasAccess: true, hasPrivatePin: false })).toBe("pin_needed");
  });
  it("is 'ready' with access and a private PIN", () => {
    expect(peopleAccessState({ hasAccess: true, hasPrivatePin: true })).toBe("ready");
  });
});

describe("who may grant People access", () => {
  it("is the founder account", () => {
    expect(canGrantPeopleAccess(FOUNDER)).toBe(true);
    expect(canGrantPeopleAccess({ email: "graeme@thecalzonekitchen.co.uk" })).toBe(true);
  });

  it("REGRESSION: a look-alike email in different case or with spaces is NOT the founder", () => {
    expect(canGrantPeopleAccess({ email: "GRAEME@thecalzonekitchen.co.uk" })).toBe(false);
    expect(canGrantPeopleAccess({ email: " graeme@thecalzonekitchen.co.uk" })).toBe(false);
  });

  it("REGRESSION: is not any other admin", () => {
    expect(canGrantPeopleAccess(OTHER_ADMIN)).toBe(false);
  });

  it("fails closed on a missing email", () => {
    expect(canGrantPeopleAccess({ email: null })).toBe(false);
    expect(canGrantPeopleAccess({ email: "" })).toBe(false);
    expect(isFounderEmail(undefined)).toBe(false);
  });
});

describe("checkPeopleAccessChange", () => {
  it("lets the founder grant and revoke someone else", () => {
    expect(checkPeopleAccessChange({ actor: FOUNDER, targetUserId: LORNA_ID, enable: true })).toEqual({ ok: true });
    expect(checkPeopleAccessChange({ actor: FOUNDER, targetUserId: LORNA_ID, enable: false })).toEqual({ ok: true });
  });

  it("REGRESSION: refuses a non-founder admin, granting or revoking", () => {
    for (const enable of [true, false]) {
      const r = checkPeopleAccessChange({ actor: OTHER_ADMIN, targetUserId: LORNA_ID, enable });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe(403);
    }
  });

  it("REGRESSION: refuses a non-founder granting THEMSELVES access", () => {
    const r = checkPeopleAccessChange({ actor: OTHER_ADMIN, targetUserId: OTHER_ADMIN.id, enable: true });
    expect(r.ok).toBe(false);
  });

  it("REGRESSION: the founder can't revoke their own access (no lockout)", () => {
    const r = checkPeopleAccessChange({ actor: FOUNDER, targetUserId: FOUNDER.id, enable: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("the founder switching their own access ON is harmless and allowed", () => {
    expect(checkPeopleAccessChange({ actor: FOUNDER, targetUserId: FOUNDER.id, enable: true })).toEqual({ ok: true });
  });
});

describe("canClearPrivatePin", () => {
  it("refuses while the person has People access (the PIN is compulsory)", () => {
    expect(canClearPrivatePin({ hasAccess: true })).toBe(false);
  });
  it("allows it once access is gone", () => {
    expect(canClearPrivatePin({ hasAccess: false })).toBe(true);
  });
});
