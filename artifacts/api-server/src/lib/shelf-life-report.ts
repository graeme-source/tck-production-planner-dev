/**
 * Short shelf life at goods-in — the database + email half (Graeme,
 * 2026-10-16). Objective D (goods-in checks every time).
 *
 * "Brakes promise at least 3 days' shelf life, but it often arrives with 1
 * day." Called by POST /api/deliveries/:id/receive after the receipt is
 * saved. For every line whose ingredient has a minimum shelf life on
 * delivery and whose saved use-by is short (or which was rejected for it):
 *
 *   - one delivery_shelf_life_reports row per PO line (UNIQUE), recording
 *     the decision — who, when, use-by, days vs minimum, accepted/rejected;
 *   - one email to the supplier's account manager (suppliers.
 *     account_manager_email), CC the founder and accounts — visibly, so the
 *     supplier knows they're aware and can reply (Graeme, 2026-10-16) — sent ONLY when
 *     that row is first created — a re-save never re-sends;
 *   - the send is logged on the row: sent / failed + error / no_address /
 *     skipped (staging or BLOCK_SHOPIFY_WRITES). A failure never fails the
 *     goods-in; it comes back to the screen and stays on the row.
 *
 * The rules (what's short, the wording) are pure and tested in
 * lib/goods-in/src/shelf-life.ts.
 */
import { eq, inArray, desc } from "drizzle-orm";
import {
  db, deliveryShelfLifeReportsTable, deliveryRecordsTable, suppliersTable,
} from "@workspace/db";
import {
  londonDeliveryDay, shelfLifeReportFor, shelfLifeReportEmail,
  type ShelfLifeEmailStatus, type ShelfLifeReportOutcome,
} from "@workspace/goods-in";
import { formatCount, unitWord } from "@workspace/units";
import { sendEmail, FROM_EMAIL } from "./email";
import { shouldSkipSideEffect } from "./app-env";
import { FOUNDER_EMAIL } from "./founder-email";
import { ACCOUNTS_MAILBOX } from "./accounts-email";

export interface ShelfLifeCandidate {
  lineId: number;
  ingredientId: number | null;
  ingredientName: string;
  minDays: number | null;
  /** What was saved: quantity received (0 = not received). */
  quantityReceived: number;
  /** Quantity for the email — received, or what was rejected. */
  quantityForReport: number;
  unit: string;
  useByDate: string | null;
  /** The screen's "Reject it", with the use-by the receiver saw. */
  rejected?: { useByDate: string | null | undefined } | null;
}

