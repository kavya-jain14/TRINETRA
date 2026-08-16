CREATE TYPE "public"."provider_attempt_operation" AS ENUM('SUBMIT', 'STATUS_INQUIRY');--> statement-breakpoint
CREATE TYPE "public"."provider_attempt_status" AS ENUM('STARTED', 'COMPLETED', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."provider_payment_status" AS ENUM('PENDING', 'SUCCEEDED', 'FAILED_SOFT', 'FAILED_HARD', 'REVERSAL_PENDING', 'REVERSED');--> statement-breakpoint
CREATE TABLE "payment_recovery_clocks" (
	"tenant_id" uuid NOT NULL,
	"payment_intent_id" uuid NOT NULL,
	"status_check_due_at" timestamp with time zone,
	"pending_expires_at" timestamp with time zone,
	"reversal_due_at" timestamp with time zone,
	"complaint_eligible_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_recovery_clocks_tenant_id_payment_intent_id_pk" PRIMARY KEY("tenant_id","payment_intent_id")
);
--> statement-breakpoint
CREATE TABLE "provider_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payment_intent_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"operation" "provider_attempt_operation" NOT NULL,
	"request_reference" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" "provider_attempt_status" DEFAULT 'STARTED' NOT NULL,
	"provider_status" "provider_payment_status",
	"response_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "provider_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payment_intent_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"provider_reference" text NOT NULL,
	"provider_status" "provider_payment_status" NOT NULL,
	"payload_hash" text NOT NULL,
	"amount_paise" integer NOT NULL,
	"applied" boolean DEFAULT false NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_state_events" DROP CONSTRAINT "payment_state_events_payment_intent_id_payment_intents_id_fk";
--> statement-breakpoint
DROP INDEX "outbox_events_unpublished_idx";--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD COLUMN "payment_external_ref" text;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "event_key" text;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "available_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "publish_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD COLUMN "external_ref" text;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD COLUMN "request_body" jsonb;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD COLUMN "response_body" jsonb;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD COLUMN "provider_request_reference" text;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD COLUMN "pending_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment_state_events" ADD COLUMN "event_key" text;--> statement-breakpoint
ALTER TABLE "payment_state_events" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "payment_state_events" ADD COLUMN "resource_version" integer;--> statement-breakpoint
UPDATE "payment_intents"
   SET "external_ref" = 'pi_' || replace("id"::text, '-', ''),
       "request_body" = jsonb_build_object('migrated_from', 'phase_0a'),
       "response_body" = jsonb_build_object(
         'payment_intent_id', 'pi_' || replace("id"::text, '-', ''),
         'migrated_from', 'phase_0a'
       );--> statement-breakpoint
UPDATE "idempotency_records" AS ir
   SET "payment_external_ref" = pi."external_ref"
  FROM "payment_intents" AS pi
 WHERE ir."tenant_id" = pi."tenant_id"
   AND ir."operation" = 'payment-intents'
   AND ir."key" = pi."idempotency_key";--> statement-breakpoint
UPDATE "idempotency_records"
   SET "payment_external_ref" = 'legacy_' || md5(
     "tenant_id"::text || ':' || "operation" || ':' || "key"
   )
 WHERE "payment_external_ref" IS NULL;--> statement-breakpoint
UPDATE "outbox_events"
   SET "event_key" = 'legacy:' || "id"::text;--> statement-breakpoint
UPDATE "payment_state_events"
   SET "event_key" = 'legacy:' || "id"::text,
       "source" = 'LEGACY_MIGRATION',
       "resource_version" = 1;--> statement-breakpoint
ALTER TABLE "idempotency_records" ALTER COLUMN "payment_external_ref" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox_events" ALTER COLUMN "event_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_intents" ALTER COLUMN "external_ref" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_intents" ALTER COLUMN "request_body" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_intents" ALTER COLUMN "response_body" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_state_events" ALTER COLUMN "event_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_state_events" ALTER COLUMN "source" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_state_events" ALTER COLUMN "resource_version" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_intents_tenant_internal_id_unique" ON "payment_intents" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "payment_recovery_clocks" ADD CONSTRAINT "payment_recovery_clocks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_recovery_clocks" ADD CONSTRAINT "payment_recovery_clocks_tenant_payment_fk" FOREIGN KEY ("tenant_id","payment_intent_id") REFERENCES "public"."payment_intents"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_attempts" ADD CONSTRAINT "provider_attempts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_attempts" ADD CONSTRAINT "provider_attempts_tenant_payment_fk" FOREIGN KEY ("tenant_id","payment_intent_id") REFERENCES "public"."payment_intents"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_events" ADD CONSTRAINT "provider_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_events" ADD CONSTRAINT "provider_events_tenant_payment_fk" FOREIGN KEY ("tenant_id","payment_intent_id") REFERENCES "public"."payment_intents"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_recovery_clocks_status_due_idx" ON "payment_recovery_clocks" USING btree ("status_check_due_at");--> statement-breakpoint
CREATE INDEX "payment_recovery_clocks_reversal_due_idx" ON "payment_recovery_clocks" USING btree ("reversal_due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_attempts_tenant_request_ref_unique" ON "provider_attempts" USING btree ("tenant_id","provider","request_reference");--> statement-breakpoint
CREATE INDEX "provider_attempts_payment_created_idx" ON "provider_attempts" USING btree ("tenant_id","payment_intent_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_events_tenant_provider_event_unique" ON "provider_events" USING btree ("tenant_id","provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "provider_events_payment_received_idx" ON "provider_events" USING btree ("tenant_id","payment_intent_id","received_at");--> statement-breakpoint
ALTER TABLE "payment_state_events" ADD CONSTRAINT "payment_state_events_tenant_payment_fk" FOREIGN KEY ("tenant_id","payment_intent_id") REFERENCES "public"."payment_intents"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_events_tenant_event_key_unique" ON "outbox_events" USING btree ("tenant_id","event_key");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_intents_tenant_external_ref_unique" ON "payment_intents" USING btree ("tenant_id","external_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_intents_tenant_provider_ref_unique" ON "payment_intents" USING btree ("tenant_id","provider_request_reference");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_state_events_tenant_event_key_unique" ON "payment_state_events" USING btree ("tenant_id","payment_intent_id","event_key");--> statement-breakpoint
CREATE INDEX "outbox_events_unpublished_idx" ON "outbox_events" USING btree ("published_at","available_at","created_at");
