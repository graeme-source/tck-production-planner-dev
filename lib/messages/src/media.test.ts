import { describe, it, expect } from "vitest";
import {
  mediaKindOf, mediaProblem, formatDuration, maxSecondsAtThisQuality, sayDuration, mediaPreview,
  bodyOrMediaPreview, canFetchMessageMedia, attachProblem, mediaGrid, stepIndex,
  MESSAGE_IMAGE_MAX_BYTES, MESSAGE_VIDEO_MAX_BYTES, MAX_ATTACHMENTS_PER_MESSAGE,
  type MediaAccessFacts,
} from "./index";
import type { Audience, MessageFacts, Viewer } from "./index";

const MB = 1024 * 1024;
const aud = (p: Partial<Audience>): Audience => ({ everyone: false, stations: [], userIds: [], ...p });
const viewer = (p: Partial<Viewer>): Viewer => ({ userId: 50, role: "viewer", stations: [], ...p });
const sent = (audience: Audience, extra: Partial<MessageFacts & { deleted: boolean }> = {}): MediaAccessFacts => ({
  uploadedBy: 3,
  messageId: 100,
  message: { audience, senderUserId: 3, parentSenderUserId: null, mentionedUserIds: [], deleted: false, ...extra },
});

describe("file types and limits (same as to-do / improvement attachments)", () => {
  it("knows photos and videos, and nothing else", () => {
    expect(mediaKindOf("image/jpeg")).toBe("image");
    expect(mediaKindOf("IMAGE/PNG")).toBe("image");
    expect(mediaKindOf("video/quicktime")).toBe("video");
    expect(mediaKindOf("video/mp4; codecs=avc1")).toBe("video");
    expect(mediaKindOf("application/pdf")).toBeNull();
    expect(mediaKindOf("image/heic")).toBeNull();
  });

  it("limits are 10 MB per photo and 100 MB per video", () => {
    expect(MESSAGE_IMAGE_MAX_BYTES).toBe(10 * MB);
    expect(MESSAGE_VIDEO_MAX_BYTES).toBe(100 * MB);
  });

  it("accepts files at the limit", () => {
    expect(mediaProblem({ mime: "image/jpeg", sizeBytes: 10 * MB })).toBeNull();
    expect(mediaProblem({ mime: "video/mp4", sizeBytes: 100 * MB })).toBeNull();
  });

  it("refuses a big photo plainly", () => {
    expect(mediaProblem({ mime: "image/jpeg", sizeBytes: 11 * MB })).toBe("Photo too large — max 10 MB");
  });

  it("says how long a video may be at the quality of THIS clip", () => {
    // 200 MB over 100 s = 2 MB/s → 100 MB is 50 seconds.
    const p = mediaProblem({ mime: "video/quicktime", sizeBytes: 200 * MB, durationSeconds: 100 });
    expect(p).toMatch(/^Video too long — max 100 MB, about 50 seconds at this quality/);
  });

  it("falls back to a typical iPad rate when the length is unknown", () => {
    const p = mediaProblem({ mime: "video/mp4", sizeBytes: 150 * MB, durationSeconds: null });
    expect(p).toMatch(/^Video too long — max 100 MB, about 55 seconds/);
  });

  it("refuses other kinds of file and empty ones", () => {
    expect(mediaProblem({ mime: "application/pdf", sizeBytes: 1000 })).toMatch(/can't be sent/);
    expect(mediaProblem({ mime: "image/png", sizeBytes: 0 })).toBe("That file is empty");
  });
});

describe("durations", () => {
  it("formats like a video player", () => {
    expect(formatDuration(7.4)).toBe("0:07");
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(3723)).toBe("1:02:03");
    expect(formatDuration(-3)).toBe("0:00");
  });

  it("rounds the allowed length to something sayable", () => {
    expect(maxSecondsAtThisQuality(10 * MB, 10)).toBe(100); // 1 MB/s → 100 s
    expect(maxSecondsAtThisQuality(1 * MB, 10)).toBe(990);  // 0.1 MB/s → 1000 s → 15 s steps
    expect(maxSecondsAtThisQuality(500 * MB, 1)).toBe(5);   // never says "0 seconds"
  });

  it("says it in words", () => {
    expect(sayDuration(45)).toBe("about 45 seconds");
    expect(sayDuration(60)).toBe("about 1 minute");
    expect(sayDuration(150)).toBe("about 2 minutes 30 seconds");
  });
});

describe("preview text when there's no caption", () => {
  it("📷 Photo / 🎥 Video", () => {
    expect(mediaPreview(["image"])).toBe("📷 Photo");
    expect(mediaPreview(["video"])).toBe("🎥 Video");
    expect(mediaPreview(["image", "image", "image"])).toBe("📷 3 photos");
    expect(mediaPreview(["image", "video", "video"])).toBe("📷 Photo · 🎥 2 videos");
    expect(mediaPreview([])).toBe("");
  });

  it("uses the caption when there is one", () => {
    expect(bodyOrMediaPreview("", ["video"])).toBe("🎥 Video");
    expect(bodyOrMediaPreview("  ", ["image"])).toBe("📷 Photo");
    expect(bodyOrMediaPreview("Look at this seal", ["image"])).toBe("📷 Look at this seal");
    expect(bodyOrMediaPreview("Leak again", ["video"])).toBe("🎥 Leak again");
    expect(bodyOrMediaPreview("Plain text", [])).toBe("Plain text");
  });
});

