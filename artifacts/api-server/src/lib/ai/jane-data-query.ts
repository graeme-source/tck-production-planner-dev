// AI Jane's questions turned into SQL (Graeme, 5 Nov 2026: answer anything a
// person could work out by looking at the app). Jane never writes SQL. She
// fills in a small form: which dataset, which filters, what to total. Every
// name in that form is checked against the dataset's own column list and every
// value goes in as a parameter, so nothing she sends can reach the database as
// text, and nothing outside jane-datasets.ts can be read at all. Pure and
// unit-tested; running it is in jane-data-tools.ts.

export type ColumnType = "text" | "number" | "date" | "boolean";

export interface DatasetColumn {
  name: string;
  type: ColumnType;
  /** Shown to Jane: units especially, so she never mixes packs and portions. */
  about?: string;
}

export interface Dataset {
  name: string;
  /** What it's for, in a line. */
  about: string;
  /** The app page whose permission gates this data. */
  pageKey: string;
  /** A fixed SELECT naming exactly the columns below, in plain view. */
  sql: string;
  columns: DatasetColumn[];
}

export const FILTER_OPS = ["eq", "ne", "gt", "gte", "lt", "lte", "contains", "in", "is_null", "not_null"] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

export const METRIC_FNS = ["sum", "avg", "min", "max", "count", "count_distinct"] as const;
export type MetricFn = (typeof METRIC_FNS)[number];

export const DATE_BUCKETS = ["week", "month", "weekday"] as const;
export type DateBucket = (typeof DATE_BUCKETS)[number];

export interface DataFilter { column: string; op: FilterOp; value?: unknown }
export interface DataMetric { fn: MetricFn; column?: string }
export interface DataOrder { column: string; direction?: "asc" | "desc" }

export interface DataQuery {
  dataset: string;
  columns?: string[];
  filters?: DataFilter[];
  /** A column, or a date column with a bucket: "day:week", "day:month", "day:weekday". */
  groupBy?: string[];
  metrics?: DataMetric[];
  orderBy?: DataOrder[];
  limit?: number;
}

export interface CompiledQuery {
  text: string;
  params: unknown[];
  outputColumns: string[];
  /** The row limit asked for; one extra row is fetched to detect truncation. */
  limit: number;
}

export class DataQueryError extends Error {}

export const DEFAULT_ROWS = 100;
export const MOST_ROWS = 300;
const MOST_IN_VALUES = 50;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const fail = (message: string): never => { throw new DataQueryError(message); };

const asList = <T>(value: T[] | undefined, label: string): T[] => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail(`${label} must be a list.`);
  return value;
};

function findColumn(dataset: Dataset, name: unknown): DatasetColumn {
  const column = dataset.columns.find((c) => c.name === name);
  if (!column) return fail(`"${String(name)}" isn't a column of ${dataset.name}. Columns: ${dataset.columns.map((c) => c.name).join(", ")}.`);
  return column;
}

const quoted = (name: string) => `t."${name}"`;

