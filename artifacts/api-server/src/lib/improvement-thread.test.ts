import { describe, expect, it } from "vitest";
import {
  buildImprovementThread, canDeleteComment, commentNotification, commentRecipients, commentSnippet,
  type ThreadInput,
} from "./improvement-thread";

const base: ThreadInput["improvement"] = {
  createdAt: "2026-10-20T09:00:00.000Z",
  doneAt: null,
  submittedByName: "Jane",
  creditNames: null,
  title: "Label the ice shelf",
  description: "So people stop hunting",
};
const viewer = { userId: 7, role: "viewer" };
const comment = (id: number, at: string, text: string, userId: number | null = 7, userName = "Graeme") =>
  ({ id, userId, userName, comment: text, createdAt: at });

describe("the improvement timeline", () => {
  it("puts the original submission at the top, then everything oldest first", () => {
    const entries = buildImprovementThread({
      improvement: base,
      comments: [
        comment(3, "2026-10-22T10:00:00.000Z", "third"),
        comment(1, "2026-10-21T10:00:00.000Z", "first"),
        comment(2, "2026-10-21T11:00:00.000Z", "second"),
      ],
      attachments: [],
      viewer,
    });
    expect(entries.map(e => e.key)).toEqual(["submitted", "comment-1", "comment-2", "comment-3"]);
  });

  it("interleaves the done moment and photo posts by time", () => {
    const entries = buildImprovementThread({
      improvement: { ...base, doneAt: "2026-10-21T12:00:00.000Z", creditNames: "Jane & Bodan" },
      comments: [
        comment(1, "2026-10-21T10:00:00.000Z", "Nice idea"),
        comment(2, "2026-10-22T08:00:00.000Z", ""),
      ],
      attachments: [{ id: 50, commentId: 2, kind: "image", phase: null }],
      viewer,
    });
    expect(entries.map(e => e.type)).toEqual(["submitted", "comment", "done", "comment"]);
    const last = entries[3];
    expect(last.type === "comment" && last.photos).toEqual([{ id: 50, kind: "image" }]);
  });

  it("keeps the submission first even when its clock is later than a comment (Fix queue imports)", () => {
    const entries = buildImprovementThread({
      improvement: { ...base, createdAt: "2026-10-25T09:00:00.000Z" },
      comments: [comment(1, "2026-10-24T09:00:00.000Z", "earlier")],
      attachments: [],
      viewer,
    });
    expect(entries[0].type).toBe("submitted");
  });

  it("files the improvement's own photos on the submission (before) and the done moment (after), never the stitched clip", () => {
    const entries = buildImprovementThread({
      improvement: { ...base, doneAt: "2026-10-21T12:00:00.000Z" },
      comments: [],
      attachments: [
        { id: 10, commentId: null, kind: "image", phase: "before" },
        { id: 11, commentId: null, kind: "video", phase: "after" },
        { id: 12, commentId: null, kind: "video", phase: "stitched" },
        { id: 13, commentId: null, kind: "image", phase: null },
      ],
      viewer,
    });
    const [submitted, done] = entries;
    expect(submitted.type === "submitted" && submitted.photos.map(p => p.id)).toEqual([10, 13]);
    expect(done.type === "done" && done.photos).toEqual([{ id: 11, kind: "video" }]);
  });

  it("shows every own photo on the submission while it isn't done", () => {
    const [submitted] = buildImprovementThread({
      improvement: base,
      comments: [],
      attachments: [
        { id: 11, commentId: null, kind: "image", phase: "after" },
        { id: 10, commentId: null, kind: "image", phase: "before" },
      ],
      viewer,
    });
    expect(submitted.type === "submitted" && submitted.photos.map(p => p.id)).toEqual([10, 11]);
  });

  it("drops a photo-only post whose photo has gone", () => {
    const entries = buildImprovementThread({
      improvement: base, comments: [comment(1, "2026-10-21T10:00:00.000Z", "   ")], attachments: [], viewer,
    });
    expect(entries).toHaveLength(1);
  });

  it("orders same-second comments by id", () => {
    const at = "2026-10-21T10:00:00.000Z";
    const entries = buildImprovementThread({
      improvement: base, comments: [comment(9, at, "b"), comment(4, at, "a")], attachments: [], viewer,
    });
    expect(entries.map(e => e.key)).toEqual(["submitted", "comment-4", "comment-9"]);
  });

  it("marks only the viewer's own comments deletable, unless they manage", () => {
    const input = (role: string) => buildImprovementThread({
      improvement: base,
      comments: [comment(1, "2026-10-21T10:00:00.000Z", "mine", 7), comment(2, "2026-10-21T11:00:00.000Z", "theirs", 8)],
      attachments: [],
      viewer: { userId: 7, role },
    }).flatMap(e => (e.type === "comment" ? [e.canDelete] : []));
    expect(input("viewer")).toEqual([true, false]);
    expect(input("manager")).toEqual([true, true]);
    expect(input("admin")).toEqual([true, true]);
  });
});

