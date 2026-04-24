import { Router, type IRouter, type Request, type Response } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getClaudeClient, isClaudeConfigured, CLAUDE_MODELS } from "../lib/ai/claude";
import { TOOL_DEFINITIONS, executeTool, type ToolContext } from "../lib/ai/tools";
import type Anthropic from "@anthropic-ai/sdk";

const router: IRouter = Router();

const STATION_LABELS: Record<string, string> = {
  dough_prep: "Dough Prep", dough_sheeting: "Dough Sheeting", prep: "Prep",
  main_prep: "Main Prep", prep_bases: "Bases & Sauces", prep_meat: "Raw Meat Prep",
  mixing: "Mixing & Cooking", building_1: "Building Table 1", building_2: "Building Table 2",
  ovens: "Ovens", wrapping: "Wrapping", packing: "Packing", general: "General / Other",
};

const SYSTEM_PROMPT = `You are a helpful assistant inside the TCK Production Planner — a kitchen production planning app for The Calzone Kitchen, a UK-based artisan food business that makes calzones and macaroni cheese.

Your users are production staff. They may be speaking to you via voice-to-text from an iPad while working, so:
- Keep responses short and practical.
- Don't use markdown headings or long bullet lists.
- If you're unsure what they want, ask a short clarifying question.

## What you help with
1. General questions — answer like a normal assistant would.
2. Explaining how TCK Planner works when asked.
3. Looking up live data from the app (production plan, open issues, stock, ordering, who's on shift) via your tools.
4. Reporting production floor issues using the create_andon_issue tool.

## When to use tools
If a question needs live data from the app, **use a tool** rather than saying you don't know. The tools are fast. Examples:
- "What are we making today?" → get_todays_production_plan
- "Any issues open right now?" → get_open_andon_issues
- "How much cheese do we have?" → get_ingredient_stock with name "cheese"
- "What do we need to order today?" → get_kanbans_due_today
- "Who's on today?" → get_todays_schedule
You can call multiple tools if a question needs them. Read-only tools don't need confirmation first — just call them.

## Reporting issues — important behaviour
When the user describes a problem on the floor (broken equipment, safety hazard, product quality issue, etc.), help them log it via create_andon_issue.

Before calling that tool, confirm the details in one short sentence like: "Report this as a red equipment issue on main prep — the mixer is making a grinding noise. OK?" Only call the tool after they confirm.

Exception: if the user's message is unmistakably a direct "report this" instruction (e.g. "report the oven as broken urgently"), skip the confirmation and call the tool immediately.

After the tool succeeds, briefly confirm in plain language: "Reported. Managers will see it now."

## Severity guide
- red: Serious — production is impacted or unsafe; needs immediate attention
- yellow: Minor — production can continue but needs attention
- green: Wish list — nice-to-have improvement, no urgency

## Category guide
- equipment: Broken or malfunctioning equipment
- safety: Safety hazards, injuries, near-misses
- production: Issues affecting production output or flow
- product: Quality issues with product or ingredients
- other: Doesn't fit the above

## Stations (use the key, not the label)
${Object.entries(STATION_LABELS).map(([k, v]) => `- ${k} (${v})`).join("\n")}

If the user doesn't mention a station, ask which one, or use the station they're currently at if provided in context.`;

type ChatMessage = { role: "user" | "assistant"; content: string };

router.post("/chat", async (req: Request, res: Response) => {
  if (!isClaudeConfigured()) {
    res.status(503).json({ error: "AI chat is not configured (missing ANTHROPIC_API_KEY)." });
    return;
  }

  const { messages, station } = req.body as {
    messages?: ChatMessage[];
    station?: string;
  };

  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "messages (non-empty array) is required" });
    return;
  }

  if (messages.some(m => typeof m.content !== "string" || (m.role !== "user" && m.role !== "assistant"))) {
    res.status(400).json({ error: "each message must have role 'user' or 'assistant' and string content" });
    return;
  }

  const userId = req.session.userId ?? null;
  let userName: string | null = null;
  let userRole: string | null = null;
  if (userId) {
    const [user] = await db
      .select({ name: usersTable.name, role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.id, userId));
    userName = user?.name ?? null;
    userRole = user?.role ?? null;
  }

  const ctx: ToolContext = { userId, userName, userRole, station: station ?? null };

  const userContext = [
    userName ? `The user's name is ${userName}.` : null,
    userRole ? `Their role is ${userRole}.` : null,
    station ? `They are currently at the ${STATION_LABELS[station] ?? station} station.` : null,
    `Today's date is ${new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(new Date())}.`,
  ].filter(Boolean).join(" ");

  const systemBlocks: Anthropic.TextBlockParam[] = [
    { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
  ];
  if (userContext) systemBlocks.push({ type: "text", text: userContext });

  const client = getClaudeClient();
  const conversation: Anthropic.MessageParam[] = messages.map(m => ({
    role: m.role,
    content: m.content,
  }));

  const toolResults: Array<{ tool: string; success: boolean; summary: string }> = [];

  try {
    for (let iteration = 0; iteration < 6; iteration++) {
      const response = await client.messages.create({
        model: CLAUDE_MODELS.haiku,
        max_tokens: 1024,
        system: systemBlocks,
        tools: TOOL_DEFINITIONS,
        messages: conversation,
      });

      conversation.push({ role: "assistant", content: response.content });

      if (response.stop_reason !== "tool_use") {
        const textParts = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map(b => b.text)
          .join("\n")
          .trim();

        res.json({ reply: textParts || "(no response)", toolResults });
        return;
      }

      const toolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );

      const toolResultBlocks: Anthropic.ToolResultBlockParam[] = [];
      for (const use of toolUses) {
        const result = await executeTool(use.name, use.input, ctx);
        toolResults.push({
          tool: use.name,
          success: result.success,
          summary: result.summary ?? (result.success
            ? `Looked up ${use.name.replace(/^get_/, "").replace(/_/g, " ")}`
            : `${use.name} failed`),
        });
        toolResultBlocks.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: result.content,
          is_error: result.success ? undefined : true,
        });
      }

      conversation.push({ role: "user", content: toolResultBlocks });
    }

    res.status(500).json({ error: "AI loop exceeded max iterations" });
  } catch (err) {
    console.error("[ai] chat failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: `AI chat failed: ${message}` });
  }
});

export default router;
