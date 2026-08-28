/**
 * "Build SOP from media" pipeline.
 *
 * Takes a process video and/or a set of photos, pulls evenly-spaced
 * keyframes from the video with ffmpeg, shows everything to Claude, and
 * asks it to draft numbered SOP steps. For each step the AI picks the
 * best illustration — a moment from the video (extracted as a
 * full-quality frame) or one of the supplied photos.
 *
 * Analysis is visual-only by design: narration/transcription support was
 * removed 2026-08-28 (Graeme: "we don't need narration — just the video
 * sliced into effective steps with clear simple instructions"), which
 * also dropped the OpenAI/Whisper dependency.
 *
 * ffmpeg/ffprobe must be on PATH: installed via Homebrew locally and
 * apt-get in the Dockerfile for Railway. All temp files live in a
 * per-run directory under os.tmpdir() and are removed afterwards.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { getClaudeClient, CLAUDE_MODELS } from "./ai/claude";

const execFileAsync = promisify(execFile);

// Keyframes sent to Claude for analysis: enough to see every stage of a
// kitchen process without blowing out the request size. ~720px JPEGs are
// 60-150KB each, well under Anthropic's 5MB-per-image limit.
const MIN_FRAMES = 8;
const MAX_FRAMES = 24;
const ANALYSIS_FRAME_WIDTH = 720;
// Step photos saved onto the drafted steps are extracted separately at
// higher quality.
const STEP_PHOTO_WIDTH = 1080;

export interface SuppliedPhoto {
  buffer: Buffer;
  mime: string; // image/jpeg | image/png | image/webp
}

export interface DraftedStep {
  description: string;
  startSec: number | null; // null when the build had no video
  endSec: number | null;
  photo: Buffer;
  photoMime: string;
}

export interface BuildResult {
  suggestedTitle: string | null;
  steps: DraftedStep[];
}

async function ffprobeDurationSec(videoPath: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "csv=p=0",
    videoPath,
  ]);
  const dur = Number(stdout.trim());
  if (!Number.isFinite(dur) || dur <= 0) throw new Error("Could not read video duration");
  return dur;
}

async function extractFrame(videoPath: string, atSec: number, outPath: string, width: number, quality: number): Promise<void> {
  await execFileAsync("ffmpeg", [
    "-ss", atSec.toFixed(2),
    "-i", videoPath,
    "-frames:v", "1",
    "-vf", `scale=${width}:-2`,
    "-q:v", String(quality),
    "-y", outPath,
  ]);
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

const DRAFT_TOOL = {
  name: "draft_sop_steps",
  description: "Record the drafted SOP steps extracted from the process media.",
  input_schema: {
    type: "object" as const,
    properties: {
      suggestedTitle: { type: ["string", "null"], description: "A short title for this SOP if the process is identifiable, e.g. 'Rolling and filling calzone bases'. Null if unclear." },
      steps: {
        type: "array",
        description: "The process broken into sequential operator steps.",
        items: {
          type: "object",
          properties: {
            description: { type: "string", description: "Clear imperative instruction for the operator (2-4 sentences max). Include quantities, times, temperatures and equipment when visible. Written for a new starter." },
            safetyNote: { type: ["string", "null"], description: "One short food-safety/HACCP or physical-safety note for this step if relevant (allergens, temps, knives, hot surfaces), else null." },
            startSec: { type: ["number", "null"], description: "When this step starts in the video, in seconds. Null when the step is not shown in the video." },
            endSec: { type: ["number", "null"], description: "When this step ends in the video, in seconds. Must be > startSec. Null when startSec is null." },
            bestFrameSec: { type: ["number", "null"], description: "The video timestamp (seconds) that best illustrates this step — hands in frame doing the action, not a transition. Use this OR suppliedPhotoNumber, never both." },
            suppliedPhotoNumber: { type: ["number", "null"], description: "The 1-based number of the supplied photo that best illustrates this step, when a supplied photo shows it better than any video moment (or no video exists). Use this OR bestFrameSec, never both." },
          },
          required: ["description", "safetyNote", "startSec", "endSec", "bestFrameSec", "suppliedPhotoNumber"],
        },
      },
    },
    required: ["suggestedTitle", "steps"],
  },
};

interface RawDraftStep {
  description: string;
  safetyNote: string | null;
  startSec: number | null;
  endSec: number | null;
  bestFrameSec: number | null;
  suppliedPhotoNumber: number | null;
}

/**
 * Run the pipeline on a video and/or supplied photos. At least one input
 * is required. Returns drafted steps, each with the illustration the AI
 * chose (an extracted video frame or one of the supplied photos). Throws
 * with a human-readable message on failure (surfaced to the operator).
 */
