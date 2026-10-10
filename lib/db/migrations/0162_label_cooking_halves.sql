-- Pack label cooking steps: turning over made impossible to miss (Graeme,
-- 2026-10-11). Customers set the full time and burnt the tops — the turn was
-- only in step 3, which read like "serve". New wording:
--   2. one line per appliance: cook → TURN OVER → cook, the time halved
--   3. "Check they're piping hot throughout before serving."
--
-- The label template stores its wording (product_label_templates.settings),
-- so the new defaults in lib/product-labels/src/template.ts don't reach a
-- template that has already been saved. This moves the stored wording over
-- — ONLY where it is still the previous default word for word, so anything
-- someone has deliberately reworded is left alone. Every live label then
-- shows "Label update needed" until it's checked and updated (expected:
-- the printed text changes). Live labels themselves are frozen snapshots
-- and are not touched. A template never saved ('{}') already uses the new
-- defaults.

UPDATE product_label_templates
SET settings = jsonb_set(
      settings, '{text,step2}',
      to_jsonb(
        $t$[**OVEN** {ovenTemp}°C[ ({fanTemp}°C fan)]: {ovenHalfMin}–{ovenHalfMax} min ➜ **TURN OVER** ➜ {ovenHalf2Min}–{ovenHalf2Max} min]$t$
        || chr(10) ||
        $t$[**AIR FRYER** {airTemp}°C: {airHalfMin}–{airHalfMax} min ➜ **TURN OVER** ➜ {airHalf2Min}–{airHalf2Max} min]$t$
      )),
    version = version + 1,
    updated_at = NOW(),
    updated_by_name = 'Cooking steps update (migration 0162)'
WHERE settings->'text'->>'step2'
  = $t$Cook[ in the oven at {ovenTemp}°C[ ({fanTemp}°C fan)] for {ovenMin}–{ovenMax} minutes]{or}[ in the air fryer at {airTemp}°C for {airMin}–{airMax} minutes].$t$;

UPDATE product_label_templates
SET settings = jsonb_set(settings, '{text,step3}', to_jsonb($t$Check they're piping hot throughout before serving.$t$::text)),
    version = version + 1,
    updated_at = NOW(),
    updated_by_name = 'Cooking steps update (migration 0162)'
WHERE settings->'text'->>'step3'
  = $t$Turn the calzones over halfway through, and make sure they're piping hot throughout.$t$;
