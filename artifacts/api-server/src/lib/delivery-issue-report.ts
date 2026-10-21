/**
 * Delivery issues reported to the supplier, with photos — the database +
 * email half (Graeme, 2026-10-16). Objective D (goods-in checks every time).
 *
 * "Today 8 bags of chicken with use-by the 17th came in; I took one picture
 * of all 8 bags showing the date and sent it to the account manager James.
 * Make that the process." Same for broken or damaged items.
 *
 * Called by POST /api/deliveries/:id/receive. An issue line is a line that
 * arrived short-dated (accepted or rejected — ingredient minimum shelf life)
 * or was marked Damaged / broken (kept or rejected). For each:
 *
 *   - one row per PO line (delivery_shelf_life_reports /
 *     delivery_damage_reports, UNIQUE line) recording who, when, what;
 *   - ONE email per receive to the supplier's account manager
 *     (suppliers.account_manager_email) listing every NEW issue line, with
 *     the goods-in photos attached; the founder and the accounts mailbox are
 *     visibly CC'd, replies go to the founder. Sent only for rows this save
 *     created — a re-save never re-sends; a later save that adds new issue
 *     lines sends one email for just those.
 *   - the send is logged on every row it covered: sent / failed + error /
 *     no_address / skipped (staging or BLOCK_SHOPIFY_WRITES). A failure never
 *     fails the goods-in; it comes back to the screen and stays on the rows.
 *
 * The photo is mandatory: the receive endpoint refuses a save with new issue
 * lines and no uploaded photo (countNewIssues + issuePhotoGate) BEFORE
 * anything is written. The rules and wording are pure and tested in
 * lib/goods-in/src/delivery-issues.ts and shelf-life.ts.
 */
import { and, eq, inArray, desc } from "drizzle-orm";
import {
  db, deliveryShelfLifeReportsTable, deliveryDamageReportsTable, deliveryIssuePhotosTable,
  deliveryRecordsTable, suppliersTable, ingredientsTable,
} from "@workspace/db";
import {
  londonDeliveryDay, shelfLifeReportFor, damageReportFor, deliveryIssueReportEmail, formatReportQty,
  type DamageInput, type DeliveryEmailIssue, type DeliveryIssueOutcome, type IssueEmailStatus,
} from "@workspace/goods-in";
import { sendEmail, FROM_EMAIL } from "./email";
import { shouldSkipSideEffect } from "./app-env";
import { FOUNDER_EMAIL } from "./founder-email";
import { ACCOUNTS_MAILBOX } from "./accounts-email";

/** How a line's quantity reads ("8 packs", "20 kg"). */
export interface QtyFormat {
  unit: string;
  nativeUnit?: string | null;
  packWeight?: number | string | null;
  stockInPacks?: boolean | null;
}

export interface ShelfLifeCandidate {
  /** Null for a line not inserted yet (the pre-save photo check). */
  lineId: number | null;
  ingredientId: number | null;
  ingredientName: string;
  minDays: number | null;
  /** What was saved: quantity received (0 = not received). */
  quantityReceived: number;
  /** Quantity for the email — received, or what was rejected. */
  quantityForReport: number;
  qty: QtyFormat;
  useByDate: string | null;
  /** The screen's "Reject it", with the use-by the receiver saw. */
  rejected?: { useByDate: string | null | undefined } | null;
}

export interface DamageCandidate {
  lineId: number;
  ingredientId: number | null;
  ingredientName: string;
  /** What was saved as received (after any rejected damage). */
  quantityReceived: number;
  qty: QtyFormat;
  damage: DamageInput;
}

/** The London day the goods were received — the delivery record's received
 *  time (an edit keeps the original day), else today. */
export async function deliveryDayForOrder(purchaseOrderId: number): Promise<string> {
  const [record] = await db
    .select({ receivedAt: deliveryRecordsTable.receivedAt })
    .from(deliveryRecordsTable)
    .where(eq(deliveryRecordsTable.purchaseOrderId, purchaseOrderId))
    .orderBy(desc(deliveryRecordsTable.receivedAt))
    .limit(1);
  return londonDeliveryDay(record?.receivedAt ?? new Date());
}