export async function buildSopFromMedia(
  video: { buffer: Buffer; mime: string } | null,
  photos: SuppliedPhoto[],
): Promise<BuildResult> {
  if (!video && photos.length === 0) throw new Error("Provide a video or at least one photo");
  const workDir = await mkdtemp(path.join(tmpdir(), "sop-video-"));
  try {
    let duration = 0;
    let videoPath: string | null = null;
    const frames: { atSec: number; jpeg: Buffer }[] = [];

    if (video) {
      const ext = video.mime.includes("webm") ? "webm" : video.mime.includes("quicktime") ? "mov" : video.mime.includes("ogg") ? "ogv" : "mp4";
      videoPath = path.join(workDir, `input.${ext}`);
      await writeFile(videoPath, video.buffer);
      duration = await ffprobeDurationSec(videoPath);

      // Evenly spaced analysis frames, avoiding the very first/last instants
      // (lens caps, phones being put down).
      const frameCount = Math.max(MIN_FRAMES, Math.min(MAX_FRAMES, Math.round(duration / 8)));
      for (let i = 0; i < frameCount; i++) {
        const t = (duration * (i + 0.5)) / frameCount;
        const framePath = path.join(workDir, `frame-${i}.jpg`);
        await extractFrame(videoPath, t, framePath, ANALYSIS_FRAME_WIDTH, 4);
        frames.push({ atSec: t, jpeg: await readFile(framePath) });
      }
    }

    // Supplied photos are shrunk for ANALYSIS only (phone photos are 4-6MB;
    // Anthropic's limit is 5MB per image and requests grow fast) — the
    // full-quality original is what lands on the step.
    const analysisPhotos: Buffer[] = [];
    for (const [i, ph] of photos.entries()) {
      const inPath = path.join(workDir, `photo-${i}-in`);
      const outPath = path.join(workDir, `photo-${i}.jpg`);
      await writeFile(inPath, ph.buffer);
      await execFileAsync("ffmpeg", ["-i", inPath, "-vf", `scale='min(${ANALYSIS_FRAME_WIDTH},iw)':-2`, "-frames:v", "1", "-q:v", "4", "-y", outPath]);
      analysisPhotos.push(await readFile(outPath));
    }

    // Build the Claude message: timestamped video frames, then supplied
    // photos (numbered so the AI can pick them as step illustrations).
    const content: Array<Record<string, unknown>> = [];
    for (const [i, f] of frames.entries()) {
      content.push({ type: "text", text: `Video frame ${i + 1} of ${frames.length} — at ${fmtTime(f.atSec)} (${f.atSec.toFixed(1)}s):` });
      content.push({
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: f.jpeg.toString("base64") },
      });
    }
    for (const [i, jpeg] of analysisPhotos.entries()) {
      content.push({ type: "text", text: `Supplied photo ${i + 1} of ${analysisPhotos.length} (taken by the team — may show a stage of the process, equipment, or the finished result):` });
      content.push({
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: jpeg.toString("base64") },
      });
    }

    const mediaLine = video && photos.length > 0
      ? `The video frames above are evenly-spaced stills from a single continuous video (${fmtTime(duration)} long) of a team member performing a kitchen process, followed by ${photos.length} supplied photo(s) of the same process.`
      : video
        ? `The frames above are evenly-spaced stills from a single continuous video (${fmtTime(duration)} long) of a team member performing a kitchen process.`
        : `The ${photos.length} supplied photo(s) above show stages of a kitchen process, in the order they were taken.`;

    content.push({
      type: "text",
      text: `You are drafting a Standard Operating Procedure for The Calzone Kitchen, a UK food production kitchen. ${mediaLine} There is no audio — work from what you can see.

Think the process through logically from start to finish, then break it into clear sequential steps an operator can follow. Guidance:
- Each step is one distinct action or stage — do not invent steps you cannot see.
- Write instructions in the imperative for a new starter ("Spread the base sauce to 1cm from the edge"), including equipment, quantities, times and temperatures when visible.
- Note food-safety points where relevant (hand washing, allergen handling, temperatures, knife/hot-surface safety) in the safetyNote field.
- For each step choose the SINGLE best illustration: bestFrameSec for the most illustrative video moment (mid-action, not a transition or blur), OR suppliedPhotoNumber when a supplied photo shows the step better${video ? "" : " (there is no video, so every step must use a suppliedPhotoNumber"}${video ? "." : ")."} Never set both.
- startSec/endSec bound the step within the video timeline when the step appears in the video; null otherwise.
- If parts are unclear, still create the step but keep the instruction to what is certain — the team will edit the draft afterwards.`,
    });

    const client = getClaudeClient();
    const response = await client.messages.create({
      model: CLAUDE_MODELS.sonnet,
      max_tokens: 4096,
      tool_choice: { type: "tool", name: "draft_sop_steps" },
      tools: [DRAFT_TOOL],
      messages: [{ role: "user", content: content as never }],
    });
    const toolUse = response.content.find(b => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") throw new Error("The AI did not return drafted steps — try again");
    const input = toolUse.input as { suggestedTitle?: string | null; steps?: RawDraftStep[] };
    const rawSteps = (input.steps ?? []).filter(s =>
      typeof s.description === "string" && s.description.trim().length > 0 &&
      (Number.isFinite(s.bestFrameSec) || (s.suppliedPhotoNumber != null && photos[s.suppliedPhotoNumber - 1] != null)),
    );
    if (rawSteps.length === 0) throw new Error("The AI could not identify any steps in this media");

    // Resolve each step's illustration: extracted video frame or supplied photo.
    const steps: DraftedStep[] = [];
    for (const [i, s] of rawSteps.entries()) {
      let photo: Buffer;
      let photoMime: string;
      if (s.suppliedPhotoNumber != null && photos[s.suppliedPhotoNumber - 1]) {
        const chosen = photos[s.suppliedPhotoNumber - 1];
        photo = chosen.buffer;
        photoMime = chosen.mime;
      } else if (videoPath && Number.isFinite(s.bestFrameSec)) {
        const at = Math.min(Math.max(s.bestFrameSec as number, 0), Math.max(0, duration - 0.5));
        const photoPath = path.join(workDir, `step-${i}.jpg`);
        await extractFrame(videoPath, at, photoPath, STEP_PHOTO_WIDTH, 2);
        photo = await readFile(photoPath);
        photoMime = "image/jpeg";
      } else {
        continue; // no usable illustration — drop rather than invent
      }
      const description = s.safetyNote && s.safetyNote.trim()
        ? `${s.description.trim()}\n\n⚠ ${s.safetyNote.trim()}`
        : s.description.trim();
      steps.push({
        description,
        startSec: Number.isFinite(s.startSec) ? (s.startSec as number) : null,
        endSec: Number.isFinite(s.endSec) ? (s.endSec as number) : null,
        photo,
        photoMime,
      });
    }
    if (steps.length === 0) throw new Error("The AI could not illustrate any steps from this media");

    return {
      suggestedTitle: typeof input.suggestedTitle === "string" && input.suggestedTitle.trim() ? input.suggestedTitle.trim() : null,
      steps,
    };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Video-only wrapper kept for the per-step "Build SOP from video" button. */
export async function buildSopFromVideo(video: Buffer, videoMime: string): Promise<BuildResult> {
  return buildSopFromMedia({ buffer: video, mime: videoMime }, []);
}

/** Quick availability probe so the route can fail with a clear message
 *  instead of a spawn ENOENT stack when ffmpeg isn't installed. */
export async function ffmpegAvailable(): Promise<boolean> {
  try {
    await execFileAsync("ffmpeg", ["-version"]);
    return true;
  } catch {
    return false;
  }
}
