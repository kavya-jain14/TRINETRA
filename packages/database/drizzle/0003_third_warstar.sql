CREATE TYPE "public"."case_category" AS ENUM('SOCIAL_ENGINEERING', 'RISK_REVIEW');--> statement-breakpoint
CREATE TYPE "public"."case_severity" AS ENUM('MEDIUM', 'HIGH', 'CRITICAL');--> statement-breakpoint
CREATE TYPE "public"."case_status" AS ENUM('OPEN', 'IN_REVIEW', 'ESCALATED', 'RESOLVED');--> statement-breakpoint
CREATE TABLE "case_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"event_key" text NOT NULL,
	"event_type" text NOT NULL,
	"source" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"resource_version" integer NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"external_ref" text NOT NULL,
	"payment_intent_id" uuid NOT NULL,
	"status" "case_status" DEFAULT 'OPEN' NOT NULL,
	"severity" "case_severity" NOT NULL,
	"category" "case_category" NOT NULL,
	"summary" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"resource_version" integer DEFAULT 1 NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "cases_tenant_internal_id_unique" ON "cases" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "case_events" ADD CONSTRAINT "case_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_events" ADD CONSTRAINT "case_events_tenant_case_fk" FOREIGN KEY ("tenant_id","case_id") REFERENCES "public"."cases"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_tenant_payment_fk" FOREIGN KEY ("tenant_id","payment_intent_id") REFERENCES "public"."payment_intents"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "case_events_tenant_event_key_unique" ON "case_events" USING btree ("tenant_id","case_id","event_key");--> statement-breakpoint
CREATE INDEX "case_events_case_time_idx" ON "case_events" USING btree ("tenant_id","case_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cases_tenant_external_ref_unique" ON "cases" USING btree ("tenant_id","external_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "cases_tenant_payment_unique" ON "cases" USING btree ("tenant_id","payment_intent_id");--> statement-breakpoint
CREATE INDEX "cases_tenant_status_opened_idx" ON "cases" USING btree ("tenant_id","status","opened_at");
