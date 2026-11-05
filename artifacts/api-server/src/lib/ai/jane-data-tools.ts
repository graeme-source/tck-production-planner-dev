import { ilike } from "drizzle-orm";
import type Anthropic from "@anthropic-ai/sdk";
import { db, ingredientsTable, pool } from "@workspace/db";
import { PAGE_FEATURES, allowedFeatureKeys } from "../feature-access";
import { londonDateString, londonDayStartUtc } from "../london-time";
import { getPageMinRoles, type Role } from "../page-access";
import { loadStockLedgers } from "../stock-ledger-data";
import { addDaysIso, daysBetween } from "../team-efficiency-labour";
import { INGREDIENT_USAGE_TOOL, canSeeDataset, canSeePage, queryDataTool, visibleDatasets, type JaneAccess } from "./jane-data-access";
import { DataQueryError, compileDataQuery, shapeRows, type DataQuery } from "./jane-data-query";
import { datasetByName } from "./jane-datasets";
import { MOST_WEEKS, lastFullWeeks, summariseUsage, type UsagePeriod } from "./jane-usage-summary";

// AI Jane's wider lookups (Graeme, 5 Nov 2026). Read-only three times over:
// she can only fill in the form in jane-data-query.ts, it only reaches the
// allow-list in jane-datasets.ts, and it runs in a read-only transaction.

const QUERY_TIMEOUT_MS = 10_000;
const MOST_INGREDIENTS = 8;
const USAGE_PAGE = "/ingredients";

export async function loadJaneAccess(userId: number, role: Role): Promise<JaneAccess> {
  const [minRoles, grantedKeys] = await Promise.all([getPageMinRoles(), allowedFeatureKeys(userId)]);
  const granted = new Set(grantedKeys);
  return {
    role,
    minRoleFor: (pageKey) => minRoles.get(pageKey),
    grantedPages: new Set(Object.entries(PAGE_FEATURES).filter(([, key]) => granted.has(key)).map(([page]) => page)),
  };
}

export function janeDataTools(access: JaneAccess): Anthropic.Tool[] {
  const datasets = visibleDatasets(access);
  return [
    ...(datasets.length > 0 ? [queryDataTool(datasets)] : []),
    ...(canSeePage(access, USAGE_PAGE) ? [INGREDIENT_USAGE_TOOL] : []),
  ];
}

async function runReadOnly(text: string, params: unknown[]): Promise<Array<Record<string, unknown>>> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query(`SET LOCAL statement_timeout = ${QUERY_TIMEOUT_MS}`);
    const result = await client.query(text, params);
    return result.rows;
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
}

async function queryAppData(query: DataQuery, access: JaneAccess): Promise<unknown> {
  const dataset = datasetByName(query.dataset);
  // Re-checked here, whatever list of datasets she was offered.
  if (!dataset || !canSeeDataset(access, dataset)) return { note: "That data isn't available to this person." };
  const compiled = compileDataQuery(dataset, query);
  const { rows, rowCount, truncated } = shapeRows(await runReadOnly(compiled.text, compiled.params), compiled.limit);
  return {
    dataset: dataset.name,
    rowCount,
    truncated,
    ...(truncated ? { note: "There are more rows than this. Total them with groupBy and metrics, or narrow the filters." } : {}),
    rows,
  };
}

function usagePeriod(input: { weeks?: number; from?: string; to?: string }): UsagePeriod {
  if (input.from || input.to) {
    const today = londonDateString();
    const period = { from: input.from ?? addDaysIso(input.to ?? today, -34), to: input.to ?? today };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(period.from) || !/^\d{4}-\d{2}-\d{2}$/.test(period.to)) throw new DataQueryError("from and to need dates as YYYY-MM-DD.");
    if (period.from > period.to) throw new DataQueryError("from is after to.");
    if (daysBetween(period.from, period.to) > MOST_WEEKS * 7) throw new DataQueryError(`That's more than ${MOST_WEEKS} weeks: use a shorter period.`);
    return period;
  }
  const weeks = Math.min(Math.max(Math.round(Number(input.weeks ?? 5)) || 5, 1), MOST_WEEKS);
  return lastFullWeeks(londonDateString(), weeks);
}

async function ingredientUsage(input: { ingredientName?: string; weeks?: number; from?: string; to?: string }): Promise<unknown> {
  const name = input.ingredientName?.trim();
  if (!name) return { note: "Give an ingredient name." };
  const period = usagePeriod(input);
  const pattern = `%${name.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const matches = await db.select({ id: ingredientsTable.id, name: ingredientsTable.name })
    .from(ingredientsTable).where(ilike(ingredientsTable.name, pattern));
  if (matches.length === 0) return { note: `No ingredient matches "${name}".` };
  if (matches.length > MOST_INGREDIENTS) {
    return { note: `"${name}" matches ${matches.length} ingredients. Ask which one, or search again with a fuller name.`, matches: matches.map((m) => m.name) };
  }
  const ledgers = await loadStockLedgers({
    since: londonDayStartUtc(period.from),
    until: londonDayStartUtc(addDaysIso(period.to, 1)),
    ingredientIds: matches.map((m) => m.id),
  });
  return {
    basis: "Raw weight. Worked out from the recipes against tins ticked and batches finished, plus waste recorded against it. It isn't weighed, and extra packs aren't included.",
    ingredients: [...ledgers.values()].map(({ ingredient, ledger }) => summariseUsage({ ingredient, coverage: ledger.coverage, usage: ledger.usage, period })),
  };
}

export async function executeJaneDataTool(name: string, input: unknown, access: JaneAccess): Promise<{ content: string; isError?: boolean }> {
  try {
    if (name === "query_app_data") return { content: JSON.stringify(await queryAppData((input ?? {}) as DataQuery, access)) };
    if (name === INGREDIENT_USAGE_TOOL.name) {
      if (!canSeePage(access, USAGE_PAGE)) return { content: "That data isn't available to this person.", isError: true };
      return { content: JSON.stringify(await ingredientUsage((input ?? {}) as Parameters<typeof ingredientUsage>[0])) };
    }
    return { content: `Unknown tool: ${name}`, isError: true };
  } catch (err) {
    // A form filled in wrongly is Jane's to correct, so she sees why.
    if (err instanceof DataQueryError) return { content: err.message, isError: true };
    console.error(`[jane] ${name} failed:`, err);
    return { content: "That lookup failed. Try a narrower question.", isError: true };
  }
}
