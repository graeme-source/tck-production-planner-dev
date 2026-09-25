import { describe, it, expect } from "vitest";
import {
  uploadedContractAccess, canSeeUploadedContract, canManageUploadedContracts,
  isAllowedContractFile, claudeCanRead,
} from "./uploaded-contract-access";

const OWNER = 7;

describe("uploaded contract visibility", () => {
  it("the founder / HR account sees and manages anyone's", () => {
    const hr = { viewerId: 1, viewerIsHr: true };
    expect(uploadedContractAccess(hr, OWNER)).toBe("manage");
    expect(canSeeUploadedContract(hr, OWNER)).toBe(true);
    expect(canManageUploadedContracts(hr)).toBe(true);
  });

  it("the employee sees their own, read-only", () => {
    const me = { viewerId: OWNER, viewerIsHr: false };
    expect(uploadedContractAccess(me, OWNER)).toBe("own");
    expect(canSeeUploadedContract(me, OWNER)).toBe(true);
    expect(canManageUploadedContracts(me)).toBe(false);
  });

  // Regression guard: People access opens personnel records, NOT pay.
  it("is never visible to a People-access user who isn't on the HR list", () => {
    const peopleManager = { viewerId: 3, viewerIsHr: false, viewerHasPeopleAccess: true };
    expect(uploadedContractAccess(peopleManager, OWNER)).toBe("none");
    expect(canSeeUploadedContract(peopleManager, OWNER)).toBe(false);
    expect(canManageUploadedContracts(peopleManager)).toBe(false);
  });

  it("another employee gets nothing (the route answers 404)", () => {
    const colleague = { viewerId: 8, viewerIsHr: false };
    expect(canSeeUploadedContract(colleague, OWNER)).toBe(false);
  });

  it("no session sees nothing, even if something claims HR", () => {
    expect(canSeeUploadedContract({ viewerId: null, viewerIsHr: true }, OWNER)).toBe(false);
    expect(canManageUploadedContracts({ viewerId: undefined, viewerIsHr: true })).toBe(false);
  });
});

describe("uploaded contract files", () => {
  it("takes PDFs and ordinary photos", () => {
    expect(isAllowedContractFile("application/pdf")).toBe(true);
    expect(isAllowedContractFile("image/jpeg")).toBe(true);
    expect(isAllowedContractFile("image/png")).toBe(true);
    expect(isAllowedContractFile("image/webp")).toBe(true);
  });
  it("refuses anything else", () => {
    expect(isAllowedContractFile("image/heic")).toBe(false);
    expect(isAllowedContractFile("application/msword")).toBe(false);
    expect(isAllowedContractFile(undefined)).toBe(false);
  });
  it("knows what Claude can read", () => {
    expect(claudeCanRead("application/pdf", 2_000_000)).toEqual({ ok: true });
    expect(claudeCanRead("image/jpeg", 3_000_000)).toEqual({ ok: true });
    expect(claudeCanRead("image/jpeg", 6 * 1024 * 1024).ok).toBe(false);
    expect(claudeCanRead("application/pdf", 40 * 1024 * 1024).ok).toBe(false);
  });
});
