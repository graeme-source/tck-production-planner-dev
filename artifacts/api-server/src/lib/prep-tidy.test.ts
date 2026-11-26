import { describe, it, expect } from "vitest";
import { countableFacts, missingFacts } from "./prep-tidy";

describe("prep tidy — nothing countable lost", () => {
  it("finds numbers, money, percentages, dates and times", () => {
    expect(countableFacts("Late 3 times, £12.75 an hour, 85% score, since 14/10/2026 at 7:30").sort())
      .toEqual(["14/10/2026", "3", "7:30", "85%", "£12.75"].sort());
  });
  it("is happy when everything's still there, however it's spaced", () => {
    expect(missingFacts("He was late 3 times and earns £12.75", "- Late 3 times\n- Pay £ 12.75")).toEqual([]);
    expect(missingFacts("1,200 packs", "- 1200 packs")).toEqual([]);
  });
  it("names what went missing", () => {
    expect(missingFacts("Late 3 times on 14/10 and 21/10", "- Late 3 times on 14/10")).toEqual(["21/10"]);
  });
});
