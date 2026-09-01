import { describe, it, expect } from "vitest";
import { buildStitchArgs, shouldAutoStitch, STILL_SECONDS, type StitchSegment } from "./before-after-stitch";

const photo: StitchSegment = { path: "/tmp/before.jpg", label: "Before", isVideo: false, hasAudio: false };
const videoWithSound: StitchSegment = { path: "/tmp/after.mp4", label: "After", isVideo: true, hasAudio: true };
const silentVideo: StitchSegment = { path: "/tmp/after.mp4", label: "After", isVideo: true, hasAudio: false, durationSeconds: 4.2 };
const FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

const argsFor = (segments: StitchSegment[], fontFile: string | null = FONT) =>
  buildStitchArgs({ segments, outputPath: "/tmp/out.mp4", fontFile });

describe("buildStitchArgs", () => {
  it("refuses to stitch without both halves", () => {
    expect(() => argsFor([photo])).toThrow(/before and an after/);
  });

  it("holds a still on screen instead of flashing one frame", () => {
    const args = argsFor([photo, videoWithSound]);
    const loopAt = args.indexOf("-loop");
    expect(loopAt).toBeGreaterThan(-1);
    expect(args[loopAt + 1]).toBe("1");
    expect(args[loopAt + 3]).toBe(String(STILL_SECONDS));
  });

  it("doesn't loop a video", () => {
    const args = argsFor([videoWithSound, { ...videoWithSound, label: "After" }]);
    expect(args).not.toContain("-loop");
  });

  // The trap that aborts the whole render: mapping audio that isn't there.
  it("substitutes silence for a segment with no audio track", () => {
    const filter = argsFor([photo, silentVideo]).join(" ");
    // Two real inputs (0, 1), so the two silent sources are inputs 2 and 3.
    expect(filter).toContain("[2:a]");
    expect(filter).toContain("[3:a]");
    expect(filter).not.toContain("[1:a]");
  });

  it("uses a clip's own audio when it has some", () => {
    const filter = argsFor([photo, videoWithSound]).join(" ");
    expect(filter).toContain("[1:a]"); // the video's real audio
    expect(filter).toContain("[2:a]"); // silence standing in for the photo
  });

  // Regression: an early version used a fixed 3600-second ceiling for the
  // silence on a soundless video. concat stretches a segment to its longest
  // stream, so four seconds of footage came out as an hour-long clip — and
  // it failed silently, producing a perfectly valid, useless video.
  it("matches the silence to the clip's real length, not a ceiling", () => {
    const args = argsFor([photo, silentVideo]);
    expect(args).toContain("4.200");
    expect(args).not.toContain("3600");
  });

  it("refuses to guess when a silent video's length is unknown", () => {
    const { durationSeconds, ...noDuration } = silentVideo;
    expect(() => argsFor([photo, noDuration])).toThrow(/duration measured/);
  });

  it("refuses a nonsense duration rather than producing a broken clip", () => {
    expect(() => argsFor([photo, { ...silentVideo, durationSeconds: 0 }])).toThrow(/duration measured/);
    expect(() => argsFor([photo, { ...silentVideo, durationSeconds: NaN }])).toThrow(/duration measured/);
  });

  it("sizes the silence for a still to how long it's held on screen", () => {
    const args = argsFor([photo, videoWithSound]);
    expect(args).toContain(STILL_SECONDS.toFixed(3));
  });

  it("gives every segment one silent source when nothing has audio", () => {
    const args = argsFor([photo, silentVideo]);
    expect(args.filter(a => a.startsWith("anullsrc=")).length).toBe(2);
  });

  it("adds no silent sources when both halves have their own audio", () => {
    const args = argsFor([videoWithSound, { ...videoWithSound, label: "Before" }]);
    expect(args.filter(a => a.startsWith("anullsrc=")).length).toBe(0);
  });

  it("normalises both halves to one canvas so mixed orientations line up", () => {
    const filter = argsFor([photo, videoWithSound]).join(" ");
    expect(filter).toContain("scale=1280:720:force_original_aspect_ratio=decrease");
    expect(filter).toContain("pad=1280:720");
    expect(filter).toContain("setsar=1");
  });

  it("joins exactly the segments given, with sound", () => {
    expect(argsFor([photo, videoWithSound]).join(" ")).toContain("concat=n=2:v=1:a=1");
  });

  it("burns the captions in when a font is available", () => {
    const filter = argsFor([photo, videoWithSound]).join(" ");
    expect(filter).toContain("drawtext");
    expect(filter).toContain("text='BEFORE'");
    expect(filter).toContain("text='AFTER'");
  });

  // Production installs ffmpeg with --no-install-recommends, so a missing
  // font must cost the captions, not the whole video.
  it("skips captions rather than failing when no font is available", () => {
    const filter = argsFor([photo, videoWithSound], null).join(" ");
    expect(filter).not.toContain("drawtext");
    expect(filter).toContain("concat=n=2");
  });

  it("strips anything from a caption that ffmpeg would read as syntax", () => {
    const filter = argsFor([{ ...photo, label: "Be'fore:x\\y" }, videoWithSound], FONT).join(" ");
    expect(filter).toContain("text='BEFOREXY'");
  });

  it("streams from the first byte rather than waiting for the whole file", () => {
    expect(argsFor([photo, videoWithSound])).toContain("+faststart");
  });
});

describe("shouldAutoStitch", () => {
  const vid = (phase: string) => ({ kind: "video", phase });
  const img = (phase: string) => ({ kind: "image", phase });

  it("stitches when both halves exist and one is a video", () => {
    expect(shouldAutoStitch([vid("before"), img("after")])).toBe(true);
    expect(shouldAutoStitch([img("before"), vid("after")])).toBe(true);
    expect(shouldAutoStitch([vid("before"), vid("after")])).toBe(true);
  });

  it("leaves an all-photo pair to the feed's side-by-side images", () => {
    expect(shouldAutoStitch([img("before"), img("after")])).toBe(false);
  });

  // Regression for the missing-before case (improvement 33, 2026-08-27):
  // half a pair must never trigger a stitch, whatever else is attached.
  it("never stitches half a pair", () => {
    expect(shouldAutoStitch([vid("after")])).toBe(false);
    expect(shouldAutoStitch([vid("before")])).toBe(false);
    expect(shouldAutoStitch([])).toBe(false);
    expect(shouldAutoStitch([{ kind: "video", phase: null }, vid("after")])).toBe(false);
  });
});
