import { describe, it, expect } from "vitest";
import { canUploadRtwAttachment, canDeleteRtwAttachment } from "./rtw-attachment-rules";

describe("canUploadRtwAttachment", () => {
  it("lets the colleague file documents while the form is a draft", () => {
    expect(canUploadRtwAttachment({ formStatus: "draft", isRtwManager: false })).toBe(true);
  });

  it("locks the colleague out once the form is signed", () => {
    expect(canUploadRtwAttachment({ formStatus: "complete", isRtwManager: false })).toBe(false);
  });

  it("lets RTW managers file documents at any point, signed or not", () => {
    expect(canUploadRtwAttachment({ formStatus: "draft", isRtwManager: true })).toBe(true);
    expect(canUploadRtwAttachment({ formStatus: "complete", isRtwManager: true })).toBe(true);
  });
});

describe("canDeleteRtwAttachment", () => {
  const base = { viewerUserId: 5 };

  it("lets the colleague remove their own upload while still a draft", () => {
    expect(canDeleteRtwAttachment({ ...base, formStatus: "draft", isRtwManager: false, uploadedByUserId: 5 })).toBe(true);
  });

  it("never lets the colleague remove someone else's upload", () => {
    expect(canDeleteRtwAttachment({ ...base, formStatus: "draft", isRtwManager: false, uploadedByUserId: 2 })).toBe(false);
  });

  it("locks the colleague out of deletions once signed, even their own", () => {
    expect(canDeleteRtwAttachment({ ...base, formStatus: "complete", isRtwManager: false, uploadedByUserId: 5 })).toBe(false);
  });

  it("treats an orphaned upload (deleted uploader account) as not the colleague's", () => {
    expect(canDeleteRtwAttachment({ ...base, formStatus: "draft", isRtwManager: false, uploadedByUserId: null })).toBe(false);
  });

  it("lets RTW managers remove anything at any point", () => {
    expect(canDeleteRtwAttachment({ ...base, formStatus: "complete", isRtwManager: true, uploadedByUserId: null })).toBe(true);
  });
});
