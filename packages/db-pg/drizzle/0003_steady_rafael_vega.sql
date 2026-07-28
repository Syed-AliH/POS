CREATE TABLE IF NOT EXISTS "eod_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"report_date" text NOT NULL,
	"store_name" text,
	"cashier_id" text,
	"cashier_name" text,
	"opening_cash" double precision DEFAULT 0 NOT NULL,
	"card_payments" double precision DEFAULT 0 NOT NULL,
	"online_payments" double precision DEFAULT 0 NOT NULL,
	"total_cash_count" double precision DEFAULT 0 NOT NULL,
	"total_expenses" double precision DEFAULT 0 NOT NULL,
	"daily_sales" double precision DEFAULT 0 NOT NULL,
	"pdf_base64" text NOT NULL,
	"device_id" text DEFAULT 'local' NOT NULL,
	"branch_id" text DEFAULT 'main' NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
