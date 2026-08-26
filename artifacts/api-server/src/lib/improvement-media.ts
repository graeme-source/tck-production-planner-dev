/**
 * Running the before/after stitch (Objective E).
 *
 * Pulls the two halves out of Postgres, writes them to a scratch directory,
 * runs ffmpeg, and hands back the finished MP4. The argument building and
 * its edge cases live in before-after-stitch.ts, which is unit tested;
 * this file is the part that touches the disk and the process table.
 *
 * Everything is cleaned up afterwards, including when ffmpeg fails —
 * a kitchen video is tens of megabytes and the container's disk is small.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildStitchArgs, type StitchSegment } from "./before-after-stitch";

const execFileAsync = promisify(execFile);

/** Fonts the production image might have. The first that exists wins; with
 *  none, captions are skipped rather than the render failing. */
const FONT_CANDIDATES = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
  "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
  "/System/Library/Fonts/Supplemental/Arial Bold.ttf", // local dev on a Mac
];

async function findFont(): Promise<string | null> {
  for (const candidate of FONT_CANDIDATES) {
    try {
      await access(candidate);
      return candidate;
    } catch { /* try the next one */ }
  }
  return null;
}

/** Does this file actually carry an audio track? Mapping audio that isn't
 *  there aborts the whole render, so this is asked rather than assumed. */
export async function hasAudioTrack(filePath: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-select_streams", "a",
      "-show_entries", "stream=index",
      "-of", "csv=p=0",
      filePath,
    ]);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/** How long a clip runs, in seconds. Needed for a video with no audio: the
 *  silence standing in for it has to match exactly, or concat pads the
 *  picture out to whatever the silence's length happened to be. */
export async function videoDurationSeconds(filePath: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);
  const seconds = Number(stdout.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error("Couldn't work out how long that clip is.");
  }
  return seconds;
}

export interface StitchInput {
  /** The raw bytes as stored in improvement_attachments. */
  data: Buffer;
  /** "image" or "video". */
  kind: string;
  label: string;
}

/**
 * Join a before and an after into one MP4. Returns the finished bytes.
 *
 * `ffmpeg` must be on PATH — callers check `ffmpegAvailable()` first so the
 * team gets a sentence rather than a stack trace when it isn't.
 */
export async function stitchBeforeAfter(inputs: StitchInput[]): Promise<Buffer> {
  const workDir = await mkdtemp(path.join(tmpdir(), "improvement-stitch-"));
  try {
    const segments: StitchSegment[] = [];
    for (const [i, input] of inputs.entries()) {
      const isVideo = input.kind === "video";
      const file = path.join(workDir, `part-${i}.${isVideo ? "mp4" : "img"}`);
      await writeFile(file, input.data);
      // A still never has audio, so only videos are worth probing — and a
      // silent video also needs its length, to size the silence that stands
      // in for the missing track.
      const hasAudio = isVideo ? await hasAudioTrack(file) : false;
      segments.push({
        path: file,
        label: input.label,
        isVideo,
        hasAudio,
        ...(isVideo && !hasAudio ? { durationSeconds: await videoDurationSeconds(file) } : {}),
      });
    }

    const outputPath = path.join(workDir, "before-after.mp4");
    const args = buildStitchArgs({ segments, outputPath, fontFile: await findFont() });

    // Generous but finite: a couple of short clips should take seconds, and
    // a hung ffmpeg must not hold a request open forever.
    await execFileAsync("ffmpeg", args, { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 });

    return await readFile(outputPath);
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
