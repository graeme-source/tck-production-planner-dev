/**
 * Employee form submissions. Currently a single endpoint: email a
 * mileage-claim PDF (generated client-side via jsPDF) to the
 * founder for review. The PDF is forwarded as a Resend attachment;
 * the body summarises the trip total so the recipient gets a quick
 * read without opening the attachment.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { sendEmail } from "../lib/email";

const router: IRouter = Router();

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

export default router;
