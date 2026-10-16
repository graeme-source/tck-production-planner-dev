import { describe, expect, it } from "vitest";
import {
  htmlToPlainText, plainTextToIntroHtml, prepareSurveyIntro, sanitiseSurveyIntroHtml, surveyIntroHtml,
} from "./survey-intro";

const s = sanitiseSurveyIntroHtml;

describe("sanitiseSurveyIntroHtml — allowed formatting survives", () => {
  it("keeps paragraphs, bold, italic, underline, headings, lists, breaks", () => {
    const html = "<h2>Vote</h2><h3>How</h3><p><strong>Bold</strong> <em>it</em> <u>u</u><br>next</p><ul><li>a</li></ul><ol><li>b</li></ol>";
    expect(s(html)).toBe("<h2>Vote</h2><h3>How</h3><p><strong>Bold</strong> <em>it</em> <u>u</u><br />next</p><ul><li>a</li></ul><ol><li>b</li></ol>");
  });

  it("maps b/i to strong/em and h1/h4 to h2/h3", () => {
    expect(s("<h1>A</h1><h4>B</h4><p><b>x</b><i>y</i></p>")).toBe("<h2>A</h2><h3>B</h3><p><strong>x</strong><em>y</em></p>");
  });

  it("keeps allow-listed font, size and alignment classes only", () => {
    expect(s('<p class="tck-align-left"><span class="tck-font-heading tck-size-large">Hi</span></p>'))
      .toBe('<p class="tck-align-left"><span class="tck-font-heading tck-size-large">Hi</span></p>');
    expect(s('<p class="evil tck-align-center"><span class="hidden tck-font-serif">x</span></p>'))
      .toBe('<p class="tck-align-center"><span class="tck-font-serif">x</span></p>');
  });

  it("forces rel/target on safe links", () => {
    expect(s('<p><a href="https://thecalzonekitchen.co.uk/pages/menu" target="_self" rel="opener">menu</a></p>'))
      .toBe('<p><a href="https://thecalzonekitchen.co.uk/pages/menu" rel="noopener noreferrer" target="_blank">menu</a></p>');
    expect(s('<p><a href="mailto:hello@thecalzonekitchen.co.uk">mail</a></p>'))
      .toContain('href="mailto:hello@thecalzonekitchen.co.uk"');
  });

  it("returns null for an empty editor", () => {
    expect(s("<p></p>")).toBeNull();
    expect(s("<p> &nbsp; </p><p><br></p>")).toBeNull();
    expect(s("")).toBeNull();
    expect(s(null)).toBeNull();
  });
});

describe("sanitiseSurveyIntroHtml — XSS attempts are removed", () => {
  it("drops script tags and their contents", () => {
    const out = s("<p>Hi</p><script>alert(1)</script><SCRIPT src=//x.js></SCRIPT>")!;
    expect(out).toBe("<p>Hi</p>");
  });

  it("drops event handlers", () => {
    const out = s('<p onclick="alert(1)">x</p><img src=x onerror="alert(1)"><span onmouseover="alert(1)" class="tck-size-small">y</span>')!;
    expect(out).not.toMatch(/on\w+=/i);
    expect(out).not.toContain("<img");
    expect(out).toContain('<span class="tck-size-small">y</span>');
  });

  it("drops javascript:, data: and vbscript: links, including disguised ones", () => {
    for (const href of [
      "javascript:alert(1)", "JaVaScRiPt:alert(1)", " javascript:alert(1)", "&#106;avascript:alert(1)",
      "java\tscript:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:msgbox(1)", "//evil.example/x",
    ]) {
      const out = s(`<p><a href="${href}">x</a></p>`)!;
      expect(out, href).not.toMatch(/href=/i);
    }
  });

  it("drops every style attribute and style tag", () => {
    const out = s('<p style="position:fixed;top:0">a</p><span style="font-family:Comic Sans;background:url(javascript:alert(1))">b</span><style>body{display:none}</style>')!;
    expect(out).not.toMatch(/style/i);
    expect(out).toContain("a");
    expect(out).toContain("b");
  });

  it("drops iframes, images, forms, svg and objects", () => {
    const out = s('<iframe src="https://evil"></iframe><img src="https://x/y.png"><form action="x"><input></form><svg onload=alert(1)><circle/></svg><object data="x"></object><p>ok</p>')!;
    expect(out).toBe("<p>ok</p>");
  });

  it("escapes text that looks like markup after decoding", () => {
    const out = s("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>")!;
    expect(out).not.toContain("<script");
    expect(out).toContain("&lt;script&gt;");
  });
});

describe("plain text intros (older surveys)", () => {
  it("turns blank lines into paragraphs and single newlines into breaks", () => {
    expect(plainTextToIntroHtml("Line one\nline two\n\nSecond para")).toBe("<p>Line one<br />line two</p><p>Second para</p>");
  });

  it("escapes markup in plain text", () => {
    expect(plainTextToIntroHtml("<b>hi</b> & bye")).toBe("<p>&lt;b&gt;hi&lt;/b&gt; &amp; bye</p>");
  });

  it("surveyIntroHtml prefers stored HTML (re-sanitised) and falls back to plain text", () => {
    expect(surveyIntroHtml({ intro: "a", introHtml: "<p>b</p><script>x</script>" })).toBe("<p>b</p>");
    expect(surveyIntroHtml({ intro: "a\n\nb", introHtml: null })).toBe("<p>a</p><p>b</p>");
    expect(surveyIntroHtml({ intro: null, introHtml: null })).toBeNull();
  });
});

describe("htmlToPlainText + prepareSurveyIntro", () => {
  it("keeps paragraph breaks and bullets in the plain twin", () => {
    expect(htmlToPlainText("<h2>Vote</h2><p>One &amp; <strong>two</strong><br />three</p><ul><li>a</li><li>b</li></ul>"))
      .toBe("Vote\n\nOne & two\nthree\n\n• a\n• b");
  });

  it("does not put blank lines between list items the editor wrapped in <p>", () => {
    expect(htmlToPlainText("<p>Hi</p><ul><li><p>a</p></li><li><p>b</p></li></ul><p>End</p>")).toBe("Hi\n\n• a\n• b\n\nEnd");
  });

  it("drops the editor's empty trailing (and leading) paragraphs but keeps middle spacing", () => {
    expect(sanitiseSurveyIntroHtml("<p></p><p>a</p><p></p><p>b</p><p></p><p><br></p>")).toBe("<p>a</p><p></p><p>b</p>");
  });

  it("formatted save stores sanitised HTML and its plain text", () => {
    expect(prepareSurveyIntro({ intro: "ignored", html: "<p>Hi <b>there</b></p><script>x</script>" }))
      .toEqual({ intro: "Hi there", introHtml: "<p>Hi <strong>there</strong></p>" });
  });

  it("an emptied editor clears both", () => {
    expect(prepareSurveyIntro({ intro: "old", html: "<p></p>" })).toEqual({ intro: null, introHtml: null });
  });

  it("plain-only saves (templates, older clients) keep the plain intro", () => {
    expect(prepareSurveyIntro({ intro: "  Hello  " })).toEqual({ intro: "Hello", introHtml: null });
  });
});