/** How many issue lines this save would report for the first time — the
 *  photo gate runs on this before anything is written. */
export async function countNewIssues(input: {
  deliveryDate: string;
  shelfLife: ShelfLifeCandidate[];
  damage: DamageCandidate[];
}): Promise<number> {
  const sl = input.shelfLife.filter(c => shelfLifeReportFor({
    deliveryDate: input.deliveryDate, minDays: c.minDays, quantityReceived: c.quantityReceived,
    useByDate: c.useByDate, rejected: c.rejected,
  }));
  const dm = input.damage.filter(c => damageReportFor({ quantityReceived: c.quantityReceived, damage: c.damage }));
  const slIds = sl.map(c => c.lineId).filter((id): id is number => id != null);
  const dmIds = dm.map(c => c.lineId);
  const slDone = slIds.length
    ? new Set((await db.select({ id: deliveryShelfLifeReportsTable.purchaseOrderLineId }).from(deliveryShelfLifeReportsTable)
        .where(inArray(deliveryShelfLifeReportsTable.purchaseOrderLineId, slIds))).map(r => r.id))
    : new Set<number>();
  const dmDone = dmIds.length
    ? new Set((await db.select({ id: deliveryDamageReportsTable.purchaseOrderLineId }).from(deliveryDamageReportsTable)
        .where(inArray(deliveryDamageReportsTable.purchaseOrderLineId, dmIds))).map(r => r.id))
    : new Set<number>();
  return sl.filter(c => c.lineId == null || !slDone.has(c.lineId)).length
    + dm.filter(c => !dmDone.has(c.lineId)).length;
}

/** Of the ids sent, the photos that really belong to this delivery. */
export async function validIssuePhotoIds(purchaseOrderId: number, ids: number[]): Promise<number[]> {
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  const rows = await db
    .select({ id: deliveryIssuePhotosTable.id })
    .from(deliveryIssuePhotosTable)
    .where(and(eq(deliveryIssuePhotosTable.purchaseOrderId, purchaseOrderId), inArray(deliveryIssuePhotosTable.id, unique)));
  const ok = new Set(rows.map(r => r.id));
  return unique.filter(id => ok.has(id));
}

