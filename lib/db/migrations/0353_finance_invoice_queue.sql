-- Add an invoice once (Graeme, 4 Nov 2026). An invoice dropped on Outstanding
-- before its card transaction exists waits in a queue instead of being
-- forgotten in the library, and is matched when the transaction arrives.
-- awaiting_transaction_at = in the queue, since when. NULL = not queued: the
-- library's bulk uploads, many of them paid by bank and never on a card, stay
-- out of it. rejected_line_ids = transactions a person said it isn't, so
-- they're never put forward or auto-matched again.
ALTER TABLE fin_invoices ADD COLUMN IF NOT EXISTS awaiting_transaction_at TIMESTAMP;
ALTER TABLE fin_invoices ADD COLUMN IF NOT EXISTS rejected_line_ids INTEGER[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS fin_invoices_awaiting_transaction_idx
  ON fin_invoices (awaiting_transaction_at) WHERE awaiting_transaction_at IS NOT NULL;

-- Invoices already dropped on Outstanding and still unattached join the queue.
UPDATE fin_invoices i
   SET awaiting_transaction_at = e.created_at
  FROM fin_events e
 WHERE e.entity_type = 'invoice'
   AND e.entity_id = i.id
   AND e.action = 'uploaded'
   AND e.detail->>'via' = 'outstanding_find_transaction'
   AND i.line_id IS NULL
   AND i.duplicate_of_id IS NULL
   AND i.awaiting_transaction_at IS NULL;
