-- Migration 062: PO delivery accuracy tracking (Zach/Marlie feedback)
-- Adds delivery accuracy flag and notes for tracking vendor performance

ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS delivery_accurate BOOLEAN;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS delivery_discrepancy TEXT;

-- Cycle time is computed: delivered_at - submitted_at (no column needed)
-- Vendor performance view
CREATE OR REPLACE VIEW vendor_po_performance AS
SELECT
  vendor,
  COUNT(*) AS total_pos,
  COUNT(*) FILTER (WHERE status = 'delivered') AS delivered_pos,
  COUNT(*) FILTER (WHERE delivery_accurate = true) AS accurate_deliveries,
  COUNT(*) FILTER (WHERE delivery_accurate = false) AS inaccurate_deliveries,
  ROUND(AVG(
    CASE WHEN delivered_at IS NOT NULL AND submitted_at IS NOT NULL
    THEN EXTRACT(EPOCH FROM (delivered_at::timestamptz - submitted_at::timestamptz)) / 86400
    END
  )::numeric, 1) AS avg_cycle_days,
  ROUND(
    CASE WHEN COUNT(*) FILTER (WHERE delivery_accurate IS NOT NULL) > 0
    THEN COUNT(*) FILTER (WHERE delivery_accurate = true)::numeric /
         COUNT(*) FILTER (WHERE delivery_accurate IS NOT NULL)::numeric * 100
    END
  , 1) AS accuracy_pct
FROM purchase_orders
WHERE vendor IS NOT NULL
GROUP BY vendor;