export async function recordShelfLifeReports(input: {
  purchaseOrderId: number;
  supplierId: number;
  actor: { id: number | null; name: string | null };
  candidates: ShelfLifeCandidate[];
}): Promise<ShelfLifeReportOutcome[]> {
  const relevant = input.candidates.filter(c => c.minDays != null && c.minDays > 0);
  if (relevant.length === 0) return [];

  // The delivery day is the London day it was received — the delivery
  // record's received time (an edit keeps the original day), else today.
  const [record] = await db
    .select({ receivedAt: deliveryRecordsTable.receivedAt })
    .from(deliveryRecordsTable)
    .where(eq(deliveryRecordsTable.purchaseOrderId, input.purchaseOrderId))
    .orderBy(desc(deliveryRecordsTable.receivedAt))
    .limit(1);
  const deliveryDate = londonDeliveryDay(record?.receivedAt ?? new Date());

  const [supplier] = await db
    .select({
      name: suppliersTable.name,
      accountManagerName: suppliersTable.accountManagerName,
      accountManagerEmail: suppliersTable.accountManagerEmail,
    })
    .from(suppliersTable)
    .where(eq(suppliersTable.id, input.supplierId));
  const supplierName = supplier?.name ?? "the supplier";
  const recipientName = supplier?.accountManagerName?.trim() || null;
  const recipientEmail = supplier?.accountManagerEmail?.trim() || null;

  const existing = await db
    .select({ lineId: deliveryShelfLifeReportsTable.purchaseOrderLineId, decision: deliveryShelfLifeReportsTable.decision, emailStatus: deliveryShelfLifeReportsTable.emailStatus })
    .from(deliveryShelfLifeReportsTable)
    .where(inArray(deliveryShelfLifeReportsTable.purchaseOrderLineId, relevant.map(c => c.lineId)));
  const existingByLine = new Map(existing.map(e => [e.lineId, e]));

  const outcomes: ShelfLifeReportOutcome[] = [];
  for (const c of relevant) {
    const report = shelfLifeReportFor({
      deliveryDate,
      minDays: c.minDays,
      quantityReceived: c.quantityReceived,
      useByDate: c.useByDate,
      rejected: c.rejected,
    });
    if (!report) continue;

    const prior = existingByLine.get(c.lineId);
    if (prior) {
      outcomes.push({
        lineId: c.lineId, ingredientName: c.ingredientName, supplierName,
        decision: prior.decision === "rejected" ? "rejected" : "accepted",
        emailStatus: prior.emailStatus as ShelfLifeEmailStatus,
        recipientName, alreadyReported: true,
      });
      continue;
    }

    // Claim the line first: only the save that creates the row emails, so
    // two saves at once can't both send.
    const [row] = await db
      .insert(deliveryShelfLifeReportsTable)
      .values({
        purchaseOrderId: input.purchaseOrderId,
        purchaseOrderLineId: c.lineId,
        supplierId: input.supplierId,
        ingredientId: c.ingredientId,
        ingredientName: c.ingredientName,
        quantity: String(c.quantityForReport),
        unit: c.unit,
        deliveryDate,
        useByDate: report.useByDate,
        shelfLifeDays: report.check.days,
        minShelfLifeDays: report.check.minDays,
        decision: report.decision,
        decidedById: input.actor.id,
        decidedByName: input.actor.name,
      })
      .onConflictDoNothing({ target: deliveryShelfLifeReportsTable.purchaseOrderLineId })
      .returning({ id: deliveryShelfLifeReportsTable.id });
    if (!row) {
      outcomes.push({
        lineId: c.lineId, ingredientName: c.ingredientName, supplierName, decision: report.decision,
        emailStatus: "pending", recipientName, alreadyReported: true,
      });
      continue;
    }

    let status: ShelfLifeEmailStatus;
    let error: string | null = null;
    if (!recipientEmail) {
      status = "no_address";
    } else if (shouldSkipSideEffect()) {
      status = "skipped";
      error = "Outbound email is switched off in this environment";
      console.log(`[shelf-life-report] email skipped (side effects off) for PO #${input.purchaseOrderId} line ${c.lineId}`);
    } else if (!process.env["RESEND_API_KEY"]) {
      status = "failed";
      error = "No email provider configured (RESEND_API_KEY)";
    } else {
      const email = shelfLifeReportEmail({
        supplierName,
        recipientName,
        orderNumber: input.purchaseOrderId,
        deliveryDate,
        productName: c.ingredientName,
        quantityText: `${formatCount(c.quantityForReport)} ${unitWord(c.unit, c.quantityForReport)}`.trim(),
        useByDate: report.useByDate,
        days: report.check.days,
        minDays: report.check.minDays,
        decision: report.decision,
        receivedByName: input.actor.name,
      });
      try {
        await sendEmail({
          to: recipientEmail,
          cc: [FOUNDER_EMAIL, ACCOUNTS_MAILBOX],
          replyTo: FOUNDER_EMAIL,
          fromName: "The Calzone Kitchen",
          fromEmail: FROM_EMAIL,
          subject: email.subject,
          text: email.text,
          html: email.html,
        });
        status = "sent";
      } catch (err) {
        status = "failed";
        error = err instanceof Error ? err.message : String(err);
        console.error(`[shelf-life-report] email failed for PO #${input.purchaseOrderId} line ${c.lineId}:`, error);
      }
    }

    await db
      .update(deliveryShelfLifeReportsTable)
      .set({
        emailStatus: status,
        emailError: error,
        emailedToName: recipientName,
        emailedTo: status === "sent" ? recipientEmail : null,
        emailedAt: status === "sent" ? new Date() : null,
      })
      .where(eq(deliveryShelfLifeReportsTable.id, row.id));

    outcomes.push({
      lineId: c.lineId, ingredientName: c.ingredientName, supplierName, decision: report.decision,
      emailStatus: status, recipientName, alreadyReported: false,
    });
  }
  return outcomes;
}

/** The recorded decisions for one delivery, keyed by line — the receive
 *  dialog shows them on an edit, and managers see whether the email went. */
export async function shelfLifeReportsForOrder(purchaseOrderId: number) {
  const rows = await db
    .select()
    .from(deliveryShelfLifeReportsTable)
    .where(eq(deliveryShelfLifeReportsTable.purchaseOrderId, purchaseOrderId));
  return rows.map(r => ({
    lineId: r.purchaseOrderLineId,
    decision: r.decision,
    useByDate: r.useByDate,
    shelfLifeDays: r.shelfLifeDays,
    minShelfLifeDays: r.minShelfLifeDays,
    decidedByName: r.decidedByName,
    decidedAt: r.decidedAt.toISOString(),
    emailStatus: r.emailStatus,
    emailError: r.emailError,
    emailedToName: r.emailedToName,
    emailedAt: r.emailedAt ? r.emailedAt.toISOString() : null,
  }));
}
