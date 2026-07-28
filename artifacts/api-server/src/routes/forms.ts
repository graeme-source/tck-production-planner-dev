/**
 * Employee form submissions: email a client-side-generated PDF
 * (mileage claim or expense claim, both built via jsPDF) to the
 * founder for review. The PDF is forwarded as a Resend attachment;
 * the body summarises the totals so the recipient gets a quick
 * read without opening the attachment.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { sendEmail } from "../lib/email";

const router: IRouter = Router();

// Expense claims arrive as multipart (claim PDF + any PDF receipts) because
// the global JSON body limit is 1MB — same approach as improvement media.
// Photo receipts are embedded inside the claim PDF client-side, so only
// receipts that were already PDFs travel as separate files.
const expenseUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 31 } });
// Resend caps emails at 40MB; leave headroom for base64 inflation (~35%).
const MAX_EMAIL_BYTES = 25 * 1024 * 1024;

const MILEAGE_REVIEW_TO = "graeme@thecalzonekitchen.co.uk";
const MILEAGE_REVIEW_SUBJECT = "TCK Mileage claim form for review";

interface MileageEmailBody {
  pdfBase64: string;
  filename?: string;
  totalMiles?: number;
  totalAmount?: number;
  periodStart?: string;
  periodEnd?: string;
  employeeName?: string;
}

router.post("/mileage-claim/email", async (req: Request, res: Response) => {
  const { pdfBase64, filename, totalMiles, totalAmount, periodStart, periodEnd, employeeName } = req.body as MileageEmailBody;
  if (!pdfBase64 || typeof pdfBase64 !== "string") {
    res.status(400).json({ error: "pdfBase64 is required" });
    return;
  }

  // Identify the submitter from the session so we don't blindly trust
  // the employeeName the client sent.
  const userId = req.session.userId;
  let submitterName = employeeName?.trim() || "(unknown)";
  let submitterEmail: string | null = null;
  if (userId) {
    const [user] = await db
      .select({ name: usersTable.name, email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.id, userId));
    if (user) {
      submitterName = user.name;
      submitterEmail = user.email;
    }
  }

  const safeFilename = (filename ?? `mileage-claim-${submitterName.toLowerCase().replace(/\s+/g, "-")}.pdf`).replace(/[^a-zA-Z0-9._-]/g, "_");
  const periodLine = periodStart && periodEnd ? `<p><strong>Period:</strong> ${periodStart} – ${periodEnd}</p>` : "";
  const milesLine = typeof totalMiles === "number" ? `<p><strong>Total miles:</strong> ${totalMiles}</p>` : "";
  const amountLine = typeof totalAmount === "number" ? `<p><strong>Total claim:</strong> £${totalAmount.toFixed(2)}</p>` : "";

  const html = `<!DOCTYPE html><html><body style="font-family: sans-serif; max-width: 560px; margin: 32px auto; color: #333;">
    <h2 style="color: #1a1a1a;">Mileage claim — ${submitterName}</h2>
    <p>${submitterName} has submitted a mileage claim for review. The PDF is attached.</p>
    ${periodLine}
    ${milesLine}
    ${amountLine}
    <p style="color:#999;font-size:12px;margin-top:24px;">Submitted via TCK Production Planner.</p>
  </body></html>`;

  const text = [
    `Mileage claim — ${submitterName}`,
    "",
    `${submitterName} has submitted a mileage claim for review. The PDF is attached.`,
    periodStart && periodEnd ? `Period: ${periodStart} – ${periodEnd}` : null,
    typeof totalMiles === "number" ? `Total miles: ${totalMiles}` : null,
    typeof totalAmount === "number" ? `Total claim: £${totalAmount.toFixed(2)}` : null,
  ].filter(Boolean).join("\n");

  try {
    await sendEmail({
      to: MILEAGE_REVIEW_TO,
      subject: MILEAGE_REVIEW_SUBJECT,
      html,
      text,
      attachments: [{
        filename: safeFilename,
        content: pdfBase64,
        contentType: "application/pdf",
      }],
    });
    res.json({ ok: true, sentTo: MILEAGE_REVIEW_TO, submitter: { name: submitterName, email: submitterEmail } });
  } catch (err) {
    console.error("[forms] mileage-claim email failed:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to send email" });
  }
});

const EXPENSE_REVIEW_TO = "graeme@thecalzonekitchen.co.uk";
const EXPENSE_REVIEW_SUBJECT = "TCK Expense claim form for review";

router.post(
  "/expense-claim/email",
  expenseUpload.fields([{ name: "claimPdf", maxCount: 1 }, { name: "receipts", maxCount: 30 }]),
  async (req: Request, res: Response) => {
  // Text fields arrive on req.body via multer; files on req.files.
  const { filename, totalGross, totalVat, lineCount, employeeName } = req.body as Record<string, string | undefined>;
  const files = req.files as Record<string, Express.Multer.File[]> | undefined;
  const claimPdf = files?.claimPdf?.[0];
  const receipts = files?.receipts ?? [];
  if (!claimPdf || claimPdf.mimetype !== "application/pdf") {
    res.status(400).json({ error: "claimPdf (application/pdf) is required" });
    return;
  }
  for (const r of receipts) {
    if (r.mimetype !== "application/pdf") {
      res.status(400).json({ error: `Unsupported receipt type ${r.mimetype} — photo receipts are embedded in the claim PDF; only PDF receipts should be attached.` });
      return;
    }
  }
  const totalBytes = claimPdf.size + receipts.reduce((s, r) => s + r.size, 0);
  if (totalBytes > MAX_EMAIL_BYTES) {
    res.status(413).json({ error: "Attachments too large for one email — split the claim into two submissions." });
    return;
  }

  // Identify the submitter from the session so we don't blindly trust
  // the employeeName the client sent.
  const userId = req.session.userId;
  let submitterName = employeeName?.trim() || "(unknown)";
  let submitterEmail: string | null = null;
  if (userId) {
    const [user] = await db
      .select({ name: usersTable.name, email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.id, userId));
    if (user) {
      submitterName = user.name;
      submitterEmail = user.email;
    }
  }

  const gross = totalGross != null && totalGross !== "" ? Number(totalGross) : null;
  const vat = totalVat != null && totalVat !== "" ? Number(totalVat) : null;
  const items = lineCount != null && lineCount !== "" ? Number(lineCount) : null;

  const safeFilename = (filename ?? `expense-claim-${submitterName.toLowerCase().replace(/\s+/g, "-")}.pdf`).replace(/[^a-zA-Z0-9._-]/g, "_");
  const itemsLine = items != null && !isNaN(items) ? `<p><strong>Items:</strong> ${items}</p>` : "";
  const grossLine = gross != null && !isNaN(gross) ? `<p><strong>Total claim (gross):</strong> £${gross.toFixed(2)}</p>` : "";
  const vatLine = vat != null && !isNaN(vat) ? `<p><strong>Of which VAT:</strong> £${vat.toFixed(2)}</p>` : "";
  const receiptsLine = receipts.length > 0 ? `<p><strong>PDF receipts attached separately:</strong> ${receipts.length}</p>` : "";

  const html = `<!DOCTYPE html><html><body style="font-family: sans-serif; max-width: 560px; margin: 32px auto; color: #333;">
    <h2 style="color: #1a1a1a;">Expense claim — ${submitterName}</h2>
    <p>${submitterName} has submitted an expense claim for review. The claim PDF (with photo receipts embedded) is attached${receipts.length > 0 ? ", along with the receipts that were supplied as PDFs" : ""}.</p>
    ${itemsLine}
    ${grossLine}
    ${vatLine}
    ${receiptsLine}
    <p style="color:#999;font-size:12px;margin-top:24px;">Submitted via TCK Production Planner.</p>
  </body></html>`;

  const text = [
    `Expense claim — ${submitterName}`,
    "",
    `${submitterName} has submitted an expense claim for review. The claim PDF (with photo receipts embedded) is attached.`,
    items != null && !isNaN(items) ? `Items: ${items}` : null,
    gross != null && !isNaN(gross) ? `Total claim (gross): £${gross.toFixed(2)}` : null,
    vat != null && !isNaN(vat) ? `Of which VAT: £${vat.toFixed(2)}` : null,
    receipts.length > 0 ? `PDF receipts attached separately: ${receipts.length}` : null,
  ].filter(Boolean).join("\n");

  try {
    await sendEmail({
      to: EXPENSE_REVIEW_TO,
      subject: EXPENSE_REVIEW_SUBJECT,
      html,
      text,
      attachments: [
        {
          filename: safeFilename,
          content: claimPdf.buffer.toString("base64"),
          contentType: "application/pdf",
        },
        ...receipts.map((r, i) => ({
          filename: (r.originalname || `receipt-${i + 1}.pdf`).replace(/[^a-zA-Z0-9._-]/g, "_"),
          content: r.buffer.toString("base64"),
          contentType: "application/pdf",
        })),
      ],
    });
    res.json({ ok: true, sentTo: EXPENSE_REVIEW_TO, submitter: { name: submitterName, email: submitterEmail } });
  } catch (err) {
    console.error("[forms] expense-claim email failed:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to send email" });
  }
});

export default router;
