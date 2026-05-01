import express, { Router, type IRouter, type Request, type Response } from "express";
import { readFileSync } from "fs";
import { resolve } from "path";
import { db, appSettingsTable } from "@workspace/db";
import { eq, desc, asc } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { getClaudeClient, isClaudeConfigured, CLAUDE_MODELS } from "../lib/ai/claude";
import {
  ALL_TOOL_DEFINITIONS,
  PROPOSAL_TOOL_NAMES,
  executeRecipeTool,
} from "../lib/ai/recipe-designer-tools";
import type Anthropic from "@anthropic-ai/sdk";

const router: IRouter = Router();

const PROMPTS_DIR = resolve(import.meta.dirname, "../prompts");

function loadPrompt(file: string): string {
  return readFileSync(resolve(PROMPTS_DIR, file), "utf8");
}

const RUBRIC = loadPrompt("recipe_design_profile.md");
const MEXICAN_BOX = loadPrompt("mexican_test_box.md");
const TEST_BOX_TOOL = loadPrompt("test_box_tool.md");

const MEMORY_KEY = "recipe_designer_memory";
const DEFAULT_MEMORY = `# Recipe Designer Memory

(empty — propose updates as design decisions are made)
`;

async function getMemory(): Promise<string> {
  const [row] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, MEMORY_KEY));
  return row?.value ?? DEFAULT_MEMORY;
}

async function setMemory(value: string): Promise<void> {
  await db
    .insert(appSettingsTable)
    .values({ key: MEMORY_KEY, value })
    .onConflictDoUpdate({
      target: appSettingsTable.key,
      set: { value, updatedAt: new Date() },
    });
}

const STATIC_PROMPT = `You are a recipe-design assistant for The Calzone Kitchen (TCK), a UK-based artisan food business. You're embedded in TCK's Production Planner app, talking to Graeme (founder).

Your job is to help design new calzone (and occasionally mac & cheese) recipes against TCK's design rubric.

## Tone & response style

Be conversational, like a knowledgeable colleague. Tight paragraphs and short bullets, no walls of text. Use **bold** for key numbers; do NOT use markdown headings (no #, ##, ###). Lead with the answer; offer follow-ups only when genuinely useful.

**Critical: do not narrate your tool use.** Never type things like "Let me look that up", "I'll check the database", "Searching ingredients now", "I'll fetch both in parallel", or any commentary about what you're about to do or just did with a tool. Just call the tool and answer with the result. The user sees a small status indicator separately — they don't need it in the chat too.

**Do not surface internal IDs** (recipe IDs, ingredient IDs, sub-recipe IDs) in your replies unless the user explicitly asks. Use names. The IDs are plumbing.

When you give numbers, give the relevant ones for the question — don't dump every field from get_recipe. A GPM question wants GPM%, RRP, COGS; not the full ingredient list unless it's pertinent.

## Tools

You have **read tools** that hit the live production planner database:
- list_recipes, get_recipe — inspect what TCK currently makes (Carnizone, etc.)
- search_ingredients, get_ingredient_costs — look up real pack costs and unit costs
- compute_gpm — server-side margin calc for a draft, before proposing it

You have **proposal tools** that the user must approve via a modal — they do NOT auto-write:
- propose_memory_update — for cross-session memory (campaigns, decisions, open questions)
- propose_recipe_draft — for adding a new recipe to the DB. Always run compute_gpm first; only propose if you clear 80% ex-labour, or be explicit in the rationale that you're below and asking for a call.

When the user asks "what's our X recipe?" or "how much does X cost?", call the tools silently and answer with real data — don't guess from memory.

## Memory

You have a persistent memory document (under "Current Memory" below). Use it to track active campaigns and locked-in decisions. Call propose_memory_update when something noteworthy is agreed.

---

## TCK Recipe Design Rubric

${RUBRIC}

---

## Active Campaign Reference: Mexican Test Box

${MEXICAN_BOX}

---

## Reference: Test Box Scheduling Tool (planned)

${TEST_BOX_TOOL}`;

// Allow image attachments — bump the json body limit on this router only.
const largeJson = express.json({ limit: "30mb" });

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_IMAGES_PER_MESSAGE = 10;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB per image (Anthropic limit)

type AnthropicTextBlock = { type: "text"; text: string };
type AnthropicImageBlock = { type: "image"; source: { type: "base64"; media_type: string; data: string } };
type AnthropicContentBlock = AnthropicTextBlock | AnthropicImageBlock;

type ChatMessage = {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
};

