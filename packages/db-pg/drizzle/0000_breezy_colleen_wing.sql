CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"username" text,
	"password_hash" text,
	"pin_hash" text,
	"role" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"failed_login_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" text,
	"device_id" text DEFAULT 'local' NOT NULL,
	"branch_id" text DEFAULT 'main' NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"scope" text DEFAULT 'global' NOT NULL,
	"device_id" text DEFAULT 'local' NOT NULL,
	"branch_id" text DEFAULT 'main' NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"logo_path" text,
	"country" text,
	"device_id" text DEFAULT 'local' NOT NULL,
	"branch_id" text DEFAULT 'main' NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"parent_id" text,
	"color" text,
	"sku_prefix" text,
	"device_id" text DEFAULT 'local' NOT NULL,
	"branch_id" text DEFAULT 'main' NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"address" text,
	"notes" text,
	"loyalty_points" integer DEFAULT 0 NOT NULL,
	"total_spent" double precision DEFAULT 0 NOT NULL,
	"visit_count" integer DEFAULT 0 NOT NULL,
	"birthday" text,
	"segment" text DEFAULT 'new',
	"device_id" text DEFAULT 'local' NOT NULL,
	"branch_id" text DEFAULT 'main' NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "customers_phone_unique" UNIQUE("phone"),
	CONSTRAINT "customers_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "label_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"width_mm" double precision NOT NULL,
	"height_mm" double precision NOT NULL,
	"layout_json" text NOT NULL,
	"roll_config_json" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"device_id" text DEFAULT 'local' NOT NULL,
	"branch_id" text DEFAULT 'main' NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loyalty_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"spend_threshold" double precision NOT NULL,
	"points_awarded" integer NOT NULL,
	"redemption_rate" double precision NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"device_id" text DEFAULT 'local' NOT NULL,
	"branch_id" text DEFAULT 'main' NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sku" text NOT NULL,
	"barcode" text NOT NULL,
	"category_id" text,
	"brand_id" text,
	"vendor_id" text,
	"parent_id" text,
	"cost_price" double precision DEFAULT 0 NOT NULL,
	"retail_price" double precision DEFAULT 0 NOT NULL,
	"sale_price" double precision,
	"tax_rate" double precision DEFAULT 0 NOT NULL,
	"stock_qty" integer DEFAULT 0 NOT NULL,
	"reorder_level" integer DEFAULT 0 NOT NULL,
	"reorder_qty" integer DEFAULT 0 NOT NULL,
	"expiry_date" text,
	"weight_grams" integer,
	"image_path" text,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"device_id" text DEFAULT 'local' NOT NULL,
	"branch_id" text DEFAULT 'main' NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "products_sku_unique" UNIQUE("sku"),
	CONSTRAINT "products_barcode_unique" UNIQUE("barcode")
);
--> statement-breakpoint
CREATE TABLE "promotions" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"value" double precision NOT NULL,
	"start_date" text,
	"end_date" text,
	"min_purchase" double precision,
	"product_ids" text,
	"category_ids" text,
	"is_stackable" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"device_id" text DEFAULT 'local' NOT NULL,
	"branch_id" text DEFAULT 'main' NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipt_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"header_json" text NOT NULL,
	"footer_json" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"device_id" text DEFAULT 'local' NOT NULL,
	"branch_id" text DEFAULT 'main' NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"contact" text,
	"email" text,
	"address" text,
	"payment_terms" text,
	"preferred_payment_type" text DEFAULT 'cash',
	"outstanding_balance" double precision DEFAULT 0 NOT NULL,
	"device_id" text DEFAULT 'local' NOT NULL,
	"branch_id" text DEFAULT 'main' NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sale_items" (
	"id" text PRIMARY KEY NOT NULL,
	"sale_id" text NOT NULL,
	"product_id" text NOT NULL,
	"product_name" text NOT NULL,
	"product_sku" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" double precision NOT NULL,
	"discount_percent" double precision DEFAULT 0 NOT NULL,
	"tax_rate" double precision DEFAULT 0 NOT NULL,
	"line_total" double precision NOT NULL,
	"device_id" text DEFAULT 'local' NOT NULL,
	"branch_id" text DEFAULT 'main' NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" text PRIMARY KEY NOT NULL,
	"sale_number" text NOT NULL,
	"cashier_id" text NOT NULL,
	"customer_id" text,
	"subtotal" double precision DEFAULT 0 NOT NULL,
	"discount_amount" double precision DEFAULT 0 NOT NULL,
	"discount_reason" text,
	"tax_amount" double precision DEFAULT 0 NOT NULL,
	"total_amount" double precision DEFAULT 0 NOT NULL,
	"payment_method" text NOT NULL,
	"amount_tendered" double precision,
	"change_given" double precision,
	"status" text DEFAULT 'completed' NOT NULL,
	"held_key" text,
	"notes" text,
	"receipt_printed" boolean DEFAULT false NOT NULL,
	"synced_at" text,
	"device_id" text DEFAULT 'local' NOT NULL,
	"branch_id" text DEFAULT 'main' NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "sales_sale_number_unique" UNIQUE("sale_number")
);
--> statement-breakpoint
CREATE TABLE "damaged_stock" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"qty" integer NOT NULL,
	"reason" text NOT NULL,
	"approved_by" text,
	"disposal_method" text,
	"device_id" text DEFAULT 'local' NOT NULL,
	"branch_id" text DEFAULT 'main' NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_movements" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"type" text NOT NULL,
	"qty_change" integer NOT NULL,
	"reference_id" text,
	"notes" text,
	"device_id" text DEFAULT 'local' NOT NULL,
	"branch_id" text DEFAULT 'main' NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_adjustments" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"qty_before" integer NOT NULL,
	"qty_after" integer NOT NULL,
	"reason" text NOT NULL,
	"approved_by" text,
	"notes" text,
	"device_id" text DEFAULT 'local' NOT NULL,
	"branch_id" text DEFAULT 'main' NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stocktake_items" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"product_id" text NOT NULL,
	"system_qty" integer NOT NULL,
	"counted_qty" integer,
	"device_id" text DEFAULT 'local' NOT NULL,
	"branch_id" text DEFAULT 'main' NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stocktake_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"started_by" text NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"notes" text,
	"completed_at" text,
	"device_id" text DEFAULT 'local' NOT NULL,
	"branch_id" text DEFAULT 'main' NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cash_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"cashier_id" text NOT NULL,
	"shift_id" text,
	"opening_float" double precision DEFAULT 0 NOT NULL,
	"closing_float" double precision,
	"expected_cash" double precision,
	"difference" double precision,
	"status" text DEFAULT 'open' NOT NULL,
	"closed_at" text,
	"device_id" text DEFAULT 'local' NOT NULL,
	"branch_id" text DEFAULT 'main' NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"device_id" text DEFAULT 'local' NOT NULL,
	"branch_id" text DEFAULT 'main' NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" text PRIMARY KEY NOT NULL,
	"category_id" text NOT NULL,
	"amount" double precision NOT NULL,
	"paid_by" text NOT NULL,
	"notes" text,
	"receipt_path" text,
	"shift_id" text,
	"approved_by" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"device_id" text DEFAULT 'local' NOT NULL,
	"branch_id" text DEFAULT 'main' NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gift_cards" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"initial_balance" double precision NOT NULL,
	"current_balance" double precision NOT NULL,
	"issued_by" text,
	"customer_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" text,
	"device_id" text DEFAULT 'local' NOT NULL,
	"branch_id" text DEFAULT 'main' NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "gift_cards_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "po_items" (
	"id" text PRIMARY KEY NOT NULL,
	"po_id" text NOT NULL,
	"product_id" text NOT NULL,
	"qty_ordered" integer NOT NULL,
	"qty_received" integer DEFAULT 0 NOT NULL,
	"unit_cost" double precision NOT NULL,
	"device_id" text DEFAULT 'local' NOT NULL,
	"branch_id" text DEFAULT 'main' NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"po_number" text NOT NULL,
	"vendor_id" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"total_cost" double precision DEFAULT 0 NOT NULL,
	"notes" text,
	"received_at" text,
	"device_id" text DEFAULT 'local' NOT NULL,
	"branch_id" text DEFAULT 'main' NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "purchase_orders_po_number_unique" UNIQUE("po_number")
);
--> statement-breakpoint
CREATE TABLE "return_items" (
	"id" text PRIMARY KEY NOT NULL,
	"return_id" text NOT NULL,
	"sale_item_id" text NOT NULL,
	"product_id" text NOT NULL,
	"qty_returned" integer NOT NULL,
	"restocked" boolean DEFAULT true NOT NULL,
	"unit_refund" double precision NOT NULL,
	"device_id" text DEFAULT 'local' NOT NULL,
	"branch_id" text DEFAULT 'main' NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "returns" (
	"id" text PRIMARY KEY NOT NULL,
	"return_number" text NOT NULL,
	"sale_id" text NOT NULL,
	"reason" text NOT NULL,
	"refund_method" text NOT NULL,
	"status" text DEFAULT 'completed' NOT NULL,
	"total_refund" double precision DEFAULT 0 NOT NULL,
	"processed_by" text NOT NULL,
	"device_id" text DEFAULT 'local' NOT NULL,
	"branch_id" text DEFAULT 'main' NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "returns_return_number_unique" UNIQUE("return_number")
);
--> statement-breakpoint
CREATE TABLE "shifts" (
	"id" text PRIMARY KEY NOT NULL,
	"cashier_id" text NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text,
	"opening_float" double precision DEFAULT 0 NOT NULL,
	"closing_float" double precision,
	"status" text DEFAULT 'open' NOT NULL,
	"device_id" text DEFAULT 'local' NOT NULL,
	"branch_id" text DEFAULT 'main' NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"module" text NOT NULL,
	"action" text NOT NULL,
	"record_id" text,
	"old_value" text,
	"new_value" text,
	"ip" text,
	"device_id" text DEFAULT 'local' NOT NULL,
	"branch_id" text DEFAULT 'main' NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_queue" (
	"id" text PRIMARY KEY NOT NULL,
	"table_name" text NOT NULL,
	"record_id" text NOT NULL,
	"operation" text NOT NULL,
	"payload" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"device_id" text DEFAULT 'local' NOT NULL,
	"branch_id" text DEFAULT 'main' NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eod_closings" (
	"id" text PRIMARY KEY NOT NULL,
	"closing_date" text NOT NULL,
	"total_sales" double precision DEFAULT 0 NOT NULL,
	"transaction_count" integer DEFAULT 0 NOT NULL,
	"returns_total" double precision DEFAULT 0 NOT NULL,
	"expenses_total" double precision DEFAULT 0 NOT NULL,
	"cash_collected" double precision DEFAULT 0 NOT NULL,
	"opening_float" double precision DEFAULT 0 NOT NULL,
	"closing_float" double precision,
	"variance" double precision,
	"payment_breakdown_json" text,
	"closed_by" text NOT NULL,
	"closed_at" text NOT NULL,
	"device_id" text DEFAULT 'local' NOT NULL,
	"branch_id" text DEFAULT 'main' NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "eod_closings_closing_date_unique" UNIQUE("closing_date")
);
--> statement-breakpoint
CREATE TABLE "grn_headers" (
	"id" text PRIMARY KEY NOT NULL,
	"grn_number" text NOT NULL,
	"vendor_id" text NOT NULL,
	"invoice_number" text,
	"invoice_total" double precision DEFAULT 0 NOT NULL,
	"received_date" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"payment_type" text DEFAULT 'cash' NOT NULL,
	"notes" text,
	"created_by" text NOT NULL,
	"device_id" text DEFAULT 'local' NOT NULL,
	"branch_id" text DEFAULT 'main' NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "grn_headers_grn_number_unique" UNIQUE("grn_number")
);
--> statement-breakpoint
CREATE TABLE "grn_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"grn_id" text NOT NULL,
	"product_id" text NOT NULL,
	"qty" integer NOT NULL,
	"unit_cost" double precision NOT NULL,
	"unit_retail" double precision,
	"line_total" double precision NOT NULL,
	"device_id" text DEFAULT 'local' NOT NULL,
	"branch_id" text DEFAULT 'main' NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_cost_history" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"vendor_id" text,
	"cost_price" double precision NOT NULL,
	"qty" integer DEFAULT 0 NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text,
	"device_id" text DEFAULT 'local' NOT NULL,
	"branch_id" text DEFAULT 'main' NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"payment_number" text NOT NULL,
	"vendor_id" text NOT NULL,
	"amount" double precision NOT NULL,
	"payment_date" text NOT NULL,
	"notes" text,
	"balance_after" double precision DEFAULT 0 NOT NULL,
	"processed_by" text NOT NULL,
	"device_id" text DEFAULT 'local' NOT NULL,
	"branch_id" text DEFAULT 'main' NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "supplier_payments_payment_number_unique" UNIQUE("payment_number")
);
