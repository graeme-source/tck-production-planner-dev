/**
 * Reading a shared meeting-notes link (Graeme, 2026-10-12: "I just give you
 * the URL, and then you scrape it"). He records meetings with Wispr Flow,
 * which shares notes as https://notes.wisprflow.ai/shared/<id>.
 *
 * The server fetches a URL someone typed, so it is fenced in hard:
 *   • https only, no user:password@, no custom port, and the host must be on
 *     ALLOWED_NOTE_HOSTS exactly (no sub-domains, no IP addresses);
 *   • redirects are followed by hand (at most MAX_REDIRECTS) and every hop
 *     is checked against the same list — a redirect off it is refused;
 *   • one overall time limit, a byte cap on the body (streamed, so a huge
 *     page is cut off rather than buffered), text/HTML/JSON only;
 *   • what comes back is only ever DATA — text for the model, which is told
 *     never to follow instructions in it (meeting-notes-ai.ts).
 *
 * The shared Wispr Flow page is a JavaScript app: a plain fetch gets an
 * empty shell (checked 12 Oct 2026). Its own page code reads the notes from
 * a JSON endpoint on api.wisprflow.ai, so for a /shared/<id> link we ask
 * that endpoint too — the URL is built HERE from the id, never taken from
 * the user or the page. If neither gives usable text we say so plainly and
 * ask for the text to be pasted; nothing is ever made up.
 *
 * Pure apart from the injected fetch, so the guard is tested without a
 * network.
 */

export const ALLOWED_NOTE_HOSTS: readonly string[] = ["notes.wisprflow.ai"];
/** Data hosts we call ourselves for a known page host — never user-chosen. */
const WISPR_API_ORIGIN = "https://api.wisprflow.ai";
const ALLOWED_DATA_HOSTS: readonly string[] = ["api.wisprflow.ai"];

export const MAX_URL_LENGTH = 2000;
export const MAX_BYTES = 1_000_000;
export const TIMEOUT_MS = 12_000;
export const MAX_REDIRECTS = 3;
/** Less readable text than this and it isn't the notes. */
export const MIN_USEFUL_CHARS = 120;
/** What goes to the model at most. */
export const MAX_TEXT_CHARS = 60_000;

export const PASTE_INSTEAD =
  "That link only shows its notes inside a web browser, so the app can't read it. Open the link, copy all the notes and paste them into the box instead.";

export type UrlCheck = { ok: true; url: URL } | { ok: false; error: string };

/** Is this a link we're allowed to fetch? */
export function checkNotesUrl(raw: string, allowHosts: readonly string[] = ALLOWED_NOTE_HOSTS): UrlCheck {
  const s = (raw ?? "").trim();
  if (!s) return { ok: false, error: "Paste the link to the shared notes." };
  if (s.length > MAX_URL_LENGTH) return { ok: false, error: "That link is too long." };
  let url: URL;
  try { url = new URL(s); } catch { return { ok: false, error: "That doesn't look like a link." }; }
  if (url.protocol !== "https:") return { ok: false, error: "Only https links can be read." };
  if (url.username || url.password) return { ok: false, error: "That link can't be read." };
  if (url.port) return { ok: false, error: "That link can't be read." };
  const host = url.hostname.toLowerCase();
  if (!allowHosts.includes(host)) {
    return { ok: false, error: `Only shared notes from ${ALLOWED_NOTE_HOSTS.join(" or ")} can be read from a link. For anything else, paste the text.` };
  }
  return { ok: true, url };
}

