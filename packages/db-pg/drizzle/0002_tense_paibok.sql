CREATE TABLE IF NOT EXISTS "promo_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"description" text,
	"type" text NOT NULL,
	"value" double precision NOT NULL,
	"start_date" text,
	"end_date" text,
	"min_purchase" double precision,
	"product_ids" text,
	"category_ids" text,
	"usage_limit" integer,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"device_id" text DEFAULT 'local' NOT NULL,
	"branch_id" text DEFAULT 'main' NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "promo_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "base_retail_price" double precision;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "base_sale_price" double precision;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "prev_retail_price" double precision;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "prev_sale_price" double precision;
