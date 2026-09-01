/**
 * Stitching a before and an after into one clip you can watch in one go
 * (Objective E — Graeme, 2026-08-26: "very easily review the before and
 * after in one go").
 *
 * The awkward part isn't the joining, it's that the two halves are never
 * alike. A before shot on an iPad in landscape, an after filmed in portrait
 * on a phone; one a photo, one a video; one with sound, one silent. Naively
 * concatenating those either fails outright or produces something unwatchable,
 * so every segment is normalised to the same canvas, frame rate and audio
 * layout first, and a still is held on screen for a few seconds.
 *
 * Two silent-failure traps this avoids, both confirmed against real ffmpeg:
 *   - Mapping the audio of a clip that has none aborts the whole render
 *     ("Stream map '1:a' matches no streams"), so every segment's audio is
 *     probed and silence substituted where there is none.
 *   - drawtext needs a real font file. The production image installs ffmpeg
 *     with --no-install-recommends, which brings no fonts, so the font is
 *     passed explicitly and its absence disables the captions rather than
 *     failing the render.
 *
 * The argument building is pure so it can be tested without running ffmpeg;
 * the running lives in improvement-media.ts.
 */

/** How long a still photo is held on screen. */
export const STILL_SECONDS = 3;

/** Everything is normalised to this — 16:9 suits the player on the page. */
export const CANVAS_WIDTH = 1280;
export const CANVAS_HEIGHT = 720;
export const OUTPUT_FPS = 30;

export interface StitchSegment {
  /** Path to the photo or video on disk. */
  path: string;
  /** Caption burned into the corner: "BEFORE" / "AFTER". */
  label: string;
  /** A still is looped for STILL_SECONDS; a video plays through. */
  isVideo: boolean;
  /** Whether this file actually carries an audio track. */
  hasAudio: boolean;
  /**
   * The clip's real length, required for a video with NO audio.
   *
   * concat stretches a segment to its longest stream, so the silence
   * standing in for a missing audio track has to be exactly as long as the
   * picture. Getting this wrong doesn't fail loudly — it silently produces
   * a video padded out to the length of the silence. An early version used
   * a 3600-second ceiling and produced hour-long clips from four seconds of
   * footage.
   */
  durationSeconds?: number;
}

export interface StitchOptions {
  segments: StitchSegment[];
  outputPath: string;
  /** Absolute path to a .ttf. Without one, captions are skipped. */
  fontFile?: string | null;
}

/** ffmpeg's filter syntax treats these as special — a caption is plain
 *  text, so anything that could be read as syntax is removed. */
function safeLabel(label: string): string {
  return label.replace(/[^A-Za-z0-9 _-]/g, "").slice(0, 40).toUpperCase();
}

/**
 * Build the full ffmpeg argument list.
 *
 * Inputs are laid out as: every segment's file first, then one silent audio
 * source per segment that needs one. Keeping the real files first means a
 * segment's video is always at a predictable index.
 */
export function buildStitchArgs({ segments, outputPath, fontFile }: StitchOptions): string[] {
  if (segments.length < 2) {
    throw new Error("Stitching needs a before and an after.");
  }

  const args: string[] = ["-y", "-loglevel", "error"];

  // Real inputs.
  for (const segment of segments) {
    if (!segment.isVideo) args.push("-loop", "1", "-t", String(STILL_SECONDS));
    args.push("-i", segment.path);
  }

  // One silent track per segment that has no audio of its own, each exactly
  // as long as the picture it accompanies — concat stretches a segment to
  // its longest stream, so silence that outlasts the footage pads the video
  // out to match it.
  const silenceIndexFor = new Map<number, number>();
  let nextInput = segments.length;
  for (const [i, segment] of segments.entries()) {
    if (segment.hasAudio) continue;
    let seconds: number;
    if (!segment.isVideo) {
      seconds = STILL_SECONDS;
    } else {
      if (!segment.durationSeconds || !Number.isFinite(segment.durationSeconds) || segment.durationSeconds <= 0) {
        throw new Error("A silent video needs its duration measured before it can be stitched.");
      }
      seconds = segment.durationSeconds;
    }
    args.push(
      "-f", "lavfi",
      "-t", seconds.toFixed(3),
      "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
    );
    silenceIndexFor.set(i, nextInput++);
  }

  const filters: string[] = [];
  const concatInputs: string[] = [];

  segments.forEach((segment, i) => {
    const caption = fontFile
      ? `,drawtext=fontfile=${fontFile}:text='${safeLabel(segment.label)}':fontcolor=white:fontsize=56:box=1:boxcolor=black@0.6:boxborderw=18:x=40:y=40`
      : "";
    filters.push(
      `[${i}:v]scale=${CANVAS_WIDTH}:${CANVAS_HEIGHT}:force_original_aspect_ratio=decrease,` +
      `pad=${CANVAS_WIDTH}:${CANVAS_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${OUTPUT_FPS}${caption}[v${i}]`,
    );

    const audioIndex = segment.hasAudio ? i : silenceIndexFor.get(i)!;
    filters.push(
      `[${audioIndex}:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[a${i}]`,
    );
    concatInputs.push(`[v${i}][a${i}]`);
  });

  filters.push(`${concatInputs.join("")}concat=n=${segments.length}:v=1:a=1[outv][outa]`);

  args.push(
    "-filter_complex", filters.join(";"),
    "-map", "[outv]",
    "-map", "[outa]",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "23",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    // Lets the video start playing before it has fully downloaded — it's
    // watched over the kitchen's wifi.
    "-movflags", "+faststart",
    outputPath,
  );

  return args;
}

/**
 * Whether a fresh attachment upload should re-stitch the improvement's clip
 * automatically: both halves present, and at least one of them a video. An
 * all-photo pair stays as the feed's side-by-side images — a video half
 * means only a joined clip can tell the whole story in one play.
 */
export function shouldAutoStitch(halves: Array<{ kind: string; phase: string | null }>): boolean {
  const before = halves.find(h => h.phase === "before");
  const after = halves.find(h => h.phase === "after");
  if (!before || !after) return false;
  return before.kind === "video" || after.kind === "video";
}
