import { describe, expect, it } from "vitest";
import { latestTempRecord } from "./latest-temp-record";

// Fix queue #81: a mistyped pigs-in-blankets temperature on the Macaroni
// Cheese station can be re-recorded. The new reading is saved alongside the
// old one, and the screen must show the newest.
describe("latestTempRecord", () => {
  it("shows the re-recorded reading, whatever order the list is in", () => {
    // API order (newest first) with a fresh re-record appended to the end.
    const typo = { id: 5, recordedAt: "2026-10-22T09:00:00Z", temperatureC: "57.9" };
    const reRecorded = { id: 9, recordedAt: "2026-10-22T09:05:00Z", temperatureC: "75.9" };
    expect(latestTempRecord([typo, reRecorded])?.temperatureC).toBe("75.9");
    expect(latestTempRecord([reRecorded, typo])?.temperatureC).toBe("75.9");
  });

  it("breaks a same-time tie by the later id", () => {
    const a = { id: 1, recordedAt: "2026-10-22T09:00:00Z" };
    const b = { id: 2, recordedAt: "2026-10-22T09:00:00Z" };
    expect(latestTempRecord([b, a])?.id).toBe(2);
  });

  it("is null when nothing is recorded yet", () => {
    expect(latestTempRecord([])).toBeNull();
  });
});
