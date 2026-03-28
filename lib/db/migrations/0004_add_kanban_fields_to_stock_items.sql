-- Migration: Add kanban fields to stock_items table
-- Task #58: Kanban Excel data import & production push script

ALTER TABLE stock_items
  ADD COLUMN IF NOT EXISTS kanban_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS kanban_quantity numeric(10,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS kanban_unit text NOT NULL DEFAULT 'weight',
  ADD COLUMN IF NOT EXISTS kanban_order_amount numeric(10,4);
