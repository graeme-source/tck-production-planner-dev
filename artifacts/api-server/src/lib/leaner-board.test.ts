import { describe, expect, it } from "vitest";
import { leanerBoardRows } from "./leaner-board";
import { FOUNDER_EMAIL } from "./founder-email";

describe("Leaner-board rows", () => {
  it("leaves the founder off and keeps everyone else, in order", () => {
    const rows = [
      { name: "Graeme", email: FOUNDER_EMAIL },
      { name: "Bodan", email: "bodan@example.com" },
      { name: "Unknown", email: null },
    ];
    expect(leanerBoardRows(rows).map(r => r.name)).toEqual(["Bodan", "Unknown"]);
  });

  it("only drops the exact founder email", () => {
    expect(leanerBoardRows([{ email: FOUNDER_EMAIL.toUpperCase() }])).toHaveLength(1);
  });
});