function validateMessage(m: unknown): m is ChatMessage {
  if (!m || typeof m !== "object") return false;
  const msg = m as { role?: unknown; content?: unknown };
  if (msg.role !== "user" && msg.role !== "assistant") return false;
  if (typeof msg.content === "string") return true;
  if (!Array.isArray(msg.content)) return false;
  let imageCount = 0;
  for (const block of msg.content) {
    if (!block || typeof block !== "object") return false;
    const b = block as { type?: unknown };
    if (b.type === "text") {
      if (typeof (block as AnthropicTextBlock).text !== "string") return false;
    } else if (b.type === "image") {
      const src = (block as AnthropicImageBlock).source;
      if (!src || src.type !== "base64") return false;
      if (typeof src.media_type !== "string" || !ALLOWED_IMAGE_TYPES.has(src.media_type)) return false;
      if (typeof src.data !== "string" || src.data.length === 0) return false;
      // Approx byte size from base64 length (4 b64 chars = 3 bytes)
      const approxBytes = Math.floor(src.data.length * 0.75);
      if (approxBytes > MAX_IMAGE_BYTES) return false;
      imageCount++;
      if (imageCount > MAX_IMAGES_PER_MESSAGE) return false;
    } else {
      return false;
    }
  }
  return true;
}

function deserializeStoredContent(raw: string): string | AnthropicContentBlock[] {
  if (raw.length > 0 && raw[0] === "[") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as AnthropicContentBlock[];
    } catch { /* fall through */ }
  }
  return raw;
}

function summarizeUserContent(content: string | AnthropicContentBlock[]): string {
  if (typeof content === "string") return content;
  const text = content.find((b): b is AnthropicTextBlock => b.type === "text")?.text ?? "";
  const imageCount = content.filter(b => b.type === "image").length;
  if (imageCount === 0) return text;
  const suffix = ` [${imageCount} image${imageCount === 1 ? "" : "s"}]`;
  return text ? text + suffix : suffix.trim();
}

// ─── Memory endpoints ──────────────────────────────────────────────────────

router.get("/memory", async (_req, res) => {
  const value = await getMemory();
  res.json({ value });
});

router.put("/memory", async (req, res) => {
  const value = typeof req.body?.value === "string" ? req.body.value : null;
  if (value === null) { res.status(400).json({ error: "value (string) is required" }); return; }
  await setMemory(value);
  res.json({ value });
});

// ─── Thread persistence ────────────────────────────────────────────────────

router.get("/threads", async (_req, res) => {
  const rows = await db.execute(sql`
    SELECT t.id, t.title, t.created_at, t.updated_at,
      (SELECT COUNT(*) FROM recipe_chat_messages m WHERE m.thread_id = t.id) AS message_count
    FROM recipe_chat_threads t
    ORDER BY t.updated_at DESC
    LIMIT 100
  `);
  const list = (rows as unknown as { rows: Array<{ id: number; title: string; created_at: Date; updated_at: Date; message_count: string }> }).rows;
  res.json(list.map(r => ({
    id: Number(r.id),
    title: r.title,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    messageCount: Number(r.message_count),
  })));
});

router.post("/threads", async (req, res) => {
  const title = typeof req.body?.title === "string" && req.body.title.trim()
    ? req.body.title.trim()
    : "New conversation";
  const result = await db.execute(sql`
    INSERT INTO recipe_chat_threads (title) VALUES (${title}) RETURNING id, title, created_at, updated_at
  `);
  const row = (result as unknown as { rows: Array<{ id: number; title: string; created_at: Date; updated_at: Date }> }).rows[0];
  res.status(201).json({
    id: Number(row.id),
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messageCount: 0,
  });
});

router.get("/threads/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const tRes = await db.execute(sql`SELECT id, title, created_at, updated_at FROM recipe_chat_threads WHERE id = ${id}`);
  const trow = (tRes as unknown as { rows: Array<{ id: number; title: string; created_at: Date; updated_at: Date }> }).rows[0];
  if (!trow) { res.status(404).json({ error: "Not found" }); return; }
  const mRes = await db.execute(sql`SELECT id, role, content, created_at FROM recipe_chat_messages WHERE thread_id = ${id} ORDER BY id ASC`);
  const messages = (mRes as unknown as { rows: Array<{ id: number; role: string; content: string; created_at: Date }> }).rows;
  res.json({
    id: Number(trow.id),
    title: trow.title,
    createdAt: trow.created_at,
    updatedAt: trow.updated_at,
    messages: messages.map(m => ({
      id: Number(m.id),
      role: m.role,
      content: deserializeStoredContent(m.content),
      createdAt: m.created_at,
    })),
  });
});

router.patch("/threads/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const title = typeof req.body?.title === "string" && req.body.title.trim() ? req.body.title.trim() : null;
  if (!title) { res.status(400).json({ error: "title (non-empty string) required" }); return; }
  await db.execute(sql`UPDATE recipe_chat_threads SET title = ${title}, updated_at = NOW() WHERE id = ${id}`);
  res.json({ id, title });
});

router.delete("/threads/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.execute(sql`DELETE FROM recipe_chat_threads WHERE id = ${id}`);
  res.status(204).end();
});