/** The share id from a Wispr Flow link (/shared/<id>), or null. */
export function wisprSharedSlug(url: URL): string | null {
  if (url.hostname.toLowerCase() !== "notes.wisprflow.ai") return null;
  const m = /^\/shared\/([A-Za-z0-9_-]{4,200})\/?$/.exec(url.pathname);
  return m ? m[1] : null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", "#39": "'" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (k in ENTITIES) return ENTITIES[k];
    if (k.startsWith("#x")) { const n = parseInt(k.slice(2), 16); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
    if (k.startsWith("#")) { const n = parseInt(k.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
    return m;
  });
}

function tidy(s: string): string {
  return s.replace(/[ \t\f\v ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** The readable text of an HTML page: no scripts, styles or markup. */
export function htmlToText(html: string): string {
  const body = html
    .replace(/<head[\s\S]*?<\/head>/gi, " ")
    .replace(/<(script|style|noscript|svg|template|iframe)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|blockquote|pre)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, " ");
  return tidy(decodeEntities(body));
}

const SKIP_KEYS = /^(id|_id|uuid|slug|url|href|src|avatar|avatar_url|image|email|token|access_token|created_at|updated_at|type|status|owner_id|user_id|meeting_id|share_id|locale|timezone|color|icon)$/i;

/** Readable text from a JSON reply: the longer strings, in order, skipping
 *  ids, links, emails and timestamps. Shape-agnostic on purpose — the
 *  endpoint isn't documented. */
export function jsonToText(value: unknown): string {
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (v: unknown, key: string | null, depth: number) => {
    if (depth > 12 || out.length > 2000) return;
    if (typeof v === "string") {
      if (key && SKIP_KEYS.test(key)) return;
      const s = v.trim();
      if (s.length < 3) return;
      if (/^(https?:)?\/\//i.test(s) || /^[\w.+-]+@[\w-]+\.[\w.]+$/.test(s)) return;
      if (/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})?$/.test(s) || /^[0-9a-f-]{20,}$/i.test(s)) return;
      // Short labels only count as part of a longer passage.
      if (s.length < 20 && !/\s/.test(s)) return;
      if (seen.has(s)) return;
      seen.add(s);
      out.push(/<[a-z][\s\S]*>/i.test(s) ? htmlToText(s) : s);
      return;
    }
    if (Array.isArray(v)) { for (const x of v) walk(x, key, depth + 1); return; }
    if (v && typeof v === "object") for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, k, depth + 1);
  };
  walk(value, null, 0);
  return tidy(out.join("\n\n"));
}

export type Fetcher = (url: string, init: { redirect: "manual"; signal: AbortSignal; headers: Record<string, string> }) => Promise<Response>;

export type FetchResult =
  | { ok: true; text: string; url: string; from: "page" | "data" }
  | { ok: false; status: number; error: string };

type Got = { ok: true; body: string; contentType: string } | { ok: false; status: number; error: string };

/** One guarded GET: allow-listed hosts on every hop, byte cap, text only. */
async function guardedGet(start: URL, hosts: readonly string[], fetchImpl: Fetcher, signal: AbortSignal, maxBytes: number): Promise<Got> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetchImpl(url.toString(), {
      redirect: "manual", signal,
      headers: { Accept: "text/html,application/json,text/plain;q=0.9", "User-Agent": "TCK-Planner-MeetingNotes/1.0" },
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return { ok: false, status: 502, error: "The notes link redirected nowhere." };
      let next: URL;
      try { next = new URL(loc, url); } catch { return { ok: false, status: 502, error: "The notes link redirected somewhere unreadable." }; }
      const c = checkNotesUrl(next.toString(), hosts);
      if (!c.ok) return { ok: false, status: 400, error: "The notes link redirected to another site, so it wasn't followed. Paste the text instead." };
      url = c.url;
      continue;
    }
    if (res.status === 401 || res.status === 403) return { ok: false, status: 422, error: "Those notes aren't shared publicly, so the app can't open them. Paste the text instead." };
    if (res.status === 404) return { ok: false, status: 422, error: "No notes found at that link — check it's the shared link. Or paste the text instead." };
    if (!res.ok) return { ok: false, status: 502, error: "The notes site didn't answer properly. Try again, or paste the text instead." };
    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    if (!/^(text\/html|text\/plain|application\/json)/.test(contentType)) {
      return { ok: false, status: 422, error: "That link isn't a page of text. Paste the notes instead." };
    }
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > maxBytes) return { ok: false, status: 413, error: "That page is too big to read. Paste the notes instead." };
    const body = await readCapped(res, maxBytes);
    if (body == null) return { ok: false, status: 413, error: "That page is too big to read. Paste the notes instead." };
    return { ok: true, body, contentType };
  }
  return { ok: false, status: 502, error: "The notes link redirected too many times." };
}

/** The body as text, or null once it passes maxBytes (stops reading). */
async function readCapped(res: Response, maxBytes: number): Promise<string | null> {
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    return buf.byteLength > maxBytes ? null : new TextDecoder().decode(buf);
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { await reader.cancel().catch(() => undefined); return null; }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  return new TextDecoder().decode(all);
}

function textOf(got: { body: string; contentType: string }): string {
  if (got.contentType.startsWith("application/json")) {
    try { return jsonToText(JSON.parse(got.body)); } catch { return ""; }
  }
  return got.contentType.startsWith("text/html") ? htmlToText(got.body) : tidy(got.body);
}

/** Fetch a shared-notes link and return its readable text — or a clear
 *  reason to paste the text instead. */
export async function fetchNotesText(raw: string, opts: { fetchImpl?: Fetcher; timeoutMs?: number; maxBytes?: number } = {}): Promise<FetchResult> {
  const check = checkNotesUrl(raw);
  if (!check.ok) return { ok: false, status: 400, error: check.error };
  const fetchImpl = opts.fetchImpl ?? ((u, i) => fetch(u, i));
  const maxBytes = opts.maxBytes ?? MAX_BYTES;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? TIMEOUT_MS);
  try {
    const page = await guardedGet(check.url, ALLOWED_NOTE_HOSTS, fetchImpl, ctrl.signal, maxBytes);
    if (page.ok) {
      const text = textOf(page);
      if (text.length >= MIN_USEFUL_CHARS) return { ok: true, text: text.slice(0, MAX_TEXT_CHARS), url: check.url.toString(), from: "page" };
    } else if (page.status !== 422) {
      // Refused (redirected off the list, too big, not text) — stop there.
      return page;
    }
    const slug = wisprSharedSlug(check.url);
    if (!slug) return page.ok ? { ok: false, status: 422, error: PASTE_INSTEAD } : page;
    const parts: string[] = [];
    let lastError: Got | null = null;
    for (const path of [`/api/v1/meetings/shared/${slug}`, `/api/v1/meetings/shared/${slug}/transcript`]) {
      const got = await guardedGet(new URL(path, WISPR_API_ORIGIN), ALLOWED_DATA_HOSTS, fetchImpl, ctrl.signal, maxBytes);
      if (!got.ok) { lastError = got; continue; }
      const t = textOf(got);
      if (t) parts.push(t);
      if (parts.join("\n\n").length >= MIN_USEFUL_CHARS) break;
    }
    const text = parts.join("\n\n");
    if (text.length >= MIN_USEFUL_CHARS) return { ok: true, text: text.slice(0, MAX_TEXT_CHARS), url: check.url.toString(), from: "data" };
    if (lastError && !lastError.ok && lastError.status === 422) return lastError;
    return { ok: false, status: 422, error: PASTE_INSTEAD };
  } catch (err) {
    if (ctrl.signal.aborted) return { ok: false, status: 504, error: "The notes site took too long to answer. Try again, or paste the text instead." };
    console.warn("[meeting-notes-source] fetch failed:", err instanceof Error ? err.message : err);
    return { ok: false, status: 502, error: "Couldn't reach the notes site. Try again, or paste the text instead." };
  } finally {
    clearTimeout(timer);
  }
}
