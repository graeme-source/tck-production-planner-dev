import { describe, it, expect } from "vitest";
import { summariseUploadFailures } from "./upload-failures";

describe("summariseUploadFailures", () => {
  it("stays silent when everything uploaded", () => {
    expect(summariseUploadFailures([], "the feed")).toBeNull();
    expect(
      summariseUploadFailures(
        [{ label: "your BEFORE video", ok: true }, { label: "your AFTER video", ok: true }],
        "the feed",
      ),
    ).toBeNull();
  });

  // The improvement-33 case (2026-08-27): before failed, after landed —
  // the person must be told exactly which clip is missing and where to
  // re-add it, not shown a success toast.
  it("names the one clip that was lost and where to re-add it", () => {
    const msg = summariseUploadFailures(
      [
        { label: "your BEFORE video", ok: false, error: "File too large (max 100MB) — trim it or record a shorter clip." },
        { label: "your AFTER video", ok: true },
      ],
      "the improvement in the feed",
    );
    expect(msg).toBe(
      "Your BEFORE video didn't upload (File too large (max 100MB) — trim it or record a shorter clip.). " +
        "Everything else is saved: open the improvement in the feed to add it again.",
    );
  });

  it("reads cleanly when the server gave no reason", () => {
    const msg = summariseUploadFailures([{ label: "your AFTER photo", ok: false }], "the feed");
    expect(msg).toBe("Your AFTER photo didn't upload. Everything else is saved: open the feed to add it again.");
  });

  it("lists several losses as one sentence", () => {
    const msg = summariseUploadFailures(
      [
        { label: "photo 1", ok: false },
        { label: "photo 2", ok: false, error: "The upload didn't make it to the server — check the connection and try again." },
        { label: "photo 3", ok: true },
      ],
      "the report",
    );
    expect(msg).toContain("Photo 1 and photo 2 didn't upload");
    expect(msg).toContain("add them again");
  });
});
