import { describe, expect, it } from "vitest";
import { checkUserWrite, namesOnlyRow, userListView } from "./user-admin-rules";
import { FOUNDER_EMAIL } from "./founder-email";

const founder = { id: 1, email: FOUNDER_EMAIL, role: "admin" };
const admin = { id: 2, email: "jane@example.com", role: "admin" };
const manager = { id: 3, email: "dave@example.com", role: "manager" };
const viewer = { id: 4, email: "kitchen@example.com", role: "viewer" };
const lorna = { id: 5, email: "lorna@example.com", hasPeopleAccess: true };
const staff = { id: 6, email: "staff@example.com", hasPeopleAccess: false };

describe("users API access (regression: any signed-in account could edit any account)", () => {
  it("gives only admins the full users list", () => {
    expect(userListView(founder)).toBe("full");
    expect(userListView(admin)).toBe("full");
    expect(userListView(manager)).toBe("names");
    expect(userListView(viewer)).toBe("names");
  });

  it("strips everything but the name fields for non-admins", () => {
    const row = { id: 9, name: "Sam", role: "viewer", isActive: true, avatarUrl: null, email: "sam@example.com", plandayEmployeeId: 42 };
    expect(namesOnlyRow(row)).toEqual({ id: 9, name: "Sam", role: "viewer", isActive: true, avatarUrl: null });
  });

  it("refuses every write from a non-admin — including promoting themselves", () => {
    expect(checkUserWrite({ actor: viewer, target: null }).ok).toBe(false);
    expect(checkUserWrite({ actor: viewer, target: { ...staff, id: viewer.id, hasPeopleAccess: false } }).ok).toBe(false);
    expect(checkUserWrite({ actor: manager, target: staff }).ok).toBe(false);
  });

  it("lets an admin create and edit ordinary accounts", () => {
    expect(checkUserWrite({ actor: admin, target: null }).ok).toBe(true);
    expect(checkUserWrite({ actor: admin, target: staff }).ok).toBe(true);
  });

  it("stops an admin changing an account with People access, or the founder's", () => {
    expect(checkUserWrite({ actor: admin, target: lorna }).ok).toBe(false);
    expect(checkUserWrite({ actor: admin, target: { id: founder.id, email: FOUNDER_EMAIL, hasPeopleAccess: true } }).ok).toBe(false);
  });

  it("lets the founder, or the account's owner, change a People-access account", () => {
    expect(checkUserWrite({ actor: founder, target: lorna }).ok).toBe(true);
    expect(checkUserWrite({ actor: { id: lorna.id, email: lorna.email, role: "admin" }, target: lorna }).ok).toBe(true);
  });
});
