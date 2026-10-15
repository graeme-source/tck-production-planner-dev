/**
 * Short-delivery reports — the database half (Graeme, 2026-10-15).
 * Objectives C (stock stays right) and D (goods-in checks every time).
 *
 * "If we're short of anything we ordered, or something wasn't delivered that
 * should have been, send a message to the Production Flow Manager checklist —
 * 'Today this wasn't delivered. That was ordered.' … We need to know as soon
 * as possible." Called by POST /api/deliveries/:id/receive after the receipt
 * is saved (first goods-in and every later quantity edit).
 *
 *   - Team list: a one-off item ({kind:"once"}, P1, carries over until
 *     ticked) on the list named by app_settings short_delivery_team_list_id
 *     (seeded by migration 0196 to the Production Flow Manager list).
 *   - People: a to-do + bell for each recipient (the "Also tell…" picker at
 *     goods-in, pre-filled from short_delivery_recipient_ids). The person
 *     completing goods-in never gets a bell for their own report.
 *   - One report per delivery (short_delivery_reports): re-saving the same
 *     shortfall sends nothing; an edit that changes it updates the list item
 *     in place if it's still open (or adds a follow-up if it was ticked) and
 *     gives recipients an "Update —" to-do; an edit that makes everything
 *     received updates the open list item and tells nobody.
 *   - Nothing leaves the app: no email, no Shopify, no supplier message.
 *
 * The decisions (what's short, the wording, who's told) are pure and tested
 * in lib/goods-in.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db, purchaseOrdersTable, purchaseOrderLinesTable, suppliersTable, ingredientsTable,
  teamListsTable, teamListItemsTable, teamListCompletionsTable, shortDeliveryReportsTable, usersTable,
} from "@workspace/db";
import {
  newlyAdded, reportAction, reportRecipients, shortLinesOf, shortReportText, shortSignature,
  type ReportLineInput,
} from "@workspace/goods-in";
import { londonDateString } from "./london-time";

export const SHORT_REPORT_LIST_KEY = "short_delivery_team_list_id";
export const SHORT_REPORT_PEOPLE_KEY = "short_delivery_recipient_ids";

export interface ShortReportSettings {
  teamListId: number | null;
  recipientIds: number[];
}

/** Parse the stored settings; anything unreadable counts as unset. */
export function parseShortReportSettings(listValue: string | null | undefined, peopleValue: string | null | undefined): ShortReportSettings {
  const listId = Number(listValue);
  let ids: number[] = [];
  try {
    const parsed = JSON.parse(peopleValue ?? "[]");
    if (Array.isArray(parsed)) ids = parsed.map(Number).filter(n => Number.isInteger(n) && n > 0);
  } catch { /* unreadable → none */ }
  return { teamListId: Number.isInteger(listId) && listId > 0 ? listId : null, recipientIds: [...new Set(ids)] };
}

export async function readShortReportSettings(): Promise<ShortReportSettings> {
  const r = await db.execute<{ key: string; value: string }>(sql`
    SELECT key, value FROM app_settings WHERE key IN (${SHORT_REPORT_LIST_KEY}, ${SHORT_REPORT_PEOPLE_KEY})
  `);
  const byKey = new Map(r.rows.map(row => [row.key, row.value]));
  return parseShortReportSettings(byKey.get(SHORT_REPORT_LIST_KEY), byKey.get(SHORT_REPORT_PEOPLE_KEY));
}

export async function writeShortReportSettings(s: ShortReportSettings): Promise<void> {
  const people = JSON.stringify([...new Set(s.recipientIds)]);
  const list = s.teamListId == null ? "" : String(s.teamListId);
  await db.execute(sql`
    INSERT INTO app_settings (key, value, updated_at) VALUES
      (${SHORT_REPORT_LIST_KEY}, ${list}, NOW()),
      (${SHORT_REPORT_PEOPLE_KEY}, ${people}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `);
}

export interface ShortReportOutcome {
  /** none | created | same | updated | resolved */
  action: "none" | "created" | "same" | "updated" | "resolved";
  /** Lines reported short / not received. */
  shortCount: number;
  /** The team list the report went on, if any. */
  teamList: { id: number; name: string } | null;
  /** People given a to-do this time. */
  told: Array<{ id: number; name: string }>;
  /** Set when the list setting points nowhere usable — the screen says so. */
  warning?: string;
}

const londonTime = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const londonDay = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short" });

