/**
 * Survey intro — formatted text from the planner's rich-text editor, shown
 * as HTML on the PUBLIC Shopify feedback page. That makes this file the
 * security boundary: everything goes through sanitiseSurveyIntroHtml() on
 * save AND again on output, so a bad row (or a future bug in the save path)
 * still can't put script on the website.
 *
 * Strict allow-list — anything not listed is removed:
 *   p, br, strong, em, u, h2, h3, ul, ol, li   (b -> strong, i -> em)
 *   a     href only, http/https/mailto only; rel + target forced
 *   span  class only, from SURVEY_INTRO_SPAN_CLASSES (font + size)
 *   p/h2/h3  class only, from SURVEY_INTRO_ALIGN_CLASSES
 * No style attributes at all (fonts and sizes are classes the page styles
 * itself), no event handlers, no images, no iframes. Script/style/textarea
 * contents are dropped with the tag.
 *
 * Objective I (customer feedback shapes what we launch).
 */
import sanitizeHtml from "sanitize-html";

/** Font + size choices. The theme and the planner preview style these. */
export const SURVEY_INTRO_SPAN_CLASSES = [
  "tck-font-heading", // the site's heading font (Swiss 721 Rounded)
  "tck-font-serif",   // system serif (Georgia) — no font download
  "tck-size-small",
  "tck-size-large",
] as const;

/** Paragraph alignment. Default (no class) = centred, as the page was. */
export const SURVEY_INTRO_ALIGN_CLASSES = ["tck-align-left", "tck-align-center"] as const;

/** Raw HTML from the editor is capped well above any sensible intro. */
export const SURVEY_INTRO_HTML_MAX = 20000;

const BLOCK_CLASSES = [...SURVEY_INTRO_ALIGN_CLASSES];

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ["p", "br", "strong", "em", "u", "h2", "h3", "ul", "ol", "li", "a", "span"],
  allowedAttributes: {
    a: ["href", "rel", "target"],
    span: ["class"],
    p: ["class"],
    h2: ["class"],
    h3: ["class"],
  },
  allowedClasses: {
    span: [...SURVEY_INTRO_SPAN_CLASSES],
    p: BLOCK_CLASSES,
    h2: BLOCK_CLASSES,
    h3: BLOCK_CLASSES,
  },
  allowedStyles: {},
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: {},
  allowedSchemesAppliedToAttributes: ["href"],
  allowProtocolRelative: false,
  allowVulnerableTags: false,
  disallowedTagsMode: "discard",
  // Contents of these are dropped along with the tag, not shown as text.
  nonTextTags: ["script", "style", "textarea", "option", "noscript", "title", "template", "iframe", "object", "embed", "svg", "math"],
  transformTags: {
    b: "strong",
    i: "em",
    h1: "h2",
    h4: "h3",
    h5: "h3",
    h6: "h3",
    // Every link opens in a new tab and can't reach back into the page.
    // The href is still checked against allowedSchemes after this runs.
    a: (_tagName, attribs) => ({
      tagName: "a",
      attribs: {
        ...(attribs["href"] ? { href: attribs["href"] } : {}),
        rel: "noopener noreferrer",
        target: "_blank",
      },
    }),
  },
};

/** True when the HTML has no visible text (e.g. the editor's "<p></p>"). */
function isBlank(html: string): boolean {
  return htmlToPlainText(html).trim().length === 0;
}

/**
 * Sanitise editor HTML for storage/output. Returns null when nothing
 * visible is left, so an emptied editor clears the intro.
 */
export function sanitiseSurveyIntroHtml(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const clean = sanitizeHtml(String(raw).slice(0, SURVEY_INTRO_HTML_MAX), OPTIONS)
    // The editor leaves an empty paragraph after the last line — drop empty
    // paragraphs at the start and end (ones in the middle are deliberate space).
    .replace(/^(\s*<p>(\s|<br \/>)*<\/p>)+/, "")
    .replace(/(<p>(\s|<br \/>)*<\/p>\s*)+$/, "")
    .trim();
  if (!clean || isBlank(clean)) return null;
  return clean;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Older plain-text intros: blank lines start a new paragraph, single line
 * breaks become <br>. (This is what fixes "my paragraph breaks are ignored"
 * for intros written before the rich editor.)
 */
export function plainTextToIntroHtml(text: string | null | undefined): string | null {
  if (text == null) return null;
  const normalised = String(text).replace(/\r\n?/g, "\n").trim();
  if (!normalised) return null;
  return normalised
    .split(/\n\s*\n+/)
    .map(para => `<p>${para.split("\n").map(line => escapeHtml(line.trim())).join("<br />")}</p>`)
    .join("");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#0*39;/g, "'")
    .replace(/&#x0*27;/gi, "'")
    .replace(/&amp;/g, "&");
}

/**
 * Plain-text version of (already sanitised) intro HTML — paragraphs and
 * headings separated by a blank line, list items as "• item". Stored in
 * `intro` for the invite email and older theme code.
 */
export function htmlToPlainText(html: string): string {
  const text = html
    // The editor wraps list items in <p>; don't let that add blank lines.
    .replace(/<li([^>]*)>\s*<p[^>]*>/gi, "<li$1>")
    .replace(/<\/p>\s*<\/li>/gi, "</li>")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/(p|h2|h3|ul|ol)>/gi, "\n\n")
    .replace(/<[^>]*>/g, "");
  return decodeEntities(text)
    .split("\n").map(l => l.replace(/[ \t]+/g, " ").trim()).join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * What the save path stores: sanitised HTML plus its plain-text twin.
 * `html` undefined = this client didn't send formatted text (older code,
 * templates) — keep the plain intro and no HTML.
 */
export function prepareSurveyIntro(input: { intro?: string | null; html?: string | null }): { intro: string | null; introHtml: string | null } {
  if (input.html === undefined) {
    const plain = input.intro?.trim() || null;
    return { intro: plain, introHtml: null };
  }
  const introHtml = sanitiseSurveyIntroHtml(input.html);
  return { intro: introHtml ? htmlToPlainText(introHtml) : null, introHtml };
}

/**
 * The HTML to SHOW for a survey row — sanitised again on output; older
 * surveys with only plain text get paragraphs.
 */
export function surveyIntroHtml(row: { intro: string | null; introHtml: string | null }): string | null {
  if (row.introHtml) return sanitiseSurveyIntroHtml(row.introHtml);
  return plainTextToIntroHtml(row.intro);
}
