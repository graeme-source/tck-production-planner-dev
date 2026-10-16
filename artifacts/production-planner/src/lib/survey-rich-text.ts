/**
 * Survey formatted text + final page — the planner side's pure rules.
 *
 * The SERVER is the security boundary (api-server/src/lib/survey-intro.ts
 * sanitises against an allow-list, survey-final-page.ts checks the button
 * link). The class names here must match that allow-list; the checks here
 * only give the editor instant feedback. Objective I.
 */

/** Font choices. `cls` must be in SURVEY_INTRO_SPAN_CLASSES on the server. */
export const SURVEY_FONTS = [
  { key: "body", label: "Website font", cls: null },
  { key: "heading", label: "Heading font", cls: "tck-font-heading" },
  { key: "serif", label: "Classic serif", cls: "tck-font-serif" },
] as const;
export type SurveyFontKey = (typeof SURVEY_FONTS)[number]["key"];

export const SURVEY_SIZES = [
  { key: "small", label: "Small", cls: "tck-size-small" },
  { key: "normal", label: "Normal", cls: null },
  { key: "large", label: "Large", cls: "tck-size-large" },
] as const;
export type SurveySizeKey = (typeof SURVEY_SIZES)[number]["key"];

export const SURVEY_ALIGNS = ["left", "center"] as const;
export type SurveyAlign = (typeof SURVEY_ALIGNS)[number];

/** Class from a font/size key, or null for the default. */
export function fontClass(key: string | null | undefined): string | null {
  return SURVEY_FONTS.find(f => f.key === key)?.cls ?? null;
}
export function sizeClass(key: string | null | undefined): string | null {
  return SURVEY_SIZES.find(s => s.key === key)?.cls ?? null;
}
/** Key from a class attribute ("tck-font-serif other" -> "serif"). */
export function fontKeyFromClass(cls: string | null | undefined): SurveyFontKey | null {
  const parts = (cls ?? "").split(/\s+/);
  return SURVEY_FONTS.find(f => f.cls && parts.includes(f.cls))?.key ?? null;
}
export function sizeKeyFromClass(cls: string | null | undefined): SurveySizeKey | null {
  const parts = (cls ?? "").split(/\s+/);
  return SURVEY_SIZES.find(s => s.cls && parts.includes(s.cls))?.key ?? null;
}
export function alignFromClass(cls: string | null | undefined): SurveyAlign | null {
  const parts = (cls ?? "").split(/\s+/);
  return SURVEY_ALIGNS.find(a => parts.includes(`tck-align-${a}`)) ?? null;
}

/** True when editor HTML has no visible text ("<p></p>", only breaks). */
export function isRichTextEmpty(html: string | null | undefined): boolean {
  return (html ?? "").replace(/<br\s*\/?>/gi, "").replace(/<[^>]*>/g, "").replace(/&nbsp;|\s/g, "").length === 0;
}

/**
 * Plain text (e.g. a collection template's intro) -> editor HTML: blank
 * lines start paragraphs, single newlines become breaks. Mirrors the
 * server's plainTextToIntroHtml.
 */
export function plainTextToHtml(text: string | null | undefined): string {
  const t = (text ?? "").replace(/\r\n?/g, "\n").trim();
  if (!t) return "";
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return t.split(/\n\s*\n+/).map(p => `<p>${p.split("\n").map(l => esc(l.trim())).join("<br>")}</p>`).join("");
}

/** Hosts the final-page button may link to (server re-checks). */
const SHOP_HOSTS = ["thecalzonekitchen.co.uk", "www.thecalzonekitchen.co.uk"];

/** Instant check for the custom-link box: http(s) on our shop only. */
export function isShopLink(raw: string | null | undefined): boolean {
  const text = (raw ?? "").trim();
  if (!/^https?:\/\//i.test(text)) return false;
  try {
    const url = new URL(text);
    return (url.protocol === "https:" || url.protocol === "http:")
      && !url.username && !url.password && !url.port
      && SHOP_HOSTS.includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export interface LinkPreset { key: string; label: string; url: string }

/** Which preset a stored link is, or "custom". */
export function linkChoiceFor(url: string | null | undefined, presets: readonly LinkPreset[]): string {
  const u = (url ?? "").trim();
  return presets.find(p => p.url === u)?.key ?? "custom";
}

/**
 * Starting text when the final page is switched on — editable, never used
 * in logic. Button defaults to the Menu preset's link.
 */
export const FINAL_PAGE_DEFAULTS = {
  heading: "Need a Carnizone top up?",
  html: "<p>Thank you for your feedback. It really does shape what we make next.</p>",
  buttonLabel: "Order now",
  buttonUrl: "https://thecalzonekitchen.co.uk/pages/menu",
} as const;

export interface FinalPageDraft {
  enabled: boolean;
  heading: string;
  html: string;
  buttonLabel: string;
  buttonUrl: string;
  showOffer: boolean;
}

/** Problems that would stop a save, in plain words (empty = fine). */
export function finalPageProblems(fp: FinalPageDraft): string[] {
  if (!fp.enabled) return [];
  const out: string[] = [];
  const hasButton = fp.buttonLabel.trim().length > 0 || fp.buttonUrl.trim().length > 0;
  if (hasButton && !fp.buttonLabel.trim()) out.push("The button needs a label.");
  if (hasButton && !isShopLink(fp.buttonUrl)) out.push("The button must link to a page on thecalzonekitchen.co.uk.");
  return out;
}
