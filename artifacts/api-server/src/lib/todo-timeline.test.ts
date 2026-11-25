import { describe, expect, it } from "vitest";
import { editAlreadyLogged, type LastTimelineRow } from "./todo-timeline";

const body = "Graeme Carter edited the task";
const last: LastTimelineRow = { kind: "event", user_id: 4, body, recent: true };

describe("editAlreadyLogged", () => {
  it("one line per sitting: the same person's edit is already the last thing said", () => {
    expect(editAlreadyLogged(last, 4, body)).toBe(true);
  });
  it("says it again after a while, or when nothing's been said", () => {
    expect(editAlreadyLogged({ ...last, recent: false }, 4, body)).toBe(false);
    expect(editAlreadyLogged(null, 4, body)).toBe(false);
  });
  it("says it again after someone else's edit, a comment, or another event", () => {
    expect(editAlreadyLogged({ ...last, user_id: 9, body: "Lorna edited the task" }, 4, body)).toBe(false);
    expect(editAlreadyLogged({ ...last, kind: "comment" }, 4, body)).toBe(false);
    expect(editAlreadyLogged({ ...last, body: "Graeme Carter created this task" }, 4, body)).toBe(false);
  });
});
