CREATE TYPE "public"."payment_state" AS ENUM('CREATED', 'RISK_EVALUATING', 'ALLOWED', 'CHALLENGED', 'BLOCKED', 'SUBMITTED', 'PENDING', 'SUCCEEDED', 'FAILED_SOFT', 'FAILED_HARD', 'REVERSAL_PENDING', 'REVERSED', 'DISPUTED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."risk_decision" AS ENUM('ALLOW', 'WARN', 'STEP_UP', 'BLOCK');--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"tenant_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "idempotency_records_tenant_id_operation_key_pk" PRIMARY KEY("tenant_id","operation","key")
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payment_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"partner_customer_ref" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"amount_paise" integer NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"state" "payment_state" DEFAULT 'CREATED' NOT NULL,
	"decision" "risk_decision",
	"resource_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_state_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payment_intent_id" uuid NOT NULL,
	"from_state" "payment_state",
	"to_state" "payment_state" NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_state_events" ADD CONSTRAINT "payment_state_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_state_events" ADD CONSTRAINT "payment_state_events_payment_intent_id_payment_intents_id_fk" FOREIGN KEY ("payment_intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idempotency_records_expiry_idx" ON "idempotency_records" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "outbox_events_unpublished_idx" ON "outbox_events" USING btree ("published_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_intents_tenant_idempotency_unique" ON "payment_intents" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "payment_intents_tenant_created_idx" ON "payment_intents" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "payment_state_events_payment_time_idx" ON "payment_state_events" USING btree ("payment_intent_id","occurred_at");