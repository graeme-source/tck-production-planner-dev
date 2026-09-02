-- Packing opening check now verifies dispatchability as the first batch
-- number is recorded (Graeme, 2026-09-02): the batch number gives the
-- made-on date, the recipe's shelf life gives the use-by, and the
-- configurable min-days-at-customer rule decides whether it can go out
-- today. The verdict is stored with the record for the HACCP trail.
ALTER TABLE packing_batch_records ADD COLUMN IF NOT EXISTS first_use_by_date DATE;
ALTER TABLE packing_batch_records ADD COLUMN IF NOT EXISTS first_shelf_life_ok BOOLEAN;