describe("who may delete a comment", () => {
  it("the author or a manager/admin", () => {
    expect(canDeleteComment({ userId: 5, role: "viewer" }, 5)).toBe(true);
    expect(canDeleteComment({ userId: 5, role: "viewer" }, 6)).toBe(false);
    expect(canDeleteComment({ userId: 5, role: "viewer" }, null)).toBe(false);
    expect(canDeleteComment({ userId: null, role: "viewer" }, null)).toBe(false);
    expect(canDeleteComment({ userId: 5, role: "manager" }, 6)).toBe(true);
  });
});

describe("who hears about a new comment", () => {
  it("tells whoever logged it and everyone credited, but not the commenter", () => {
    expect(commentRecipients({ commenterId: 1, submittedBy: 5, creditedUserIds: [5, 6, 1] }))
      .toEqual([{ userId: 5, reason: "owner" }, { userId: 6, reason: "owner" }]);
  });

  it("a Fix queue import: the reporter is credited and the issue's reporter is told", () => {
    // Imported improvements are logged as the reporter and credited to them.
    expect(commentRecipients({ commenterId: 1, submittedBy: 9, creditedUserIds: [9], issueReporterIds: [9] }))
      .toEqual([{ userId: 9, reason: "owner" }]);
    // Tagged from the issues list by a manager: the reporter isn't the logger.
    expect(commentRecipients({ commenterId: 1, submittedBy: 2, creditedUserIds: [], issueReporterIds: [9] }))
      .toEqual([{ userId: 2, reason: "owner" }, { userId: 9, reason: "owner" }]);
  });

  it("tells earlier commenters so a reply reaches the person who asked", () => {
    expect(commentRecipients({ commenterId: 5, submittedBy: 5, creditedUserIds: [5], earlierCommenterIds: [1, 5, null, 1] }))
      .toEqual([{ userId: 1, reason: "conversation" }]);
  });

  it("an owner who also commented is told once, as the owner", () => {
    expect(commentRecipients({ commenterId: 1, submittedBy: 5, creditedUserIds: [], earlierCommenterIds: [5] }))
      .toEqual([{ userId: 5, reason: "owner" }]);
  });

  it("nobody to tell when it's your own improvement and nobody else has spoken", () => {
    expect(commentRecipients({ commenterId: 5, submittedBy: 5, creditedUserIds: [5] })).toEqual([]);
  });

  it("ignores unknown people", () => {
    expect(commentRecipients({ commenterId: null, submittedBy: null, creditedUserIds: [0, -1] })).toEqual([]);
  });
});

describe("what the bell says", () => {
  it("a reply to the owner", () => {
    expect(commentNotification({ commenterName: "Graeme", title: "Ice shelf", text: "You can already do that from Settings", hasPhoto: false, reason: "owner" }).message)
      .toBe("Graeme replied on your improvement: “You can already do that from Settings”");
  });

  it("a reply to someone in the conversation names the improvement", () => {
    expect(commentNotification({ commenterName: "Jane", title: "Ice shelf", text: "Thanks!", hasPhoto: true, reason: "conversation" }).message)
      .toBe("Jane replied on “Ice shelf”: “Thanks!” 📷");
  });

  it("a photo with no words", () => {
    expect(commentNotification({ commenterName: "Graeme", title: "Ice shelf", text: "", hasPhoto: true, reason: "owner" }).message)
      .toBe("Graeme added a photo to your improvement “Ice shelf”");
  });

  it("long comments are cut to one line", () => {
    expect(commentSnippet("a\n\nb   c")).toBe("a b c");
    const long = commentSnippet("x".repeat(200));
    expect(long.length).toBe(80);
    expect(long.endsWith("…")).toBe(true);
  });
});
