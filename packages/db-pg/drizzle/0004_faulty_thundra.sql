CREATE INDEX IF NOT EXISTS "idx_customers_live_name" ON "customers" USING btree ("is_deleted","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_products_live" ON "products" USING btree ("is_deleted","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_products_name" ON "products" USING btree ("name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_products_category" ON "products" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_products_updated" ON "products" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sale_items_sale" ON "sale_items" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sale_items_product" ON "sale_items" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sales_status_created" ON "sales" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sales_created" ON "sales" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sales_held_key" ON "sales" USING btree ("held_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sales_customer" ON "sales" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sales_cashier" ON "sales" USING btree ("cashier_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_inventory_product_created" ON "inventory_movements" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_inventory_reference" ON "inventory_movements" USING btree ("reference_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_stocktake_items_session" ON "stocktake_items" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_expenses_status_created" ON "expenses" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_return_items_return" ON "return_items" USING btree ("return_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_return_items_product" ON "return_items" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_return_items_sale_item" ON "return_items" USING btree ("sale_item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_returns_sale" ON "returns" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_returns_created" ON "returns" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_shifts_status" ON "shifts" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_shifts_cashier" ON "shifts" USING btree ("cashier_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audit_logs_created" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audit_logs_module_created" ON "audit_logs" USING btree ("module","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_grn_headers_status_created" ON "grn_headers" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_grn_headers_vendor" ON "grn_headers" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_grn_lines_grn" ON "grn_lines" USING btree ("grn_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_grn_lines_product" ON "grn_lines" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_product_cost_history_product" ON "product_cost_history" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_product_cost_history_source" ON "product_cost_history" USING btree ("source_id");--> statement-breakpoint
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE INDEX IF NOT EXISTS "idx_products_name_trgm" ON "products" USING gin ("name" gin_trgm_ops);
EXCEPTION WHEN insufficient_privilege OR undefined_file OR feature_not_supported THEN
  RAISE NOTICE 'pg_trgm unavailable - skipping trigram index on products.name';
END $$;
