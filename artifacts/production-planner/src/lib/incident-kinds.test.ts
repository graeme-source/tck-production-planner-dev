import { describe, it, expect } from "vitest";
import { INCIDENT_CHOICES, INCIDENT_KINDS, INCIDENT_KIND_OPTIONS, kindForChoice } from "./incident-kinds";

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
