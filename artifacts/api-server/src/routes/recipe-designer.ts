import express, { Router, type IRouter, type Request, type Response } from "express";
import { readFileSync } from "fs";
import { resolve } from "path";
import { db, appSettingsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { getClaudeClient, isClaudeConfigured, CLAUDE_MODELS } from "../lib/ai/claude";
import {
  RECIPE_TOOL_DEFINITIONS,
  PROPOSAL_TOOL_DEFINITIONS,
  PROPOSAL_TOOL_NAMES,
  RECIPE_TOOL_NAMES,
  executeRecipeTool,
} from "../lib/ai/recipe-designer-tools";
import {
  CAZ_TOOL_DEFINITIONS,
  CAZ_TOOL_NAMES,
  CAZ_TOOL_PAGE_KEYS,
  executeCazTool,
} from "../lib/ai/caz-tools";
import { getPageMinRoles, roleMeets, type Role } from "../lib/page-access";
import { londonDateString } from "../lib/london-time";
import type Anthropic from "@anthropic-ai/sdk";

const router: IRouter = Router();

const FOUNDER_EMAIL = "graeme@thecalzonekitchen.co.uk";

/** Who is chatting: their id, role, and whether they're the founder (who keeps
 *  the recipe-design + memory powers everyone else doesn't get). */
async function resolveRequester(req: Request): Promise<{ userId: number; role: Role; isFounder: boolean }> {
  const userId = req.session.userId as number;
  const [u] = await db
    .select({ role: usersTable.role, email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  return {
    userId,
    role: (u?.role ?? "viewer") as Role,
    isFounder: u?.email === FOUNDER_EMAIL,
  };
}

/** The read tools this role may use — a tool gated by a page key is only
 *  offered if the user meets that page's min-role, so Caz mirrors exactly what
 *  the person can already see in the app. */
async function allowedReadTools(role: Role): Promise<Anthropic.Tool[]> {
  const pageRoles = await getPageMinRoles();
  return [...RECIPE_TOOL_DEFINITIONS, ...CAZ_TOOL_DEFINITIONS].filter(t => {
    const pageKey = CAZ_TOOL_PAGE_KEYS[t.name];
    return !pageKey || roleMeets(role, pageRoles.get(pageKey));
  });
}

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
- get_ingredient_consumption — average daily/weekly raw usage per ingredient at the DPT mix (sub-recipes expanded; week = 5 production days). Use for "how much X do we get through"

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

// Read-only assistant for everyone else on the team. Same name (Caz), but no
// recipe-design or memory powers — it answers questions from live data and
// cannot change anything.
const CAZ_PROMPT = `You are Caz, the assistant inside The Calzone Kitchen's Production Planner app. You help the team by answering questions about what the app knows: recipes, ingredients, allergens, costs, sub-recipes, today's and other days' production plans, prep quantities (how much of each thing per tray/batch), stock / factory numbers, and average ingredient consumption (how much of an ingredient a normal day or week uses — get_ingredient_consumption, which counts sub-recipe usage too and works on a 5-production-day week).

## What you can and can't do
You are READ-ONLY. You look things up and explain them. You cannot change recipes, plans, stock, tags or settings, and you cannot take any action (no tagging orders, no raising issues, no edits). If someone asks you to change something, tell them plainly that you can only look things up, and point them to the right screen to make the change themselves.

You only have tools for operational data. You have NO access to staff records, HR, training, contact details or anything personal — if asked, say that's not something you can see.

Some tools may be unavailable to the person you're talking to because of their access level. If you don't have a tool for what's asked, say you can't see that rather than guessing.

## Tone & response style
Be a helpful, plain-spoken colleague. Short and direct — lead with the answer. Use **bold** for the key number. No markdown headings. Don't narrate tool use ("let me check…") — just answer. Don't surface internal IDs (recipe/ingredient ids); use names.

When someone asks a prep question like "how much BBQ sauce per tray for BBQ Pulled Pork today", give the per-tray figure first, then the total if useful. Always answer from the tools, not from memory — call them silently and reply with the real number.

For allergen questions, use get_recipe_allergens (one call — it walks the whole ingredient tree including sub-recipes). Don't assemble allergens from get_recipe. If the tool reports incomplete declarations, give the allergens you have but note that the ingredient data for that product isn't fully complete, so it should be double-checked against the pack.

Really — do not narrate ("let me pull up…", "I need to check…"). Call the tool and give the answer.`;

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

// Memory is founder-only (recipe-design working notes). Now that the router is
// open to all staff, these two endpoints guard themselves.
async function founderOnly(req: Request, res: Response): Promise<boolean> {
  const { isFounder } = await resolveRequester(req);
  if (!isFounder) { res.status(403).json({ error: "Founder access required" }); return false; }
  return true;
}

router.get("/memory", async (req, res) => {
  if (!(await founderOnly(req, res))) return;
  const value = await getMemory();
  res.json({ value });
});

router.put("/memory", async (req, res) => {
  if (!(await founderOnly(req, res))) return;
  const value = typeof req.body?.value === "string" ? req.body.value : null;
  if (value === null) { res.status(400).json({ error: "value (string) is required" }); return; }
  await setMemory(value);
  res.json({ value });
});

// ─── Thread persistence ────────────────────────────────────────────────────
// Threads are private per user: everyone sees only their own conversations.
// `user_id` is added by a startup migration and existing rows are backfilled
// to the founder (they were all the founder's before Caz opened up).

async function threadOwnedBy(threadId: number, userId: number): Promise<boolean> {
  if (!Number.isFinite(threadId)) return false;
  const r = await db.execute(sql`SELECT 1 FROM recipe_chat_threads WHERE id = ${threadId} AND user_id = ${userId}`);
  return ((r as unknown as { rows: unknown[] }).rows).length > 0;
}

router.get("/threads", async (req, res) => {
  const userId = req.session.userId as number;
  const rows = await db.execute(sql`
    SELECT t.id, t.title, t.created_at, t.updated_at,
      (SELECT COUNT(*) FROM recipe_chat_messages m WHERE m.thread_id = t.id) AS message_count
    FROM recipe_chat_threads t
    WHERE t.user_id = ${userId}
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
  const userId = req.session.userId as number;
  const title = typeof req.body?.title === "string" && req.body.title.trim()
    ? req.body.title.trim()
    : "New conversation";
  const result = await db.execute(sql`
    INSERT INTO recipe_chat_threads (title, user_id) VALUES (${title}, ${userId}) RETURNING id, title, created_at, updated_at
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
  if (!(await threadOwnedBy(id, req.session.userId as number))) { res.status(404).json({ error: "Not found" }); return; }
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
  if (!(await threadOwnedBy(id, req.session.userId as number))) { res.status(404).json({ error: "Not found" }); return; }
  const title = typeof req.body?.title === "string" && req.body.title.trim() ? req.body.title.trim() : null;
  if (!title) { res.status(400).json({ error: "title (non-empty string) required" }); return; }
  await db.execute(sql`UPDATE recipe_chat_threads SET title = ${title}, updated_at = NOW() WHERE id = ${id}`);
  res.json({ id, title });
});

router.delete("/threads/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (!(await threadOwnedBy(id, req.session.userId as number))) { res.status(404).json({ error: "Not found" }); return; }
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

  const requester = await resolveRequester(req);

  // Build the tool set for THIS user. Everyone gets the read tools their role
  // permits; only the founder gets the write-proposal tools (recipe drafts,
  // memory updates). So for staff there is physically no tool that can change
  // anything — read-only is structural, not just prompted.
  const readTools = await allowedReadTools(requester.role);
  const tools: Anthropic.Tool[] = requester.isFounder
    ? [...readTools, ...PROPOSAL_TOOL_DEFINITIONS]
    : readTools;
  // Give Caz today's date so relative dates ("today", "tomorrow", "15 July")
  // resolve to the right year — the model doesn't otherwise know the date, and
  // its tools all default to "today".
  const datedPrompt = `Today's date is ${londonDateString()} (Europe/London). When the user gives a date without a year, assume the current or nearest upcoming one.\n\n`;
  const systemPrompt = datedPrompt + (requester.isFounder ? STATIC_PROMPT : CAZ_PROMPT);

  // Only persist to a thread the requester owns — never write into someone
  // else's conversation via a passed-in id.
  const ownsThread = threadId ? await threadOwnedBy(Number(threadId), requester.userId) : false;

  // Persist the latest user message at start of turn
  const lastUser = typedMessages[typedMessages.length - 1];
  if (threadId && ownsThread && lastUser?.role === "user") {
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

  // Memory is a founder-only concept; staff chats don't carry it.
  const memoryBlock = requester.isFounder ? `## Current Memory\n\n${await getMemory()}` : null;
  const cazCtx = { cookie: req.headers.cookie ?? "", port: process.env["PORT"] };

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
          { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
          ...(memoryBlock ? [{ type: "text" as const, text: memoryBlock }] : []),
        ],
        tools,
        messages: conversation,
      });

      stream.on("text", (delta) => {
        assistantTextAcc += delta;
        send("delta", { text: delta });
      });

      const final = await stream.finalMessage();
      conversation.push({ role: "assistant", content: final.content });

      if (final.stop_reason !== "tool_use") {
        if (threadId && ownsThread && assistantTextAcc.trim()) {
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

      const pageRoles = await getPageMinRoles();
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const use of toolUses) {
        // Belt-and-braces: proposal tools are founder-only, and every read tool
        // is re-checked against the caller's page permission at execution time,
        // even though the offered tool list already excluded disallowed ones.
        if (PROPOSAL_TOOL_NAMES.has(use.name) && !requester.isFounder) {
          toolResults.push({ type: "tool_result", tool_use_id: use.id, content: "Not permitted.", is_error: true });
          continue;
        }
        const pageKey = CAZ_TOOL_PAGE_KEYS[use.name];
        if (pageKey && !roleMeets(requester.role, pageRoles.get(pageKey))) {
          toolResults.push({ type: "tool_result", tool_use_id: use.id, content: "You don't have access to that data.", is_error: true });
          send("tool_call", { name: use.name, status: "error" });
          continue;
        }

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

        // Data tools — execute against DB / loopback.
        send("tool_call", { name: use.name, status: "running" });
        const exec = CAZ_TOOL_NAMES.has(use.name)
          ? await executeCazTool(use.name, use.input, cazCtx)
          : RECIPE_TOOL_NAMES.has(use.name)
            ? await executeRecipeTool(use.name, use.input)
            : { content: `Unknown tool: ${use.name}`, isError: true };
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
