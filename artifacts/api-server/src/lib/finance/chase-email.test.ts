import { describe, it, expect } from "vitest";
import { buildChaseEmail } from "./chase-email";

describe("buildChaseEmail", () => {
  const email = buildChaseEmail({ toEmail: "supplier@example.com", subject: "VAT invoice request", message: "Hi,\n\nPlease send it.\nThanks" });

  it("goes only to the supplier — no hard-coded copy to accounts@", () => {
    expect(email.to).toBe("supplier@example.com");
    expect(email.cc ?? []).toEqual([]);
    expect(email.bcc ?? []).toEqual([]);
  });

  it("still sends from the accounts identity with replies to accounts@", () => {
    expect(email.fromEmail).toBe("accounts@notify.thecalzonekitchen.co.uk");
    expect(email.replyTo).toBe("accounts@thecalzonekitchen.co.uk");
  });

  it("turns paragraphs and line breaks into HTML and escapes it", () => {
    expect(email.html).toContain("<p>Hi,</p><p>Please send it.<br/>Thanks</p>");
    expect(buildChaseEmail({ toEmail: "a@b.co", subject: "s", message: "<b>&" }).html).toContain("&lt;b&gt;&amp;");
  });
});
