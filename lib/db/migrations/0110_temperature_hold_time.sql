-- Cook temperature checks can record HOW LONG the temperature was held
-- (Graeme, 2026-09-16). The UK FSA time/temperature equivalents make
-- 70°C for 2 minutes as safe as 75°C for 30 seconds — the mac cheese
-- sauce takes a long time to reach 75°C, so the station now records the
-- temperature achieved AND the hold time instead of chasing a fixed 75.
ALTER TABLE temperature_records ADD COLUMN IF NOT EXISTS held_for_seconds integer;
