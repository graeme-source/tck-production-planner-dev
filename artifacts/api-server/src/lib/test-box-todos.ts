/**
 * Test-box checklist ticks — the database side (rules: test-box-todo-rules.ts).
 *
 * SOURCE OF TRUTH: test_box_tasks.done (the tick), shown on the box page.
 *
 * Test boxes STOPPED putting their tasks on the owner's to-do list on
 * 2026-10-20 (Graeme: the to-dos they made were "carnage"). No to-do is
 * created, moved or removed from a box any more. To-dos made before then
 * are left as they are: still linked (test_box_tasks.todo_task_id), so
 *   - ticking on the box page → tickTestBoxTask() also sets an old linked
 *     to-do done/open;
 *   - ticking an old to-do on the to-do list → onTodoDoneChanged() (called
 *     from routes/todos.ts) still writes the tick.
 */
import { db, testBoxesTable, testBoxDeliveriesTable, testBoxTasksTable, usersTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { orderSubParent, type TestBoxSchedule } from "./test-box-schedule";
import { orderTickCascade } from "./test-box-todo-rules";
import type { Actor, DeliveryRow, Tx } from "./test-box-data";

/** Task keys that, ticked, close the delivery's orders (and unticked, reopen them). */
const CLOSE_ORDERS = /^d(\d+):close-orders$/;

async function addTimeline(tx: Tx, taskId: number, user: Actor | null, body: string) {
  await tx.execute(sql`
    INSERT INTO todo_task_comments (task_id, user_id, user_name, kind, body)
    VALUES (${taskId}, ${user?.id ?? null}, ${user?.name ?? "Test box"}, 'event', ${body})
  `);
}

/** Write a tick on the box and set its to-do to match. */
export async function tickTestBoxTask(tx: Tx, boxId: number, key: string, done: boolean, user: Actor) {
  const values = { done, doneById: done ? user.id : null, doneByName: done ? user.name : null, doneAt: done ? new Date() : null };
  const [row] = await tx.insert(testBoxTasksTable).values({ testBoxId: boxId, taskKey: key, ...values })
    .onConflictDoUpdate({ target: [testBoxTasksTable.testBoxId, testBoxTasksTable.taskKey], set: values })
    .returning();
  if (row.todoTaskId != null) {
    const r = await tx.execute<{ status: string }>(sql`SELECT status FROM todo_tasks WHERE id = ${row.todoTaskId}`);
    const current = r.rows[0]?.status;
    if (current && (current === "done") !== done) {
      await tx.execute(sql`
        UPDATE todo_tasks SET status = ${done ? "done" : "open"}, completed_at = ${done ? sql`NOW()` : null}, updated_at = NOW()
        WHERE id = ${row.todoTaskId}
      `);
      await addTimeline(tx, row.todoTaskId, user, done ? `${user.name} ticked this on the test box` : `${user.name} unticked this on the test box`);
    }
  }
  return row;
}

/**
 * Keep "Order the new ingredients for …" and its ingredient lines in step
 * after `key` was ticked (orderTickCascade has the rule). `schedule` must be
 * the box's current schedule; `doneKeys` the ticks BEFORE this one.
 */
export async function cascadeOrderTicks(
  tx: Tx, boxId: number, key: string, done: boolean, schedule: TestBoxSchedule, doneKeys: ReadonlySet<string>, user: Actor,
): Promise<void> {
  const parentKey = orderSubParent(key) ?? (/^d\d+:order-new$/.test(key) ? key : null);
  if (!parentKey) return;
  const parent = schedule.deliveries.flatMap(d => d.tasks).find(t => t.key === parentKey);
  const subKeys = parent?.subItems?.map(i => i.key) ?? [];
  for (const w of orderTickCascade({ key, done, parentKey, subKeys, doneKeys })) {
    await tickTestBoxTask(tx, boxId, w.key, w.done, user);
  }
}

/** Close (or reopen) a delivery's orders. Returns false if nothing changed. */
export async function setDeliveryClosed(tx: Tx, delivery: DeliveryRow, closed: boolean, user: Actor): Promise<boolean> {
  if (closed && delivery.status !== "open") return false;
  if (!closed && delivery.status !== "closed") return false;
  await tx.update(testBoxDeliveriesTable).set(closed
    ? { status: "closed", closedAt: new Date(), closedById: user.id, closedByName: user.name, updatedById: user.id, updatedByName: user.name, updatedAt: new Date() }
    : { status: "open", closedAt: null, closedById: null, closedByName: null, updatedById: user.id, updatedByName: user.name, updatedAt: new Date() },
  ).where(eq(testBoxDeliveriesTable.id, delivery.id));
  return true;
}

/**
 * A to-do linked to a test-box task was completed or reopened from the to-do
 * list (routes/todos.ts). Write the tick — the box's source of truth — and,
 * for "Close orders for …", close or reopen that delivery so its next steps
 * appear (closing also queues the production from sales — the same path as
 * the button on the box, test-box-production-data.ts). Never throws into the to-do route: a failure is logged and the
 * box re-derives the to-do on its next change.
 */
export async function onTodoDoneChanged(todoId: number, done: boolean, userId: number): Promise<void> {
  try {
    const [link] = await db.select().from(testBoxTasksTable).where(eq(testBoxTasksTable.todoTaskId, todoId));
    if (!link) return;
    const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
    const user = { id: userId, name: u?.name ?? "Someone" };
    const { loadDoneKeys, scheduleForBox, syncTestBox } = await import("./test-box-data");
    const { closeAndQueue, mirrorFromDate, refreshOrdersMirror, reopenDelivery } = await import("./test-box-production-data");
    const closing = CLOSE_ORDERS.test(link.taskKey) && done;
    if (closing) {
      // Closing queues the production from sales: fetch the newest orders first (read only).
      const [b0] = await db.select().from(testBoxesTable).where(eq(testBoxesTable.id, link.testBoxId));
      if (b0) await refreshOrdersMirror(mirrorFromDate(b0));
    }
    await db.transaction(async (tx) => {
      const [box] = await tx.select().from(testBoxesTable).where(eq(testBoxesTable.id, link.testBoxId)).for("update");
      if (!box || box.deletedAt) return;
      const before = new Set(await loadDoneKeys(tx, box.id));
      const values = { done, doneById: done ? user.id : null, doneByName: done ? user.name : null, doneAt: done ? new Date() : null };
      await tx.update(testBoxTasksTable).set(values).where(eq(testBoxTasksTable.id, link.id));
      await cascadeOrderTicks(tx, box.id, link.taskKey, done, await scheduleForBox(tx, box), before, user);
      const m = CLOSE_ORDERS.exec(link.taskKey);
      if (m) {
        const [delivery] = await tx.select().from(testBoxDeliveriesTable)
          .where(and(eq(testBoxDeliveriesTable.id, Number(m[1])), eq(testBoxDeliveriesTable.testBoxId, box.id)));
        // Closing queues the production from sales; reopening takes it off.
        if (delivery && !delivery.deletedAt) {
          if (done) await closeAndQueue(tx, box, delivery, user);
          else await reopenDelivery(tx, delivery, user);
        }
      }
      await syncTestBox(tx, box.id, user);
    });
  } catch (err) {
    console.error("[test-boxes] couldn't carry a to-do tick back to its test box:", err instanceof Error ? err.message : err);
  }
}
