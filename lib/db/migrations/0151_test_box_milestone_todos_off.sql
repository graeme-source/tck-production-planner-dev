-- Test boxes: milestone to-dos come off the owner's list now, not on the
-- box's next edit (Graeme, 2026-10-08: "way too many test-box to-dos are on
-- my list — Despatch day, Production day, Prep & dough day, ordering flour
-- from A D Maria… I don't need reminding of those"). Objective H.
--
-- From this release only the out-of-the-norm steps are to-dos
-- (becomesTodo in api-server/src/lib/test-box-schedule.ts). The box's sync
-- (syncTestBoxTodos) removes the others whenever a box changes; this does
-- the same one-off for every box straight away, with exactly the sync's
-- rule:
--   * only OPEN to-dos (a done one is history and stays);
--   * only the to-do a box task made (test_box_tasks.todo_task_id);
--   * only the delivery steps that are milestones now — ingredients in,
--     prep, production, despatch, delivery — plus every per-supplier order
--     step and "Queue the test production", which no longer exist;
--   * the tick rows on the box (done / who / when) are kept; only the link
--     to the removed to-do is cleared.
-- todo_tasks has no soft delete (its comments/attachments cascade), the
-- same as the sync's own removal.

WITH gone AS (
  SELECT t.id AS link_id, t.todo_task_id
  FROM test_box_tasks t
  JOIN todo_tasks tt ON tt.id = t.todo_task_id
  WHERE tt.status = 'open'
    AND t.task_key ~ '^d[0-9]+:(ingredients-in|prep|production|despatch|delivery|queue-production|order-supplier-.+)$'
),
unlinked AS (
  UPDATE test_box_tasks SET todo_task_id = NULL WHERE id IN (SELECT link_id FROM gone) RETURNING id
)
DELETE FROM todo_tasks WHERE id IN (SELECT todo_task_id FROM gone) AND status = 'open';
