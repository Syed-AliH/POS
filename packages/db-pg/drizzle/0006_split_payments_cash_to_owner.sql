ALTER TABLE "eod_reports" ADD COLUMN "cash_to_owner" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "split_cash_amount" double precision;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "split_other_method" text;