/**
 * Make (or follow up) the short-delivery report for a delivery that has just
 * been received or edited. `chosen` = the "Also tell…" people picked at
 * goods-in; undefined when the screen didn't ask (an older cached screen).
 */
export async function sendShortDeliveryReport(args: {
  purchaseOrderId: number;
  actor: { id: number | null; name: string | null };
  note?: string | null;
  chosen?: number[] | null;
}): Promise<ShortReportOutcome> {
  const { purchaseOrderId: poId, actor } = args;

  const [order] = await db
    .select({ id: purchaseOrdersTable.id, supplierName: suppliersTable.name, expectedDeliveryDate: purchaseOrdersTable.expectedDeliveryDate })
    .from(purchaseOrdersTable)
    .innerJoin(suppliersTable, eq(purchaseOrdersTable.supplierId, suppliersTable.id))
    .where(eq(purchaseOrdersTable.id, poId));
  if (!order) return { action: "none", shortCount: 0, teamList: null, told: [] };

  const lineRows = await db
    .select({
      id: purchaseOrderLinesTable.id,
      ingredientName: ingredientsTable.name,
      description: purchaseOrderLinesTable.description,
      quantityOrdered: purchaseOrderLinesTable.quantityOrdered,
      quantityReceived: purchaseOrderLinesTable.quantityReceived,
      unit: purchaseOrderLinesTable.unit,
      nativeUnit: ingredientsTable.unit,
      packWeight: ingredientsTable.packWeight,
      stockInPacks: ingredientsTable.stockInPacks,
    })
    .from(purchaseOrderLinesTable)
    .leftJoin(ingredientsTable, eq(purchaseOrderLinesTable.ingredientId, ingredientsTable.id))
    .where(eq(purchaseOrderLinesTable.purchaseOrderId, poId))
    .orderBy(purchaseOrderLinesTable.id);

  // Stored quantities are already the effective ones: the receive route
  // saves an un-ticked line as 0 before calling this.
  const reportLines: ReportLineInput[] = lineRows.map(l => ({
    lineId: l.id,
    name: l.ingredientName ?? l.description ?? "Miscellaneous item",
    quantityOrdered: Number(l.quantityOrdered),
    quantityReceived: Number(l.quantityReceived),
    unit: l.unit,
    nativeUnit: l.nativeUnit,
    packWeight: l.packWeight,
    stockInPacks: l.stockInPacks,
  }));
  const short = shortLinesOf(reportLines);

  const [previous] = await db.select().from(shortDeliveryReportsTable).where(eq(shortDeliveryReportsTable.purchaseOrderId, poId));
  const action = reportAction(previous ? previous.signature : null, short);
  if (action.kind === "none") return { action: "none", shortCount: 0, teamList: null, told: [] };

  const settings = await readShortReportSettings();
  const recipients = reportRecipients({
    configured: settings.recipientIds,
    chosen: args.chosen ?? undefined,
    previous: previous?.recipientIds ?? [],
    senderId: actor.id,
  });
  const toTellIds =
    action.kind === "create" ? recipients.all
    : action.kind === "same" ? newlyAdded(recipients.all, previous?.recipientIds)
    : action.resolved ? []
    : recipients.all;

  // Only people still on the team.
  const people = toTellIds.length
    ? await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable)
        .where(and(inArray(usersTable.id, toTellIds), eq(usersTable.isActive, true)))
    : [];
  const told = toTellIds.map(id => people.find(p => p.id === id)).filter((p): p is { id: number; name: string } => !!p);

  const now = new Date();
  const today = londonDateString(now);
  const text = shortReportText(short, {
    supplierName: order.supplierName,
    purchaseOrderId: poId,
    receivedByName: actor.name,
    receivedTime: londonTime.format(now),
    receivedDay: londonDay.format(now).replace(",", ""),
    note: args.note,
    update: action.kind === "changed",
  });
  const url = `/deliveries?date=${order.expectedDeliveryDate ?? today}`;

  // The team list, when the setting points at a live one.
  let list: { id: number; name: string } | null = null;
  let warning: string | undefined;
  if (settings.teamListId != null) {
    const [l] = await db.select({ id: teamListsTable.id, name: teamListsTable.name, archivedAt: teamListsTable.archivedAt })
      .from(teamListsTable).where(eq(teamListsTable.id, settings.teamListId));
    if (l && !l.archivedAt) list = { id: l.id, name: l.name };
    else warning = "The team list chosen for short-delivery reports no longer exists — choose one in Deliveries → Short-delivery reports.";
  } else {
    warning = "No team list is chosen for short-delivery reports — choose one in Deliveries → Short-delivery reports.";
  }

  let listUsed: { id: number; name: string } | null = null;
  await db.transaction(async tx => {
    // ── Team list item ──
    let itemId = previous?.teamListItemId ?? null;
    let itemListId = previous?.teamListId ?? null;
    if (action.kind !== "same") {
      // Is the current report item still open (not ticked or skipped)?
      let openItem = false;
      if (itemId != null) {
        const [item] = await tx.select({ id: teamListItemsTable.id, active: teamListItemsTable.active })
          .from(teamListItemsTable).where(eq(teamListItemsTable.id, itemId));
        const [closed] = item
          ? await tx.select({ id: teamListCompletionsTable.id }).from(teamListCompletionsTable).where(eq(teamListCompletionsTable.itemId, item.id)).limit(1)
          : [];
        openItem = !!item && item.active && !closed;
      }
      if (openItem && itemId != null) {
        // Rewrite it in place, as today's — one item per delivery on the list.
        await tx.update(teamListItemsTable).set({
          title: text.title.slice(0, 300), notes: text.notes.slice(0, 4000), url,
          recurrence: { kind: "once", date: today }, startDate: today, updatedAt: now,
        }).where(eq(teamListItemsTable.id, itemId));
        if (itemListId != null) {
          const [l] = await tx.select({ id: teamListsTable.id, name: teamListsTable.name }).from(teamListsTable).where(eq(teamListsTable.id, itemListId));
          listUsed = l ?? null;
        }
      } else if (list && !(action.kind === "changed" && action.resolved)) {
        const [row] = await tx.insert(teamListItemsTable).values({
          listId: list.id,
          title: text.title.slice(0, 300),
          notes: text.notes.slice(0, 4000),
          url,
          priority: 1,
          recurrence: { kind: "once", date: today },
          timeOfDay: null,
          carryOver: true,
          startDate: today,
          sortOrder: 0,
          createdById: actor.id,
        }).returning({ id: teamListItemsTable.id });
        itemId = row.id;
        itemListId = list.id;
        listUsed = list;
      }
    }

    // ── People ──
    for (const p of told) {
      const rows = await tx.execute<{ id: number }>(sql`
        INSERT INTO todo_tasks (assignee_id, created_by, created_by_name, title, notes, url, priority, due_date)
        VALUES (${p.id}, ${actor.id}, ${actor.name}, ${text.title.slice(0, 300)}, ${text.notes.slice(0, 5000)}, ${url}, 'high', ${today})
        RETURNING id
      `);
      const todoId = Number(rows.rows[0]!.id);
      await tx.execute(sql`
        INSERT INTO todo_task_comments (task_id, user_id, user_name, kind, body)
        VALUES (${todoId}, ${actor.id}, ${actor.name}, 'event', ${"Sent from goods-in on the Deliveries page"})
      `);
    }

    const recipientIds = [...new Set([...(previous?.recipientIds ?? []), ...told.map(p => p.id)])];
    if (previous) {
      await tx.update(shortDeliveryReportsTable).set({
        signature: shortSignature(short), teamListId: itemListId, teamListItemId: itemId, recipientIds, updatedAt: now,
      }).where(eq(shortDeliveryReportsTable.id, previous.id));
    } else {
      await tx.insert(shortDeliveryReportsTable).values({
        purchaseOrderId: poId, signature: shortSignature(short), teamListId: itemListId, teamListItemId: itemId,
        recipientIds, createdById: actor.id,
      });
    }
  });

  // Bells after the commit; a missed bell never undoes the report.
  for (const p of told) {
    if (!recipients.bells.includes(p.id)) continue;
    try {
      await db.execute(sql`
        INSERT INTO notifications (user_id, type, message, read)
        VALUES (${p.id}, ${"todo"}, ${`${actor.name ?? "Goods-in"}: ${text.title}`.slice(0, 500)}, false)
      `);
    } catch (err) {
      console.warn("[short-delivery] notification failed:", err instanceof Error ? err.message : err);
    }
  }

  return {
    action: action.kind === "create" ? "created" : action.kind === "same" ? "same" : action.resolved ? "resolved" : "updated",
    shortCount: short.length,
    teamList: listUsed,
    told,
    ...(warning && !listUsed && action.kind !== "same" ? { warning } : {}),
  };
}
