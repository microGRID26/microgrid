-- 033: Add barcode field to warehouse_stock for barcode/QR scanning
ALTER TABLE warehouse_stock ADD COLUMN IF NOT EXISTS barcode TEXT;
CREATE INDEX IF NOT EXISTS idx_warehouse_stock_barcode ON warehouse_stock(barcode);
