import { describe, expect, it } from "vitest";
import { notificationCentreRecipients } from "./improvement-notify-policy";
import { commentRecipients } from "./improvement-thread";
import { ratingRecipients } from "./improvement-rating-notify";

// Regression (Graeme, 27 Oct 2026): every finished improvement put a
// "Great news — X made an improvement" row in EVERYONE's notification
// centre. The nav badge already does that job; the bell is for things that
// are personally yours.
describe("who the notification centre tells about an improvement", () => {
  it("an improvement being made tells nobody", () => {
    expect(notificationCentreRecipients({ kind: "made" })).toEqual([]);
  });

  it("a reply on the Comments & photos timeline still reaches the people it belongs to", () => {
    const people = commentRecipients({
      commenterId: 1, // Graeme replies
      submittedBy: 7, // Jane logged it
      creditedUserIds: [7, 9],
      earlierCommenterIds: [1, 12],
    });
    expect(notificationCentreRecipients({ kind: "comment", recipientIds: people.map(p => p.userId) }))
      .toEqual([7, 9, 12]);
  });

  it("a rating rise still reaches the people credited", () => {
    const send = ratingRecipients({
      oldWeight: 1, newWeight: 3, creditedUserIds: [7, 9], setByUserId: 1, alreadyTold: new Map(),
    });
    expect(send).not.toBeNull();
    expect(notificationCentreRecipients({ kind: "rating", recipientIds: send!.userIds }).sort())
      .toEqual([7, 9]);
  });

  it("each person once, and never a missing user", () => {
    expect(notificationCentreRecipients({ kind: "comment", recipientIds: [7, 7, 0, -1, 9] })).toEqual([7, 9]);
  });
});
