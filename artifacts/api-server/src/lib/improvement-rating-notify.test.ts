import { describe, expect, it } from "vitest";
import {
  RATING_NOTIFICATION_TYPE, ratingMessage, ratingOfNotificationType, ratingRecipients,
} from "./improvement-rating-notify";

const FOUNDER = 1;
const none = new Map<number, number>();
const send = (oldWeight: unknown, newWeight: unknown, credited: number[], alreadyTold = none) =>
  ratingRecipients({ oldWeight, newWeight, creditedUserIds: credited, setByUserId: FOUNDER, alreadyTold });

describe("who hears that their improvement was rated higher", () => {
  it("×1 → ×2 tells everyone credited", () => {
    expect(send(1, 2, [5, 6])).toEqual({ weight: 2, userIds: [5, 6] });
  });

  it("×1 → ×3 tells them at ×3", () => {
    expect(send(1, 3, [5])).toEqual({ weight: 3, userIds: [5] });
  });

  it("raising ×2 → ×3 tells them again, at ×3", () => {
    expect(send(2, 3, [5], new Map([[5, 2]]))).toEqual({ weight: 3, userIds: [5] });
  });

  it("lowering or removing sends nothing", () => {
    expect(send(3, 2, [5])).toBeNull();
    expect(send(2, 1, [5])).toBeNull();
    expect(send(3, 1, [5])).toBeNull();
  });

  it("the same weight again sends nothing", () => {
    expect(send(2, 2, [5])).toBeNull();
  });

  it("never twice for the same rating: ×2 → ×1 → ×2 is quiet the second time", () => {
    expect(send(1, 2, [5], new Map([[5, 2]]))).toBeNull();
  });

  it("someone already told about ×3 isn't told about ×2 after a change of mind", () => {
    expect(send(1, 2, [5, 6], new Map([[5, 3]]))).toEqual({ weight: 2, userIds: [6] });
  });

  it("the founder isn't told about his own rating", () => {
    expect(send(1, 2, [FOUNDER, 5])).toEqual({ weight: 2, userIds: [5] });
    expect(send(1, 3, [FOUNDER])).toBeNull();
  });

  it("odd stored values read as ×1; duplicates and bad ids are dropped", () => {
    expect(send(null, "3", [5, 5, 0, -2])).toEqual({ weight: 3, userIds: [5] });
  });
});

describe("the words", () => {
  it("names the rating and the credits", () => {
    expect(ratingMessage(2, "Labelled the water bottles").message)
      .toBe("⭐ Your improvement “Labelled the water bottles” was rated a Great one — ×2 credits");
    expect(ratingMessage(3, "New sheeter guard").message)
      .toBe("🏆 Your improvement “New sheeter guard” was rated Substantial — ×3 credits");
    expect(ratingMessage(3, "x").pushBody).toMatch(/rated higher than normal/);
  });

  it("one notification type per rating, read back both ways", () => {
    expect(ratingOfNotificationType(RATING_NOTIFICATION_TYPE[2])).toBe(2);
    expect(ratingOfNotificationType(RATING_NOTIFICATION_TYPE[3])).toBe(3);
    expect(ratingOfNotificationType("improvement")).toBeNull();
  });
});
