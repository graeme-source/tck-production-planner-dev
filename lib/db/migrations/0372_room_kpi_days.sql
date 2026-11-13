-- Packing & wrapping ROOM run rate (Graeme, 13 Nov 2026): one score for the
-- team's whole day. Raw counts per day — boxes packed, packs wrapped,
-- deliveries and their lines received, and the paid hours of the Planday
-- Packer + Wrapper shifts — so the score can be recomputed when a standard
-- changes (api lib/room-kpi.ts). Filled overnight by services/room-kpi-job.ts.
-- Objective G. Safe to run twice.

CREATE TABLE IF NOT EXISTS room_kpi_days (
  date DATE PRIMARY KEY,
  boxes INTEGER NOT NULL DEFAULT 0,
  packs INTEGER NOT NULL DEFAULT 0,
  deliveries INTEGER NOT NULL DEFAULT 0,
  delivery_lines INTEGER NOT NULL DEFAULT 0,
  paid_hours NUMERIC(7, 2) NOT NULL DEFAULT 0,
  people INTEGER NOT NULL DEFAULT 0,
  -- 'ok' | 'pending' (a room shift still waiting for approval in Planday)
  status TEXT NOT NULL DEFAULT 'ok',
  computed_at TIMESTAMP NOT NULL DEFAULT NOW()
);
