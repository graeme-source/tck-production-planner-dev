-- The packing scan box has refused typed SKUs and names since 13 Oct 2026
-- ("typed-not-scanned", 42919fbd4), but this table's CHECK constraint was
-- never widened, so every one of those refusals failed to save (seen in the
-- live log 28 Oct 2026: Dave scanning an APC label into the item box).
-- Packing itself was unaffected; only the record was lost. Objective B.

ALTER TABLE packing_scan_rejections DROP CONSTRAINT IF EXISTS packing_scan_rejections_kind;
ALTER TABLE packing_scan_rejections ADD CONSTRAINT packing_scan_rejections_kind
  CHECK (kind IN ('wrong-item', 'ambiguous', 'unknown-barcode', 'typed-not-scanned', 'no-match', 'already-picked'));
