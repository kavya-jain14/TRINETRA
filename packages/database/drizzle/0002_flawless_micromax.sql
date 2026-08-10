CREATE TABLE "synthetic_provider_payments" (
	"tenant_id" uuid NOT NULL,
	"provider_reference" text NOT NULL,
	"payment_external_ref" text NOT NULL,
	"amount_paise" integer NOT NULL,
	"scenario" text NOT NULL,
	"current_status" "provider_payment_status" NOT NULL,
	"inquiry_count" integer DEFAULT 0 NOT NULL,
	"last_inquiry_request_reference" text,
	"last_inquiry_status" "provider_payment_status",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "synthetic_provider_payments_tenant_id_provider_reference_pk" PRIMARY KEY("tenant_id","provider_reference")
);
--> statement-breakpoint
ALTER TABLE "synthetic_provider_payments" ADD CONSTRAINT "synthetic_provider_payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;