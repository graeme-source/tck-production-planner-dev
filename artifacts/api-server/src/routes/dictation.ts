/**
 * Dictation polish (Graeme, 2026-09-16).
 *
 * Typing on an iPad mid-production is slow and awkward, so improvements get
 * recorded as a rambled sentence or not at all. The station dictates with the
 * browser's own speech recognition (free, no vendor), and this endpoint does
 * the bit that makes dictation feel good: tidy the raw transcript into
 * something readable — punctuation, capitals, the "erm"s gone — WITHOUT
 * changing what was said.
 *
 * That last part is the whole risk. An improvement record that quietly gains
 * detail nobody said is worse than a messy one, so the prompt is written to
 * rewrite-not-invent, and the UI keeps the raw text one tap away.
 *
 * Runs on Haiku — the cheapest model, which is the right tool for
 * punctuation. Never blocks the user: if the key is missing, the model is
 * slow, or anything throws, the original text comes straight back and the
 * note saves exactly as dictated.
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate";
import { getClaudeClient, isClaudeConfigured, CLAUDE_MODELS } from "../lib/ai/claude";

const router: IRouter = Router();

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  next();
}

const PolishBody = z.object({
  text: z.string().trim().min(1).max(4000),
  /** What the field is for, so a title stays a title and a note stays a note. */
  context: z.enum(["title", "note"]).default("note"),
});

/** Kept tight on purpose: the model's job is punctuation and tidying, not
 *  authorship. Anything that reads like a new fact is a bug. */
const SYSTEM = [
  "You tidy up voice dictation from staff in a UK food production kitchen (The Calzone Kitchen).",
  "Return ONLY the cleaned-up text — no preamble, no quotes, no commentary, no markdown.",
  "",
  "Rules, in order of importance:",
  "1. NEVER add information that was not said. Do not invent causes, numbers, names or outcomes.",
  "2. Keep the speaker's own words and tone. This is a colleague's note, not a press release.",
  "3. Fix punctuation, capitalisation and obvious speech-to-text mishearings.",
  "4. Remove filler — erm, uh, you know, like, sort of — and false starts and repeated words.",
  "5. British English spelling.",
  "6. If the text is already clean, return it unchanged.",
  "7. If it is too garbled to be sure what was meant, return it unchanged rather than guessing.",
  "",
  "Kitchen vocabulary you may see: calzone, mac cheese, dough ball, sheeter, blast chiller,",
  "tape gun, tray, tin, batch, wonky (a reject), 8-pack, kanban, andon, SOP.",
].join("\n");

const CONTEXT_HINT: Record<"title" | "note", string> = {
  title: "This is a ONE-LINE title. Keep it under about 12 words, no trailing full stop.",
  note: "This is a short note of a sentence or two. Keep it brief.",
};

router.post("/polish", requireAuth, validate(PolishBody), async (req, res) => {
  const { text, context } = req.body as z.infer<typeof PolishBody>;

  // No key, no problem — hand the words straight back.
  if (!isClaudeConfigured()) { res.json({ polished: text, changed: false }); return; }

  try {
    const message = await getClaudeClient().messages.create(
      {
        model: CLAUDE_MODELS.haiku,
        max_tokens: 500,
        system: SYSTEM,
        messages: [{ role: "user", content: `${CONTEXT_HINT[context]}\n\nDictated text:\n${text}` }],
      },
      // Speed is the entire point of dictating. If the model is having a slow
      // moment the raw text is better than a spinner.
      { timeout: 8000 },
    );

    const out = message.content
      .map(b => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();

    if (!out) { res.json({ polished: text, changed: false }); return; }
    res.json({ polished: out, changed: out !== text });
  } catch (err) {
    console.warn("[dictation] polish failed, returning raw text:", err instanceof Error ? err.message : err);
    res.json({ polished: text, changed: false });
  }
});

export default router;
