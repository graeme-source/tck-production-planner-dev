import { describe, expect, it } from "vitest";
import { simpleParser } from "mailparser";
import { attachmentMime, listedAttachments } from "./email-attachments";

describe("listedAttachments", () => {
  it("lists the PDFs and real attachments, not the logos inside the email", () => {
    const list = listedAttachments([
      { filename: "logo.png", contentType: "image/png", contentDisposition: "inline", related: true, cid: "logo" },
      { filename: "Order-123.pdf", contentType: "application/pdf", contentDisposition: "attachment", size: 2000 },
      { filename: "VAT Invoice 123.pdf", contentType: "application/octet-stream", contentDisposition: "attachment", size: 3000 },
      { filename: "receipt.jpg", contentType: "image/jpeg", contentDisposition: "attachment" },
      { filename: "terms.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", contentDisposition: "attachment" },
    ]);
    expect(list.map((a) => a.index)).toEqual([1, 2, 3, 4]);
    expect(list[1]).toMatchObject({ contentType: "application/pdf", previewable: true });
    expect(list[2].previewable).toBe(true);
    expect(list[3].previewable).toBe(false);
  });

  it("treats a PDF sent as octet-stream as a PDF", () => {
    expect(attachmentMime("application/octet-stream", "INV-9.PDF")).toBe("application/pdf");
    expect(attachmentMime("application/octet-stream", "scan.jpeg")).toBe("image/jpeg");
  });
});

describe("listedAttachments on a real parsed email", () => {
  it("finds the VAT invoice riding along with an order confirmation", async () => {
    const b64 = Buffer.from("%PDF-1.4 fake").toString("base64");
    const raw = [
      "From: Shop <orders@shop.example>",
      "To: accounts@thecalzonekitchen.co.uk",
      "Subject: Your order confirmation #5512",
      "MIME-Version: 1.0",
      'Content-Type: multipart/mixed; boundary="MIX"',
      "",
      "--MIX",
      'Content-Type: multipart/related; boundary="REL"',
      "",
      "--REL",
      "Content-Type: text/html; charset=utf-8",
      "",
      '<p>Thanks for your order</p><img src="cid:logo1">',
      "--REL",
      "Content-Type: image/png",
      "Content-ID: <logo1>",
      "Content-Disposition: inline; filename=logo.png",
      "Content-Transfer-Encoding: base64",
      "",
      "iVBORw0KGgo=",
      "--REL--",
      "--MIX",
      'Content-Type: application/octet-stream; name="VAT-Invoice-5512.pdf"',
      'Content-Disposition: attachment; filename="VAT-Invoice-5512.pdf"',
      "Content-Transfer-Encoding: base64",
      "",
      b64,
      "--MIX--",
      "",
    ].join("\r\n");
    const parsed = await simpleParser(raw);
    const list = listedAttachments(parsed.attachments);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ filename: "VAT-Invoice-5512.pdf", contentType: "application/pdf", previewable: true });
    expect(parsed.attachments[list[0].index].filename).toBe("VAT-Invoice-5512.pdf");
  });
});
