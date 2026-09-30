import { describe, expect, it } from "vitest";
import { FOUNDER_EMAIL } from "@workspace/feature-registry";
import { leanerboardRows } from "./leanerboard";

describe("leanerboardRows", () => {
  it("leaves the founder off the board and keeps everyone else in order", () => {
    const rows = [
      { name: "Bodan", email: "bodan@example.com", n: 9 },
      { name: "Founder", email: FOUNDER_EMAIL, n: 7 },
      { name: "Sam", email: "sam@example.com", n: 3 },
    ];
    expect(leanerboardRows(rows).map(r => r.name)).toEqual(["Bodan", "Sam"]);
  });

  it("keeps rows with no linked account (credited to someone since removed)", () => {
    expect(leanerboardRows([{ name: "Unknown", email: null }])).toHaveLength(1);
  });

  it("only hides the exact founder email, never a look-alike", () => {
    expect(leanerboardRows([{ email: FOUNDER_EMAIL.toUpperCase() }])).toHaveLength(1);
  });
});
