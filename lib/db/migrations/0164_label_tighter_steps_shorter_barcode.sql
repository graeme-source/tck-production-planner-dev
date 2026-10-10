-- Pack label tweaks (Graeme, 2026-10-12), applied to the SAVED label template
-- only where each value is still a shipped default (a deliberate setting is
-- left alone):
--   * steps band 13 mm → 9 mm: room for exactly two lines, so step 1 sits on
--     two lines instead of three and the space goes to the columns below.
--   * barcode bars → 15 mm (from any earlier default: 11, 18.5 or 21 mm);
--     under GS1's recommended 18.3 mm — fine for handheld scanners, and
--     Label settings says so.
--   * barcode width 126% → 151% (whole 4-dot modules), the width Graeme
--     chose on 2026-10-10, where a template still holds the older default.
-- The fixed-first-half cooking times need no migration — they're computed.
-- Every live label then shows "Label update needed" until checked and
-- updated; the live snapshots themselves are not touched.

UPDATE product_label_templates
SET settings = jsonb_set(settings, '{page,stepsBandMm}', '9'::jsonb),
    version = version + 1, updated_at = NOW(),
    updated_by_name = 'Label tweaks (migration 0164)'
WHERE (settings->'page'->>'stepsBandMm')::numeric = 13;

UPDATE product_label_templates
SET settings = jsonb_set(settings, '{page,barcodeHeightMm}', '15'::jsonb),
    version = version + 1, updated_at = NOW(),
    updated_by_name = 'Label tweaks (migration 0164)'
WHERE (settings->'page'->>'barcodeHeightMm')::numeric IN (11, 18.5, 21);

UPDATE product_label_templates
SET settings = jsonb_set(settings, '{page,barcodeSizePct}', '151'::jsonb),
    version = version + 1, updated_at = NOW(),
    updated_by_name = 'Label tweaks (migration 0164)'
WHERE (settings->'page'->>'barcodeSizePct')::numeric = 126;
