import { describe, it, expect } from "vitest";
import {
  colleagueChaseUrl, managerChaseUrl, chaseLikePatternsForSpell, chaseLikePatternsForUser,
  chaseUrlIsForUser, colleagueChaseNotes, managerChaseNotes,
} from "./rtw-chase";

/** Minimal SQL LIKE (% only — chase tags contain no _) to prove the patterns. */
function like(value: string, pattern: string): boolean {
  const re = new RegExp(`^${pattern.split("%").map(p => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
  return re.test(value);
}

describe("chase urls", () => {
  it("managers land on the person's record; colleagues on their own forms", () => {
    expect(managerChaseUrl(4, "2026-08-24")).toBe("/people/4?spell=4:2026-08-24");
    expect(colleagueChaseUrl(4, "2026-08-24")).toBe("/return-to-work?spell=4:2026-08-24");
  });

  it("the spell patterns match the old AND new manager url, so the sweep never duplicates", () => {
    const [a, b] = chaseLikePatternsForSpell(4, "2026-08-24");
    const matches = (u: string) => like(u, a) || like(u, b);
    expect(matches("/return-to-work?user=4&spell=4:2026-08-24")).toBe(true); // before 2026-09-25
    expect(matches(managerChaseUrl(4, "2026-08-24"))).toBe(true);
    expect(matches(colleagueChaseUrl(4, "2026-08-24"))).toBe(true);
    expect(matches(managerChaseUrl(14, "2026-08-24"))).toBe(false);
  });

  // Regression: the close-on-sign query used `%spell=4:%`, which also
  // matched user 14's tag — signing one person's form closed another's chase.
  it("signing user 4's form never matches user 14's to-dos", () => {
    const [a, b] = chaseLikePatternsForUser(4);
    const matches = (u: string) => like(u, a) || like(u, b);
    expect(matches(managerChaseUrl(14, "2026-09-01"))).toBe(false);
    expect(matches(colleagueChaseUrl(14, "2026-09-01"))).toBe(false);
    expect(matches("/return-to-work?user=14&spell=14:2026-09-01")).toBe(false);
    expect(matches(managerChaseUrl(4, "2026-09-01"))).toBe(true);
    expect(chaseUrlIsForUser(managerChaseUrl(14, "2026-09-01"), 4)).toBe(false);
    expect(chaseUrlIsForUser(colleagueChaseUrl(4, "2026-09-01"), 4)).toBe(true);
  });
});

describe("chase wording", () => {
  it("names the absence type when it wasn't sickness", () => {
    const nozomi = { start: "2026-09-14", end: "2026-09-14", types: ["Dependants Leave"], sickness: false };
    expect(colleagueChaseNotes(nozomi)).toContain("absent — Dependants Leave on 2026-09-14");
    expect(managerChaseNotes(nozomi)).toContain("absent — Dependants Leave");
  });

  it("says off sick for sickness, and never names individuals as the only readers", () => {
    const sick = { start: "2026-08-03", end: "2026-08-05", types: ["Sick Leave"], sickness: true };
    expect(colleagueChaseNotes(sick)).toContain("off sick 2026-08-03 to 2026-08-05");
    expect(colleagueChaseNotes(sick)).not.toMatch(/Graeme|Lorna/);
    expect(colleagueChaseNotes(sick)).toContain("People access");
  });
});