export async function recordDeliveryIssues(input: {
  purchaseOrderId: number;
  supplierId: number;
  deliveryDate: string;
  actor: { id: number | null; name: string | null };
  shelfLife: ShelfLifeCandidate[];
  damage: DamageCandidate[];
  photoIds: number[];
  photosConfirmed: boolean;
}): Promise<DeliveryIssueOutcome> {
  const [supplier] = await db
    .select({
      name: suppliersTable.name,
      accountManagerName: suppliersTable.accountManagerName,
      accountManagerEmail: suppliersTable.accountManagerEmail,
      accountNumber: suppliersTable.accountNumber,
    })
    .from(suppliersTable)
    .where(eq(suppliersTable.id, input.supplierId));
  const supplierName = supplier?.name ?? "the supplier";
  // The supplier's product code for each line (ingredients.supplier_part_
  // number), quoted in the email as stored (Graeme, 21 Oct 2026).
  const ingredientIds = [...new Set([...input.shelfLife, ...input.damage]
    .map(c => c.ingredientId).filter((id): id is number => id != null))];
  const codeByIngredient = new Map<number, string | null>(ingredientIds.length
    ? (await db.select({ id: ingredientsTable.id, code: ingredientsTable.supplierPartNumber })
        .from(ingredientsTable).where(inArray(ingredientsTable.id, ingredientIds))).map(r => [r.id, r.code])
    : []);
  const productCodeOf = (ingredientId: number | null) => (ingredientId != null ? codeByIngredient.get(ingredientId) ?? null : null);
  const recipientName = supplier?.accountManagerName?.trim() || null;
  const recipientEmail = supplier?.accountManagerEmail?.trim() || null;

  const outcome: DeliveryIssueOutcome = {
    supplierName, recipientName, reported: [], alreadyReported: 0,
    emailStatus: null, emailError: null, photoCount: input.photoIds.length,
  };
  const emailIssues: DeliveryEmailIssue[] = [];
  const newShelfLifeRows: number[] = [];
  const newDamageRows: number[] = [];

  // Claim each line first: only the save that creates the row emails, so
  // two saves at once can't both send.
  for (const c of input.shelfLife) {
    if (c.lineId == null) continue;
    const report = shelfLifeReportFor({
      deliveryDate: input.deliveryDate, minDays: c.minDays, quantityReceived: c.quantityReceived,
      useByDate: c.useByDate, rejected: c.rejected,
    });
    if (!report) continue;
    const [row] = await db
      .insert(deliveryShelfLifeReportsTable)
      .values({
        purchaseOrderId: input.purchaseOrderId,
        purchaseOrderLineId: c.lineId,
        supplierId: input.supplierId,
        ingredientId: c.ingredientId,
        ingredientName: c.ingredientName,
        quantity: String(c.quantityForReport),
        unit: c.qty.unit,
        deliveryDate: input.deliveryDate,
        useByDate: report.useByDate,
        shelfLifeDays: report.check.days,
        minShelfLifeDays: report.check.minDays,
        decision: report.decision,
        decidedById: input.actor.id,
        decidedByName: input.actor.name,
        photoIds: input.photoIds,
        photosConfirmed: input.photosConfirmed,
      })
      .onConflictDoNothing({ target: deliveryShelfLifeReportsTable.purchaseOrderLineId })
      .returning({ id: deliveryShelfLifeReportsTable.id });
    if (!row) { outcome.alreadyReported++; continue; }
    newShelfLifeRows.push(row.id);
    outcome.reported.push({ lineId: c.lineId, kind: "short_shelf_life", ingredientName: c.ingredientName });
    emailIssues.push({
      kind: "short_shelf_life",
      productName: c.ingredientName,
      productCode: productCodeOf(c.ingredientId),
      quantityText: formatReportQty(c.quantityForReport, c.qty),
      useByDate: report.useByDate,
      days: report.check.days,
      minDays: report.check.minDays,
      decision: report.decision,
    });
  }

  for (const c of input.damage) {
    const report = damageReportFor({ quantityReceived: c.quantityReceived, damage: c.damage });
    if (!report) continue;
    const [row] = await db
      .insert(deliveryDamageReportsTable)
      .values({
        purchaseOrderId: input.purchaseOrderId,
        purchaseOrderLineId: c.lineId,
        supplierId: input.supplierId,
        ingredientId: c.ingredientId,
        ingredientName: c.ingredientName,
        quantity: String(report.quantity),
        unit: c.qty.unit,
        note: report.note,
        disposition: report.disposition,
        deliveryDate: input.deliveryDate,
        reportedById: input.actor.id,
        reportedByName: input.actor.name,
        photoIds: input.photoIds,
        photosConfirmed: input.photosConfirmed,
      })
      .onConflictDoNothing({ target: deliveryDamageReportsTable.purchaseOrderLineId })
      .returning({ id: deliveryDamageReportsTable.id });
    if (!row) { outcome.alreadyReported++; continue; }
    newDamageRows.push(row.id);
    outcome.reported.push({ lineId: c.lineId, kind: "damaged", ingredientName: c.ingredientName });
    emailIssues.push({
      kind: "damaged",
      productName: c.ingredientName,
      productCode: productCodeOf(c.ingredientId),
      quantityText: formatReportQty(report.quantity, c.qty),
      note: report.note,
      disposition: report.disposition,
    });
  }

  if (emailIssues.length === 0) return outcome;

  let status: IssueEmailStatus;
  let error: string | null = null;
  if (!recipientEmail) {
    status = "no_address";
  } else if (shouldSkipSideEffect()) {
    status = "skipped";
    error = "Outbound email is switched off in this environment";
    console.log(`[delivery-issue-report] email skipped (side effects off) for PO #${input.purchaseOrderId}`);
  } else if (!process.env["RESEND_API_KEY"]) {
    status = "failed";
    error = "No email provider configured (RESEND_API_KEY)";
  } else {
    try {
      const photos = input.photoIds.length
        ? await db
            .select({ id: deliveryIssuePhotosTable.id, mime: deliveryIssuePhotosTable.mime, data: deliveryIssuePhotosTable.data })
            .from(deliveryIssuePhotosTable)
            .where(inArray(deliveryIssuePhotosTable.id, input.photoIds))
        : [];
      const email = deliveryIssueReportEmail({
        supplierName,
        accountNumber: supplier?.accountNumber ?? null,
        recipientName,
        orderNumber: input.purchaseOrderId,
        deliveryDate: input.deliveryDate,
        issues: emailIssues,
        photoCount: photos.length,
        receivedByName: input.actor.name,
      });
      await sendEmail({
        to: recipientEmail,
        cc: [FOUNDER_EMAIL, ACCOUNTS_MAILBOX],
        replyTo: FOUNDER_EMAIL,
        fromName: "The Calzone Kitchen",
        fromEmail: FROM_EMAIL,
        subject: email.subject,
        text: email.text,
        html: email.html,
        attachments: photos.map((p, i) => ({
          filename: `order-${input.purchaseOrderId}-photo-${i + 1}.${p.mime === "image/png" ? "png" : "jpg"}`,
          content: Buffer.from(p.data).toString("base64"),
          contentType: p.mime,
        })),
      });
      status = "sent";
    } catch (err) {
      status = "failed";
      error = err instanceof Error ? err.message : String(err);
      console.error(`[delivery-issue-report] email failed for PO #${input.purchaseOrderId}:`, error);
    }
  }

  const emailFields = {
    emailStatus: status,
    emailError: error,
    emailedToName: recipientName,
    emailedTo: status === "sent" ? recipientEmail : null,
    emailedAt: status === "sent" ? new Date() : null,
  };
  if (newShelfLifeRows.length) {
    await db.update(deliveryShelfLifeReportsTable).set(emailFields).where(inArray(deliveryShelfLifeReportsTable.id, newShelfLifeRows));
  }
  if (newDamageRows.length) {
    await db.update(deliveryDamageReportsTable).set(emailFields).where(inArray(deliveryDamageReportsTable.id, newDamageRows));
  }
  outcome.emailStatus = status;
  outcome.emailError = error;
  return outcome;
}

