import { describe, it, expect } from "vitest";
import { decideAccess } from "./access";
import { FEATURE_REGISTRY, featureForPage, featureForSection, pageFeatureMap } from "./registry";

describe("decideAccess", () => {
  it("lets the role in when it clears the baseline", () => {
    expect(decideAccess({ userRole: "manager", grantedKeys: [], featureKey: "page.sales" })).toBe(true);
  });

  it("keeps the role out when it doesn't", () => {
    expect(decideAccess({ userRole: "viewer", grantedKeys: [], featureKey: "settings.sensors" })).toBe(false);
  });

  it("lets a grant open a door the role can't", () => {
    // The whole point: Temperature Sensors is admin-only, and this is how you
    // hand it to one person without making them an admin.
    expect(decideAccess({ userRole: "viewer", grantedKeys: ["settings.sensors"], featureKey: "settings.sensors" })).toBe(true);
  });

  it("keeps a grant to its own feature", () => {
    expect(decideAccess({ userRole: "viewer", grantedKeys: ["settings.sensors"], featureKey: "settings.team" })).toBe(false);
  });

  it("gives an admin everything", () => {
    expect(decideAccess({ userRole: "admin", grantedKeys: [], featureKey: "settings.team" })).toBe(true);
  });

  it("never takes access away — a grant only adds", () => {
    // A manager keeps Sales whether or not anything was granted.
    expect(decideAccess({ userRole: "manager", grantedKeys: ["settings.sensors"], featureKey: "page.sales" })).toBe(true);
  });

  it("prefers the live page baseline over the registry fallback", () => {
    // An admin has tightened Dispatches to manager in the access-level list.
    expect(decideAccess({ userRole: "viewer", grantedKeys: [], featureKey: "page.dispatches", baselineMinRole: "manager" })).toBe(false);
    expect(decideAccess({ userRole: "manager", grantedKeys: [], featureKey: "page.dispatches", baselineMinRole: "manager" })).toBe(true);
  });

  it("locks the door on a key nobody knows", () => {
    expect(decideAccess({ userRole: "manager", grantedKeys: [], featureKey: "page.does_not_exist" })).toBe(false);
  });
});

describe("the registry itself", () => {
  it("has no duplicate keys — a grant hangs off the key", () => {
    const keys = FEATURE_REGISTRY.map(f => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps the APC key that already has grants against it on live", () => {
    const apc = FEATURE_REGISTRY.find(f => f.key === "apc_label_printing");
    expect(apc?.page).toBe("/fulfilment");
  });

  it("gives every page feature a route, and every settings feature a section", () => {
    for (const f of FEATURE_REGISTRY) {
      if (f.kind === "page") expect(f.page, `${f.key} needs a page`).toBeTruthy();
      if (f.kind === "settings") expect(f.section, `${f.key} needs a section`).toBeTruthy();
    }
  });

  it("looks features up by route and by section", () => {
    expect(featureForPage("/fulfilment")?.key).toBe("apc_label_printing");
    expect(featureForSection("sensors")?.key).toBe("settings.sensors");
  });

  it("derives the page map the route guards used to hard-code", () => {
    expect(pageFeatureMap()["/fulfilment"]).toBe("apc_label_printing");
  });
});
