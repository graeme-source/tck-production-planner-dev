import { describe, expect, it } from "vitest";
import { emailByDefault, publishedKind, recordPublishedEmail } from "./reviews";

describe("the 'it's on your record' email", () => {
  it("knows a performance review and a disciplinary, and ticks the email for those", () => {
    expect(publishedKind(["Performance appraisal"], null)).toBe("performance");
    expect(publishedKind(["Performance appraisal", "Disciplinary"], null)).toBe("disciplinary");
    expect(publishedKind([], "disciplinary")).toBe("disciplinary");
    expect(publishedKind(["1:1 / catch-up"], "one_to_one")).toBe("other");
    expect(emailByDefault("performance")).toBe(true);
    expect(emailByDefault("disciplinary")).toBe(true);
    expect(emailByDefault("other")).toBe(false);
  });

  it("says a performance review is ready, with the link to My Record", () => {
    const m = recordPublishedEmail("Kyra Lucy Carroll", "performance", "https://app.example/");
    expect(m.subject).toBe("Your performance review is ready to read");
    expect(m.text).toContain("Hi Kyra,");
    expect(m.text).toContain("objectives and feedback");
    expect(m.text).toContain("https://app.example/hub?section=reviews&own=1");
    expect(m.html).toContain('href="https://app.example/hub?section=reviews&amp;own=1"');
  });

  it("never names a disciplinary in the subject", () => {
    const m = recordPublishedEmail("Sam", "disciplinary", "https://app.example");
    expect(m.subject.toLowerCase()).not.toContain("disciplinary");
    expect(m.text.toLowerCase()).not.toContain("disciplinary");
  });

  it("escapes a name in the HTML", () => {
    expect(recordPublishedEmail("<b>Al", "other", "https://x").html).toContain("Hi &lt;b&gt;Al,");
  });
});
