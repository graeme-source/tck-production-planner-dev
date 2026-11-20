import { describe, it, expect } from "vitest";
import { lessonSlideParts } from "./lesson-slide-parts";

const LEAVE_IT_BETTER = `**Leave it better than you found it**

- Every time you touch something, you can improve it
- Not perfect. Just better than you found it

**Today:** Notice one thing you touch that annoys you — and leave it better.`;

describe("lessonSlideParts", () => {
  it("keeps the bullets and the Today line, and drops the heading that repeats the title", () => {
    const p = lessonSlideParts(LEAVE_IT_BETTER);
    expect(p.bullets).toEqual(["Every time you touch something, you can improve it", "Not perfect. Just better than you found it"]);
    expect(p.messageLabel).toBe("Today");
    expect(p.message).toBe("Notice one thing you touch that annoys you — and leave it better.");
    expect(p.other).toEqual([]);
  });

  it("reads a Today's question line with the colon inside or outside the bold", () => {
    expect(lessonSlideParts("**Today's question:** Where's the waste?").messageLabel).toBe("Today's question");
    expect(lessonSlideParts("**Today's question**: x").other).toEqual(["**Today's question**: x"]);
    expect(lessonSlideParts("**Today: **Find one").message).toBe("Find one");
  });

  it("never loses a stray line", () => {
    const p = lessonSlideParts("Just a sentence.\n- one");
    expect(p.other).toEqual(["Just a sentence."]);
    expect(p.bullets).toEqual(["one"]);
    expect(lessonSlideParts("")).toEqual({ bullets: [], messageLabel: null, message: null, other: [], tableMd: null });
  });
});

describe("older lessons with a table", () => {
  it("keeps the table whole", () => {
    const p = lessonSlideParts("**Waste**\n\n| Waste | Example |\n|---|---|\n| Waiting | Oven |\n\n**Today:** Spot one");
    expect(p.tableMd).toBe("| Waste | Example |\n|---|---|\n| Waiting | Oven |");
    expect(p.other).toEqual([]);
    expect(p.message).toBe("Spot one");
  });
});