async function persistMessage(threadId: number, role: "user" | "assistant", content: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO recipe_chat_messages (thread_id, role, content) VALUES (${threadId}, ${role}, ${content})
  `);
  await db.execute(sql`UPDATE recipe_chat_threads SET updated_at = NOW() WHERE id = ${threadId}`);
}

async function maybeAutoTitleThread(threadId: number, firstUserMessage: string): Promise<void> {
  const result = await db.execute(sql`SELECT title FROM recipe_chat_threads WHERE id = ${threadId}`);
  const row = (result as unknown as { rows: Array<{ title: string }> }).rows[0];
  if (!row || row.title !== "New conversation") return;
  const trimmed = firstUserMessage.trim().split("\n")[0].slice(0, 80);
  const title = trimmed.length > 0 ? trimmed : "New conversation";
  if (title !== "New conversation") {
    await db.execute(sql`UPDATE recipe_chat_threads SET title = ${title} WHERE id = ${threadId}`);
  }
}

// ─── Chat endpoint ─────────────────────────────────────────────────────────

router.post("/chat", largeJson, async (req: Request, res: Response) => {
  if (!isClaudeConfigured()) {
    res.status(503).json({ error: "Recipe Designer is not configured (missing ANTHROPIC_API_KEY)." });
    return;
  }

  const { messages, threadId } = req.body as { messages?: unknown; threadId?: number };

  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "messages (non-empty array) is required" });
    return;
  }

  if (!messages.every(validateMessage)) {
    res.status(400).json({ error: "Invalid messages — each must be role user/assistant with string or content-block array" });
    return;
  }

  const typedMessages = messages as ChatMessage[];

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Persist the latest user message at start of turn
  const lastUser = typedMessages[typedMessages.length - 1];
  if (threadId && lastUser?.role === "user") {
    try {
      const stored = typeof lastUser.content === "string"
        ? lastUser.content
        : JSON.stringify(lastUser.content);
      await persistMessage(threadId, "user", stored);
      await maybeAutoTitleThread(threadId, summarizeUserContent(lastUser.content));
    } catch (err) {
      console.error("[recipe-designer] failed to persist user msg:", err);
    }
  }

  const memory = await getMemory();
  const memoryBlock = `## Current Memory\n\n${memory}`;

  const client = getClaudeClient();
  const conversation: Anthropic.MessageParam[] = typedMessages.map(m => ({
    role: m.role,
    content: m.content as Anthropic.MessageParam["content"],
  }));

  let assistantTextAcc = "";

  try {
    for (let iteration = 0; iteration < 8; iteration++) {
      const stream = client.messages.stream({
        model: CLAUDE_MODELS.sonnet,
        max_tokens: 4096,
        system: [
          { type: "text", text: STATIC_PROMPT, cache_control: { type: "ephemeral" } },
          { type: "text", text: memoryBlock },
        ],
        tools: ALL_TOOL_DEFINITIONS,
        messages: conversation,
      });

      stream.on("text", (delta) => {
        assistantTextAcc += delta;
        send("delta", { text: delta });
      });

      const final = await stream.finalMessage();
      conversation.push({ role: "assistant", content: final.content });

      if (final.stop_reason !== "tool_use") {
        if (threadId && assistantTextAcc.trim()) {
          try { await persistMessage(threadId, "assistant", assistantTextAcc); }
          catch (err) { console.error("[recipe-designer] failed to persist assistant msg:", err); }
        }
        send("done", { stopReason: final.stop_reason, usage: final.usage });
        res.end();
        return;
      }

      const toolUses = final.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const use of toolUses) {
        if (PROPOSAL_TOOL_NAMES.has(use.name)) {
          if (use.name === "propose_memory_update") {
            const input = use.input as { newContent?: string; reason?: string };
            send("memory_proposal", {
              id: use.id,
              newContent: input.newContent ?? "",
              reason: input.reason ?? "",
            });
            toolResults.push({
              type: "tool_result",
              tool_use_id: use.id,
              content: "Memory proposal sent to Graeme. He will Save or dismiss. Continue.",
            });
          } else if (use.name === "propose_recipe_draft") {
            send("recipe_draft_proposal", { id: use.id, draft: use.input });
            toolResults.push({
              type: "tool_result",
              tool_use_id: use.id,
              content: "Recipe draft sent to Graeme as an editable form. He will Save or dismiss. Continue.",
            });
          }
          send("tool_call", { name: use.name, status: "proposal_sent" });
          continue;
        }

        // Data tools — execute against DB
        send("tool_call", { name: use.name, status: "running" });
        const exec = await executeRecipeTool(use.name, use.input);
        toolResults.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: exec.content,
          is_error: exec.isError ? true : undefined,
        });
        send("tool_call", { name: use.name, status: exec.isError ? "error" : "ok" });
      }

      conversation.push({ role: "user", content: toolResults });
    }

    send("error", { error: "Tool loop exceeded max iterations" });
    res.end();
  } catch (err) {
    console.error("[recipe-designer] chat failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    send("error", { error: message });
    res.end();
  }
});

export default router;