describe("who may fetch a message's photo or video (server-enforced)", () => {
  it("before it's sent, only the person who uploaded it", () => {
    const pending: MediaAccessFacts = { uploadedBy: 3, messageId: null, message: null };
    expect(canFetchMessageMedia(pending, viewer({ userId: 3 }))).toBe(true);
    expect(canFetchMessageMedia(pending, viewer({ userId: 4 }))).toBe(false);
    expect(canFetchMessageMedia(pending, viewer({ userId: 1, role: "admin" }))).toBe(false);
    expect(canFetchMessageMedia({ uploadedBy: null, messageId: null, message: null }, viewer({ userId: 3 }))).toBe(false);
  });

  it("in a person-to-person chat, only the people in it", () => {
    const a = sent(aud({ userIds: [3, 7] }));
    expect(canFetchMessageMedia(a, viewer({ userId: 3 }))).toBe(true);
    expect(canFetchMessageMedia(a, viewer({ userId: 7 }))).toBe(true);
    expect(canFetchMessageMedia(a, viewer({ userId: 8 }))).toBe(false);
  });

  it("managers and admins can't see a private chat's media either", () => {
    const a = sent(aud({ userIds: [3, 7] }));
    expect(canFetchMessageMedia(a, viewer({ userId: 1, role: "admin" }))).toBe(false);
    expect(canFetchMessageMedia(a, viewer({ userId: 2, role: "manager" }))).toBe(false);
  });

  it("someone @mentioned in it can see it, like the message", () => {
    const a = sent(aud({ userIds: [3, 7] }), { mentionedUserIds: [9] });
    expect(canFetchMessageMedia(a, viewer({ userId: 9 }))).toBe(true);
  });

  it("a station chat: that station's screen and managers", () => {
    const a = sent(aud({ stations: ["packing"] }));
    expect(canFetchMessageMedia(a, viewer({ userId: 20, stations: ["packing"] }))).toBe(true);
    expect(canFetchMessageMedia(a, viewer({ userId: 20, stations: ["ovens"] }))).toBe(false);
    expect(canFetchMessageMedia(a, viewer({ userId: 2, role: "manager" }))).toBe(true);
  });

  it("Everyone: everyone except external accountants", () => {
    const a = sent(aud({ everyone: true }));
    expect(canFetchMessageMedia(a, viewer({ userId: 20 }))).toBe(true);
    expect(canFetchMessageMedia(a, viewer({ userId: 21, accountantOnly: true }))).toBe(false);
  });

  it("a deleted message's media is gone for everybody, sender included", () => {
    const a = sent(aud({ userIds: [3, 7] }), { deleted: true });
    expect(canFetchMessageMedia(a, viewer({ userId: 3 }))).toBe(false);
    expect(canFetchMessageMedia(a, viewer({ userId: 7 }))).toBe(false);
  });

  it("an attached file whose message can't be found is refused", () => {
    expect(canFetchMessageMedia({ uploadedBy: 3, messageId: 5, message: null }, viewer({ userId: 3 }))).toBe(false);
  });
});

describe("attaching uploads to a message", () => {
  const mine = (id: number, messageId: number | null = null) => ({ id, uploadedBy: 3, messageId });

  it("accepts the sender's own unsent uploads", () => {
    expect(attachProblem([1, 2], [mine(1), mine(2)], 3)).toBeNull();
  });

  it("refuses someone else's upload", () => {
    expect(attachProblem([1], [{ id: 1, uploadedBy: 4, messageId: null }], 3)).toMatch(/missing/);
  });

  it("refuses one that's already been sent, a missing one, and duplicates", () => {
    expect(attachProblem([1], [mine(1, 77)], 3)).toMatch(/already been sent/);
    expect(attachProblem([1, 2], [mine(1)], 3)).toMatch(/missing/);
    expect(attachProblem([1, 1], [mine(1)], 3)).toMatch(/twice/);
  });

  it("caps the number per message", () => {
    const ids = Array.from({ length: MAX_ATTACHMENTS_PER_MESSAGE + 1 }, (_, i) => i + 1);
    expect(attachProblem(ids, ids.map(id => mine(id)), 3)).toMatch(/Up to 10/);
  });
});

describe("the bubble grid and the viewer", () => {
  it("lays out like WhatsApp", () => {
    expect(mediaGrid(0)).toEqual({ tiles: 0, overflow: 0, wide: [] });
    expect(mediaGrid(1)).toEqual({ tiles: 1, overflow: 0, wide: [0] });
    expect(mediaGrid(2)).toEqual({ tiles: 2, overflow: 0, wide: [] });
    expect(mediaGrid(3)).toEqual({ tiles: 3, overflow: 0, wide: [0] });
    expect(mediaGrid(4)).toEqual({ tiles: 4, overflow: 0, wide: [] });
    expect(mediaGrid(7)).toEqual({ tiles: 4, overflow: 3, wide: [] });
  });

  it("steps between items and stops at the ends", () => {
    expect(stepIndex(0, 1, 3)).toBe(1);
    expect(stepIndex(2, 1, 3)).toBe(2);
    expect(stepIndex(0, -1, 3)).toBe(0);
    expect(stepIndex(5, 0, 0)).toBe(0);
  });
});
