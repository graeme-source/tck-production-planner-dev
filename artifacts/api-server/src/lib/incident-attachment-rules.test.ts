import { describe, it, expect } from "vitest";
import {
  incidentMediaKind,
  incidentUploadProblem,
  isAddedAfterSigning,
  canRemoveIncidentAttachment,
  canDeleteIncidentReport,
} from "./incident-attachment-rules";

describe("incidentMediaKind", () => {
  it("classifies photos, including iPad HEIC", () => {
    expect(incidentMediaKind("image/jpeg")).toBe("image");
    expect(incidentMediaKind("IMAGE/HEIC")).toBe("image");
  });
  it("classifies videos", () => {
    expect(incidentMediaKind("video/quicktime")).toBe("video");
  });
  it("rejects anything else", () => {
    expect(incidentMediaKind("application/pdf")).toBeNull();
    expect(incidentMediaKind(undefined)).toBeNull();
  });
});

describe("incidentUploadProblem", () => {
  const MB = 1024 * 1024;
  it("accepts a normal photo and video", () => {
    expect(incidentUploadProblem("image/jpeg", 4 * MB)).toBeNull();
    expect(incidentUploadProblem("video/mp4", 80 * MB)).toBeNull();
  });
  it("refuses an oversized photo but allows the same size as video", () => {
    expect(incidentUploadProblem("image/png", 20 * MB)).toMatch(/Photo too large/);
    expect(incidentUploadProblem("video/mp4", 20 * MB)).toBeNull();
  });
  it("refuses oversized video and unknown types", () => {
    expect(incidentUploadProblem("video/mp4", 101 * MB)).toMatch(/shorter clip/);
    expect(incidentUploadProblem("text/plain", 10)).toMatch(/Photos and videos only/);
  });
});

describe("isAddedAfterSigning", () => {
  it("is false for an unsigned report", () => {
    expect(isAddedAfterSigning(null)).toBe(false);
    expect(isAddedAfterSigning(undefined)).toBe(false);
  });
  it("is true once signed", () => {
    expect(isAddedAfterSigning(new Date())).toBe(true);
    expect(isAddedAfterSigning("2026-10-13T09:00:00Z")).toBe(true);
  });
});

describe("canRemoveIncidentAttachment", () => {
  const base = { viewerUserId: 5, viewerRole: "viewer", uploadedByUserId: 5, deletedAt: null };
  it("lets the uploader remove their own", () => {
    expect(canRemoveIncidentAttachment(base).ok).toBe(true);
  });
  it("lets a manager or admin remove anyone's", () => {
    expect(canRemoveIncidentAttachment({ ...base, viewerUserId: 9, viewerRole: "manager" }).ok).toBe(true);
    expect(canRemoveIncidentAttachment({ ...base, viewerUserId: 9, viewerRole: "admin" }).ok).toBe(true);
  });
  it("blocks someone else who isn't a manager", () => {
    const d = canRemoveIncidentAttachment({ ...base, viewerUserId: 9 });
    expect(d).toMatchObject({ ok: false, status: 403 });
  });
  it("blocks when the uploader is unknown and the viewer isn't a manager", () => {
    expect(canRemoveIncidentAttachment({ ...base, uploadedByUserId: null }).ok).toBe(false);
  });
  it("won't remove twice", () => {
    expect(canRemoveIncidentAttachment({ ...base, viewerRole: "admin", deletedAt: new Date() })).toMatchObject({ ok: false, status: 409 });
  });
});

describe("canDeleteIncidentReport", () => {
  it("allows deleting an empty unsigned draft", () => {
    expect(canDeleteIncidentReport(null, 0).ok).toBe(true);
  });
  it("never deletes a signed report", () => {
    expect(canDeleteIncidentReport(new Date(), 0).ok).toBe(false);
  });
  it("never deletes a report holding evidence, even removed evidence", () => {
    expect(canDeleteIncidentReport(null, 1).ok).toBe(false);
  });
});