/** The recorded issues for one delivery — the receive dialog shows them on
 *  an edit (and restores the decisions), with the photos and whether the
 *  email went. */
export async function deliveryIssuesForOrder(purchaseOrderId: number) {
  const [sl, dm, photos] = await Promise.all([
    db.select().from(deliveryShelfLifeReportsTable).where(eq(deliveryShelfLifeReportsTable.purchaseOrderId, purchaseOrderId)),
    db.select().from(deliveryDamageReportsTable).where(eq(deliveryDamageReportsTable.purchaseOrderId, purchaseOrderId)),
    db.select({ id: deliveryIssuePhotosTable.id }).from(deliveryIssuePhotosTable).where(eq(deliveryIssuePhotosTable.purchaseOrderId, purchaseOrderId)),
  ]);
  const existingPhotos = new Set(photos.map(p => p.id));
  const keep = (ids: number[] | null) => (ids ?? []).filter(id => existingPhotos.has(id));
  return {
    shelfLifeReports: sl.map(r => ({
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
      photoIds: keep(r.photoIds),
    })),
    damageReports: dm.map(r => ({
      lineId: r.purchaseOrderLineId,
      quantity: Number(r.quantity),
      unit: r.unit,
      note: r.note,
      disposition: r.disposition,
      reportedByName: r.reportedByName,
      reportedAt: r.reportedAt.toISOString(),
      emailStatus: r.emailStatus,
      emailError: r.emailError,
      emailedToName: r.emailedToName,
      emailedAt: r.emailedAt ? r.emailedAt.toISOString() : null,
      photoIds: keep(r.photoIds),
    })),
  };
}
