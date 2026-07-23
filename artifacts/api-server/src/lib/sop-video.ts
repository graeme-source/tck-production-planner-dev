/**
 * "Build SOP from video" pipeline.
 *
 * Takes a video already uploaded to an SOP step (BYTEA in sop_steps),
 * pulls evenly-spaced keyframes with ffmpeg, optionally transcribes the
 * audio (only when OPENAI_API_KEY is set — otherwise the analysis is
 * frames-only), and asks Claude to draft numbered SOP steps. Each drafted
 * step gets a full-quality frame extracted at its most illustrative
 * moment to use as the step photo.
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

export interface DraftedStep {
  description: string;
  startSec: number;
  endSec: number;
  photoJpeg: Buffer;
}

export interface BuildResult {
  suggestedTitle: string | null;
  transcriptUsed: boolean;
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

/** Optional Whisper transcription — only runs when OPENAI_API_KEY is set.
 *  Returns null (never throws) when unavailable or failed: the pipeline
 *  degrades gracefully to frames-only analysis. */
async function tryTranscribe(videoPath: string, workDir: string): Promise<string | null> {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) return null;
  try {
    const audioPath = path.join(workDir, "audio.mp3");
    await execFileAsync("ffmpeg", ["-i", videoPath, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k", "-y", audioPath]);
    const audio = await readFile(audioPath);
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(audio)], { type: "audio/mpeg" }), "audio.mp3");
    form.append("model", "whisper-1");
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!res.ok) {
      console.error("[sop-video] transcription failed:", res.status, await res.text().catch(() => ""));
      return null;
    }
    const json = await res.json() as { text?: string };
    return typeof json.text === "string" && json.text.trim() ? json.text.trim() : null;
  } catch (err) {
    console.error("[sop-video] transcription error (continuing frames-only):", err);
    return null;
  }
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

const DRAFT_TOOL = {
  name: "draft_sop_steps",
  description: "Record the drafted SOP steps extracted from the process video.",
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
            description: { type: "string", description: "Clear imperative instruction for the operator (2-4 sentences max). Include quantities, times, temperatures and equipment when visible or stated. Written for a new starter." },
            safetyNote: { type: ["string", "null"], description: "One short food-safety/HACCP or physical-safety note for this step if relevant (allergens, temps, knives, hot surfaces), else null." },
            startSec: { type: "number", description: "When this step starts in the video, in seconds." },
            endSec: { type: "number", description: "When this step ends in the video, in seconds. Must be > startSec." },
            bestFrameSec: { type: "number", description: "The single timestamp (seconds) that best illustrates this step for a still photo — hands in frame doing the action, not a transition." },
          },
          required: ["description", "safetyNote", "startSec", "endSec", "bestFrameSec"],
        },
      },
    },
    required: ["suggestedTitle", "steps"],
  },
};

interface RawDraftStep {
  description: string;
  safetyNote: string | null;
  startSec: number;
  endSec: number;
  bestFrameSec: number;
}

/**
 * Run the full pipeline on a video buffer. Returns drafted steps with
 * step photos. Throws with a human-readable message on failure (surfaced
 * directly to the operator by the route).
 */
export async function buildSopFromVideo(video: Buffer, videoMime: string): Promise<BuildResult> {
  const workDir = await mkdtemp(path.join(tmpdir(), "sop-video-"));
  try {
    const ext = videoMime.includes("webm") ? "webm" : videoMime.includes("quicktime") ? "mov" : videoMime.includes("ogg") ? "ogv" : "mp4";
    const videoPath = path.join(workDir, `input.${ext}`);
    await writeFile(videoPath, video);

    const duration = await ffprobeDurationSec(videoPath);

    // Evenly spaced analysis frames, avoiding the very first/last instants
    // (lens caps, phones being put down).
    const frameCount = Math.max(MIN_FRAMES, Math.min(MAX_FRAMES, Math.round(duration / 8)));
    const timestamps: number[] = [];
    for (let i = 0; i < frameCount; i++) {
      timestamps.push((duration * (i + 0.5)) / frameCount);
    }
    const frames: { atSec: number; jpeg: Buffer }[] = [];
    for (const [i, t] of timestamps.entries()) {
      const framePath = path.join(workDir, `frame-${i}.jpg`);
      await extractFrame(videoPath, t, framePath, ANALYSIS_FRAME_WIDTH, 4);
      frames.push({ atSec: t, jpeg: await readFile(framePath) });
    }

    const transcript = await tryTranscribe(videoPath, workDir);

    // Build the Claude message: timestamped frames, then the transcript
    // (when available), then the drafting instruction.
    const content: Array<Record<string, unknown>> = [];
    for (const [i, f] of frames.entries()) {
      content.push({ type: "text", text: `Frame ${i + 1} of ${frames.length} — at ${fmtTime(f.atSec)} (${f.atSec.toFixed(1)}s):` });
      content.push({
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: f.jpeg.toString("base64") },
      });
    }
    if (transcript) {
      content.push({ type: "text", text: `Audio transcript of the video (the operator narrating what they are doing):\n\n${transcript}` });
    }
    content.push({
      type: "text",
      text: `You are drafting a Standard Operating Procedure for The Calzone Kitchen, a UK food production kitchen. The frames above are evenly-spaced stills from a single continuous video (${fmtTime(duration)} long) of a team member performing a kitchen process${transcript ? ", and the audio transcript is included above" : " — there is no usable audio, so work from the frames alone"}.

Break the process into clear sequential steps an operator can follow. Guidance:
- Each step is one distinct action or stage — typically 3-10 steps for a video this length. Do not invent steps you cannot see${transcript ? " or hear" : ""}.
- Write instructions in the imperative for a new starter ("Spread the base sauce to 1cm from the edge"), including equipment, quantities, times and temperatures when visible${transcript ? " or stated" : ""}.
- Note food-safety points where relevant (hand washing, allergen handling, temperatures, knife/hot-surface safety) in the safetyNote field.
- startSec/endSec bound the step within the video timeline; bestFrameSec picks the most illustrative single moment for the step photo (mid-action, not a transition or blur).
- If parts of the video are unclear, still create the step but keep the instruction to what is certain — the team will edit the draft afterwards.`,
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
      Number.isFinite(s.bestFrameSec),
    );
    if (rawSteps.length === 0) throw new Error("The AI could not identify any steps in this video");

    // Extract a full-quality photo for each drafted step at its chosen moment.
    const steps: DraftedStep[] = [];
    for (const [i, s] of rawSteps.entries()) {
      const at = Math.min(Math.max(s.bestFrameSec, 0), Math.max(0, duration - 0.5));
      const photoPath = path.join(workDir, `step-${i}.jpg`);
      await extractFrame(videoPath, at, photoPath, STEP_PHOTO_WIDTH, 2);
      const description = s.safetyNote && s.safetyNote.trim()
        ? `${s.description.trim()}\n\n⚠ ${s.safetyNote.trim()}`
        : s.description.trim();
      steps.push({
        description,
        startSec: Number.isFinite(s.startSec) ? s.startSec : 0,
        endSec: Number.isFinite(s.endSec) ? s.endSec : duration,
        photoJpeg: await readFile(photoPath),
      });
    }

    return {
      suggestedTitle: typeof input.suggestedTitle === "string" && input.suggestedTitle.trim() ? input.suggestedTitle.trim() : null,
      transcriptUsed: transcript != null,
      steps,
    };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
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