function typedValue(column: DatasetColumn, value: unknown): string | number | boolean {
  switch (column.type) {
    case "number": {
      const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
      return typeof n === "number" && Number.isFinite(n) ? n : fail(`${column.name} needs a number.`);
    }
    case "date":
      return typeof value === "string" && ISO_DATE.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`))
        ? value : fail(`${column.name} needs a date as YYYY-MM-DD.`);
    case "boolean":
      return typeof value === "boolean" ? value : fail(`${column.name} needs true or false.`);
    default:
      return typeof value === "string" || typeof value === "number" ? String(value) : fail(`${column.name} needs text.`);
  }
}

/** %, _ and \ are wildcards in ILIKE; a name containing them means itself. */
const escapeLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

function cast(column: DatasetColumn): string {
  return column.type === "date" ? "::date" : column.type === "number" ? "::float8" : column.type === "boolean" ? "::boolean" : "";
}

function filterSql(dataset: Dataset, filter: DataFilter, params: unknown[]): string {
  const column = findColumn(dataset, filter?.column);
  const op = filter.op;
  if (!FILTER_OPS.includes(op)) fail(`Filter "${String(op)}" isn't one of ${FILTER_OPS.join(", ")}.`);
  const col = quoted(column.name);
  if (op === "is_null") return `${col} IS NULL`;
  if (op === "not_null") return `${col} IS NOT NULL`;
  const text = column.type === "text";
  const param = (value: unknown) => { params.push(value); return `$${params.length}`; };

  if (op === "contains") {
    if (!text) fail(`"contains" only works on text; ${column.name} is ${column.type}.`);
    return `${col} ILIKE ${param(`%${escapeLike(String(typedValue(column, filter.value)))}%`)}`;
  }
  if (op === "in") {
    if (!Array.isArray(filter.value) || filter.value.length === 0) fail(`"in" needs a list of values for ${column.name}.`);
    const values = filter.value as unknown[];
    if (values.length > MOST_IN_VALUES) fail(`"in" takes at most ${MOST_IN_VALUES} values.`);
    const typed = values.map((v) => typedValue(column, v));
    return text
      ? `lower(${col}) = ANY(${param(typed.map((v) => String(v).toLowerCase()))}::text[])`
      : `${col} = ANY(${param(typed)}${column.type === "date" ? "::date[]" : column.type === "number" ? "::float8[]" : "::boolean[]"})`;
  }
  const value = typedValue(column, filter.value);
  const symbol = { eq: "=", ne: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" }[op];
  if (text && (op === "eq" || op === "ne")) return `lower(${col}) ${symbol} lower(${param(value)})`;
  return `${col} ${symbol} ${param(value)}${cast(column)}`;
}

interface Selected { sql: string; alias: string }

function groupingFor(dataset: Dataset, spec: unknown): Selected {
  if (typeof spec !== "string") return fail("groupBy takes column names.");
  const [name, bucket, ...rest] = spec.split(":");
  const column = findColumn(dataset, name);
  if (rest.length > 0) fail(`"${spec}" isn't a valid grouping.`);
  if (!bucket) return { sql: column.type === "date" ? `${quoted(column.name)}::text` : quoted(column.name), alias: column.name };
  if (column.type !== "date") fail(`Only dates can be grouped by ${bucket}; ${column.name} is ${column.type}.`);
  const col = quoted(column.name);
  switch (bucket as DateBucket) {
    case "week": return { sql: `to_char(date_trunc('week', ${col}::timestamp), 'YYYY-MM-DD')`, alias: `${column.name}_week_starting` };
    case "month": return { sql: `to_char(${col}, 'YYYY-MM')`, alias: `${column.name}_month` };
    case "weekday": return { sql: `to_char(${col}, 'FMDay')`, alias: `${column.name}_weekday` };
    default: return fail(`"${bucket}" isn't one of ${DATE_BUCKETS.join(", ")}.`);
  }
}

function metricFor(dataset: Dataset, metric: DataMetric): Selected {
  const { fn } = metric ?? {};
  if (!METRIC_FNS.includes(fn)) fail(`Metric "${String(fn)}" isn't one of ${METRIC_FNS.join(", ")}.`);
  if (metric.column === undefined || metric.column === null) {
    if (fn !== "count") fail(`${fn} needs a column.`);
    return { sql: "COUNT(*)::int", alias: "count_rows" };
  }
  const column = findColumn(dataset, metric.column);
  if ((fn === "sum" || fn === "avg") && column.type !== "number") fail(`${fn} needs a number column; ${column.name} is ${column.type}.`);
  const col = quoted(column.name);
  if (fn === "count_distinct") return { sql: `COUNT(DISTINCT ${col})::int`, alias: `distinct_${column.name}` };
  if (fn === "count") return { sql: `COUNT(${col})::int`, alias: `count_${column.name}` };
  const total = `${fn.toUpperCase()}(${col})`;
  return { sql: column.type === "date" ? `${total}::text` : column.type === "number" ? `${total}::float8` : total, alias: `${fn}_${column.name}` };
}

export function compileDataQuery(dataset: Dataset, query: DataQuery): CompiledQuery {
  const params: unknown[] = [];
  const groups = asList(query.groupBy, "groupBy").map((g) => groupingFor(dataset, g));
  const metrics = asList(query.metrics, "metrics").map((m) => metricFor(dataset, m));
  const summarising = groups.length > 0 || metrics.length > 0;
  if (summarising && asList(query.columns, "columns").length > 0) fail("Use columns for plain rows, or groupBy and metrics for totals, not both.");

  const plain: Selected[] = summarising
    ? []
    : (asList(query.columns, "columns").length > 0 ? query.columns! : dataset.columns.map((c) => c.name))
      .map((name) => { const c = findColumn(dataset, name); return { sql: c.type === "date" ? `${quoted(c.name)}::text` : quoted(c.name), alias: c.name }; });
  const selected = summarising ? [...groups, ...metrics] : plain;
  const select = selected.map((s) => `${s.sql} AS "${s.alias}"`).join(", ");

  const where = asList(query.filters, "filters").map((f) => filterSql(dataset, f, params));

  const aliases = new Map(selected.map((s) => [s.alias, s.sql]));
  const order = asList(query.orderBy, "orderBy").map((o) => {
    if (!aliases.has(o?.column)) fail(`Can only sort by what's being returned: ${[...aliases.keys()].join(", ")}.`);
    if (o.direction !== undefined && o.direction !== "asc" && o.direction !== "desc") fail(`Sort direction must be asc or desc.`);
    return `"${o.column}" ${o.direction === "desc" ? "DESC" : "ASC"}`;
  });

  const limit = Math.min(Math.max(Math.round(Number(query.limit ?? DEFAULT_ROWS)) || DEFAULT_ROWS, 1), MOST_ROWS);
  params.push(limit + 1);

  const text = [
    `SELECT ${select} FROM (${dataset.sql}) AS t`,
    where.length > 0 ? `WHERE ${where.join(" AND ")}` : "",
    groups.length > 0 ? `GROUP BY ${groups.map((g) => g.sql).join(", ")}` : "",
    order.length > 0 ? `ORDER BY ${order.join(", ")}` : "",
    `LIMIT $${params.length}`,
  ].filter(Boolean).join(" ");

  return { text, params, outputColumns: selected.map((s) => s.alias), limit };
}

const MOST_TEXT_CHARS = 400;

/** What goes back to Jane: tidy numbers, long notes cut, and a clear flag when
 *  there were more rows than she was given. */
export function shapeRows(rows: Array<Record<string, unknown>>, limit: number): { rows: Array<Record<string, unknown>>; rowCount: number; truncated: boolean } {
  const truncated = rows.length > limit;
  const kept = rows.slice(0, limit).map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => {
    if (typeof value === "number") return [key, Math.round(value * 100) / 100];
    if (typeof value === "string" && value.length > MOST_TEXT_CHARS) return [key, `${value.slice(0, MOST_TEXT_CHARS)}…`];
    return [key, value];
  })));
  return { rows: kept, rowCount: kept.length, truncated };
}
