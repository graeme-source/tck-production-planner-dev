import { describe, it, expect } from "vitest";
import {
  INCIDENT_CHOICES, INCIDENT_KINDS, INCIDENT_KIND_OPTIONS, NEW_REPORT_IDLE, kindForChoice, newReportFlow,
} from "./incident-kinds";

describe("accident / incident chooser", () => {
  it("Accident starts an accident report and Incident starts an incident report", () => {
    expect(kindForChoice("accident")).toBe("accident");
    expect(kindForChoice("incident")).toBe("incident");
  });

  it("only ever maps to a type the diary stores", () => {
    for (const c of INCIDENT_CHOICES) expect(INCIDENT_KINDS).toContain(c.kind);
  });

  it("offers exactly the two cards, each with a meaning and two examples", () => {
    expect(INCIDENT_CHOICES.map(c => c.choice)).toEqual(["accident", "incident"]);
    for (const c of INCIDENT_CHOICES) {
      expect(c.meaning.length).toBeGreaterThan(10);
      expect(c.examples).toHaveLength(2);
    }
  });

  it("keeps every diary type (near miss included) reachable in the report's Type field", () => {
    expect(INCIDENT_KIND_OPTIONS.map(o => o.kind).sort()).toEqual([...INCIDENT_KINDS].sort());
  });
});

describe("diary 'New report' button", () => {
  it("opens the chooser instead of starting a report", () => {
    expect(newReportFlow(NEW_REPORT_IDLE, { type: "newReport" })).toEqual({ step: "choosing" });
  });

  it("starts a report of the picked type only once a card is chosen", () => {
    const choosing = newReportFlow(NEW_REPORT_IDLE, { type: "newReport" });
    expect(newReportFlow(choosing, { type: "choose", kind: kindForChoice("accident") })).toEqual({ step: "creating", kind: "accident" });
    expect(newReportFlow(NEW_REPORT_IDLE, { type: "choose", kind: "accident" })).toEqual(NEW_REPORT_IDLE);
  });

  it("closes when the report is created (it then opens inline), and returns to the cards if it fails", () => {
    const creating = { step: "creating", kind: "incident" } as const;
    expect(newReportFlow(creating, { type: "created" })).toEqual(NEW_REPORT_IDLE);
    expect(newReportFlow(creating, { type: "failed" })).toEqual({ step: "choosing" });
  });

  it("can be closed while choosing, but not mid-create", () => {
    expect(newReportFlow({ step: "choosing" }, { type: "cancel" })).toEqual(NEW_REPORT_IDLE);
    expect(newReportFlow({ step: "creating", kind: "incident" }, { type: "cancel" })).toEqual({ step: "creating", kind: "incident" });
  });
});
