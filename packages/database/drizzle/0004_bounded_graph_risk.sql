CREATE TYPE "public"."graph_node_kind" AS ENUM('BENEFICIARY', 'DEVICE_CLUSTER', 'CUSTOMER', 'FRAUD_CASE');--> statement-breakpoint
CREATE TYPE "public"."graph_relationship" AS ENUM('SHARED_DEVICE_CLUSTER', 'PAID_THROUGH_CLUSTER', 'CONFIRMED_CASE_LINK');--> statement-breakpoint
CREATE TYPE "public"."graph_risk_label" AS ENUM('CONFIRMED_FRAUD');--> statement-breakpoint
CREATE TABLE "graph_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"external_ref" text NOT NULL,
	"source_node_id" uuid NOT NULL,
	"target_node_id" uuid NOT NULL,
	"relationship" "graph_relationship" NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "graph_edges_no_self_loop" CHECK ("graph_edges"."source_node_id" <> "graph_edges"."target_node_id")
);
--> statement-breakpoint
CREATE TABLE "graph_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"external_ref" text NOT NULL,
	"kind" "graph_node_kind" NOT NULL,
	"label" text NOT NULL,
	"risk_label" "graph_risk_label",
	"valid_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "graph_nodes_tenant_internal_id_unique" ON "graph_nodes" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "graph_edges" ADD CONSTRAINT "graph_edges_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_edges" ADD CONSTRAINT "graph_edges_tenant_source_fk" FOREIGN KEY ("tenant_id","source_node_id") REFERENCES "public"."graph_nodes"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_edges" ADD CONSTRAINT "graph_edges_tenant_target_fk" FOREIGN KEY ("tenant_id","target_node_id") REFERENCES "public"."graph_nodes"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_nodes" ADD CONSTRAINT "graph_nodes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "graph_edges_tenant_external_ref_unique" ON "graph_edges" USING btree ("tenant_id","external_ref");--> statement-breakpoint
CREATE INDEX "graph_edges_tenant_source_idx" ON "graph_edges" USING btree ("tenant_id","source_node_id","observed_at");--> statement-breakpoint
CREATE INDEX "graph_edges_tenant_target_idx" ON "graph_edges" USING btree ("tenant_id","target_node_id","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "graph_nodes_tenant_external_ref_unique" ON "graph_nodes" USING btree ("tenant_id","external_ref");--> statement-breakpoint
CREATE INDEX "graph_nodes_tenant_kind_idx" ON "graph_nodes" USING btree ("tenant_id","kind");
