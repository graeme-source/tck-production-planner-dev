import { describe, expect, it } from "vitest";
import { canWriteAppSetting } from "./app-settings-write-access";

const admin = { signedIn: true, role: "admin" as const };
const manager = { signedIn: true, role: "manager" as const };
const viewer = { signedIn: true, role: "viewer" as const };
const nobody = { signedIn: false };

describe("canWriteAppSetting", () => {
  // Issue #420: a manager dragged the flavour order in Create Plan, the screen
  // said "Order auto-saved", but the server refused it — so the order was
  // never remembered and pork had to be moved by hand every day.
  it("lets a manager save the default production order", () => {
    expect(canWriteAppSetting("production_order_recipe_ids", manager)).toBe(true);
    expect(canWriteAppSetting("production_order_recipe_ids", admin)).toBe(true);
  });

  it("does not let a viewer or a signed-out visitor save the production order", () => {
    expect(canWriteAppSetting("production_order_recipe_ids", viewer)).toBe(false);
    expect(canWriteAppSetting("production_order_recipe_ids", nobody)).toBe(false);
  });

  it("keeps the other manager settings writable by managers", () => {
    expect(canWriteAppSetting("mac_cheese_extra_packs_2026-11-27", manager)).toBe(true);
    expect(canWriteAppSetting("order_email_template", manager)).toBe(true);
  });

  it("keeps every other setting admin-only", () => {
    expect(canWriteAppSetting("govee_api_key", manager)).toBe(false);
    expect(canWriteAppSetting("govee_api_key", viewer)).toBe(false);
    expect(canWriteAppSetting("govee_api_key", admin)).toBe(true);
  });

  it("lets anyone signed in write station keys, and nobody signed out", () => {
    expect(canWriteAppSetting("checklist_done_prep_2026-11-27", viewer)).toBe(true);
    expect(canWriteAppSetting("station_assignment_ovens", { signedIn: true })).toBe(true);
    expect(canWriteAppSetting("checklist_done_prep_2026-11-27", nobody)).toBe(false);
  });
});
