/**
 * Label text: **bold** markup → runs, and template wording with
 * placeholders (pure, tested).
 */

export interface Run {
  text: string;
  bold: boolean;
}
/** One paragraph = runs laid out together, starting on a new line. */
export type Paragraph = Run[];

/** "Wheat **Flour** (**Milk**)" → runs. An unmatched ** is kept as text so
 *  nothing typed ever disappears. */
export function parseBold(text: string): Paragraph {
  const runs: Run[] = [];
  const parts = text.split("**");
  // An even number of parts means an unmatched marker: treat the last one
  // literally by gluing it back on.
  if (parts.length % 2 === 0) {
    const last = parts.pop() as string;
    parts[parts.length - 1] += `**${last}`;
  }
  parts.forEach((p, i) => {
    if (p) runs.push({ text: p, bold: i % 2 === 1 });
  });
  return mergeRuns(runs);
}

export function mergeRuns(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const r of runs) {
    if (!r.text) continue;
    const last = out[out.length - 1];
    if (last && last.bold === r.bold) last.text += r.text;
    else out.push({ ...r });
  }
  return out;
}

export function plainText(p: Paragraph): string {
  return p.map(r => r.text).join("");
}

/** "May also contain traces of nuts, peanuts and milk" → the list after
 *  "traces of" / "contain" in bold, with a full stop. If the statement
 *  doesn't follow that shape it's printed as written (plus the full stop). */
export function mayContainParagraph(statement: string, boldList: boolean): Paragraph {
  let s = statement.trim();
  if (!s) return [];
  if (!/[.!]$/.test(s)) s += ".";
  if (!boldList) return parseBold(s);
  const m = /^(.*?\btraces of\s+)(.+?)([.!])$/i.exec(s) ?? /^(.*?\bcontain\s+)(.+?)([.!])$/i.exec(s);
  if (!m || m[2].includes("**")) return parseBold(s);
  return mergeRuns([...parseBold(m[1]), { text: m[2], bold: true }, { text: m[3], bold: false }]);
}

// ── Word diff (what changed in the deck, for the publish check) ───────────

export interface DiffPart {
  text: string;
  kind: "same" | "added" | "removed";
}

/** Word-level difference between two texts (longest common subsequence).
 *  Whitespace is kept with each word so joining the parts rebuilds the text. */
export function wordDiff(before: string, after: string): DiffPart[] {
  const a = before.match(/\S+\s*/g) ?? [];
  const b = after.match(/\S+\s*/g) ?? [];
  const key = (w: string) => w.trim();
  // DP table of LCS lengths (decks are a few hundred words — fine).
  const n = a.length, m = b.length;
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = key(a[i]) === key(b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffPart[] = [];
  const push = (text: string, kind: DiffPart["kind"]) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ text, kind });
  };
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (key(a[i]) === key(b[j])) { push(b[j], "same"); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { push(a[i], "removed"); i++; }
    else { push(b[j], "added"); j++; }
  }
  while (i < n) push(a[i++], "removed");
  while (j < m) push(b[j++], "added");
  return out;
}

// ── Template wording ───────────────────────────────────────────────────────
//   {name}           a placeholder
//   [ ... ]          optional: dropped when ANY placeholder directly inside
//                    it is blank (nested groups decide for themselves)
//   {or}             ", or" — only when a kept group comes before it AND a
//                    kept group comes after it, at the same level

type Node =
  | { kind: "text"; text: string }
  | { kind: "ph"; name: string }
  | { kind: "or" }
  | { kind: "group"; children: Node[] };

function parseTemplate(src: string): Node[] {
  let i = 0;
  const parseList = (inGroup: boolean): Node[] => {
    const out: Node[] = [];
    let buf = "";
    const flush = () => { if (buf) { out.push({ kind: "text", text: buf }); buf = ""; } };
    while (i < src.length) {
      const ch = src[i];
      if (ch === "[") {
        flush(); i++;
        out.push({ kind: "group", children: parseList(true) });
      } else if (ch === "]" && inGroup) {
        i++; flush();
        return out;
      } else if (ch === "{") {
        const end = src.indexOf("}", i);
        const name = end > i ? src.slice(i + 1, end) : "";
        if (end > i && /^[a-zA-Z][a-zA-Z0-9]*$/.test(name)) {
          flush();
          out.push(name === "or" ? { kind: "or" } : { kind: "ph", name });
          i = end + 1;
        } else { buf += ch; i++; }
      } else { buf += ch; i++; }
    }
    flush();
    return out;
  };
  return parseList(false);
}

export interface FilledTemplate {
  text: string;
  /** Placeholders the template used that aren't known at all (a typo). */
  unknown: string[];
  /** Placeholders that were used and had a value. */
  filled: string[];
  /** Placeholders that were used but blank. */
  blank: string[];
}

export function fillTemplate(src: string, values: Record<string, string | number | null | undefined>): FilledTemplate {
  const unknown = new Set<string>();
  const filled = new Set<string>();
  const blank = new Set<string>();
  const valueOf = (name: string): string | null => {
    if (!(name in values)) { unknown.add(name); return null; }
    const v = values[name];
    if (v == null || String(v).trim() === "") { blank.add(name); return null; }
    filled.add(name);
    return String(v);
  };
  const render = (nodes: Node[], dropIfBlank: boolean): string | null => {
    // First pass: render children (groups decide for themselves).
    const parts: Array<{ node: Node; out: string | null }> = nodes.map(n => {
      if (n.kind === "group") return { node: n, out: render(n.children, true) };
      if (n.kind === "ph") return { node: n, out: valueOf(n.name) };
      return { node: n, out: n.kind === "text" ? n.text : "" };
    });
    if (dropIfBlank && parts.some(p => p.node.kind === "ph" && p.out == null)) return null;
    let s = "";
    parts.forEach((p, idx) => {
      if (p.node.kind === "or") {
        const keptBefore = parts.slice(0, idx).some(q => q.node.kind === "group" && q.out);
        const keptAfter = parts.slice(idx + 1).some(q => q.node.kind === "group" && q.out);
        if (keptBefore && keptAfter) s += ", or";
        return;
      }
      if (p.node.kind === "ph") s += p.out ?? `{${p.node.name}}`;
      else s += p.out ?? "";
    });
    return s;
  };
  const text = render(parseTemplate(src), false) ?? "";
  return { text: text.replace(/ {2,}/g, " "), unknown: [...unknown], filled: [...filled], blank: [...blank] };
}
