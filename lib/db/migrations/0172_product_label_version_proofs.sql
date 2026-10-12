-- Label history keeps the exact picture (Graeme, 2026-10-12). Objective D
-- (traceable, lawful labels).
--
-- product_label_versions.proof_png — the label exactly as it went live: the
--   1-bit PNG the renderer drew at publish (dated the publish day), the same
--   bitmap the back-label print route sends to the printer. The History tab
--   and its archive PDF show THIS, so later layout-code changes can never
--   alter what an old version looks like. NULL for versions published before
--   this column existed until scripts/backfill-label-version-proofs.ts fills
--   them; until then the history re-draws them from the saved snapshot and
--   says so.
-- product_label_versions.proof_dpi — the printer resolution that PNG was
--   drawn at (one pixel = one printer dot), for sizing the archive PDF.
ALTER TABLE product_label_versions
  ADD COLUMN IF NOT EXISTS proof_png BYTEA,
  ADD COLUMN IF NOT EXISTS proof_dpi INTEGER;
