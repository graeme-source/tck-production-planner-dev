-- Paid / Unpaid starts unset (Graeme, 10 Nov 2026): an invoice only says Paid
-- or Unpaid when someone pressed one of those buttons, so the bookkeeper is
-- never told "paid" by a default. Objective I. Reverses 0361's default.
--
-- Invoices that say 'paid' only because of that default (no 'edited' event
-- changing paymentStatus) go back to unset. 14 on live when written; the 4
-- that someone set to Paid, and every Unpaid, are kept. Safe to run twice.

ALTER TABLE fin_invoices ALTER COLUMN payment_status DROP DEFAULT;

UPDATE fin_invoices i
   SET payment_status = NULL
 WHERE i.payment_status = 'paid'
   AND NOT EXISTS (
     SELECT 1 FROM fin_events e
      WHERE e.entity_type = 'invoice' AND e.entity_id = i.id AND e.action = 'edited'
        AND e.detail -> 'changes' ? 'paymentStatus'
   );
