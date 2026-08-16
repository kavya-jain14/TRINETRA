import {
  CASE_CATEGORIES,
  CASE_SEVERITIES,
  CASE_STATUSES,
  GRAPH_NODE_KINDS,
  GRAPH_RELATIONSHIPS,
  PAYMENT_STATES,
  PROVIDER_PAYMENT_STATUSES,
  RISK_DECISIONS,
} from '@trinetra/contracts';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const paymentStateEnum = pgEnum('payment_state', PAYMENT_STATES);
export const riskDecisionEnum = pgEnum('risk_decision', RISK_DECISIONS);
export const providerPaymentStatusEnum = pgEnum(
  'provider_payment_status',
  PROVIDER_PAYMENT_STATUSES,
);
export const providerAttemptOperationEnum = pgEnum('provider_attempt_operation', [
  'SUBMIT',
  'STATUS_INQUIRY',
]);
export const providerAttemptStatusEnum = pgEnum('provider_attempt_status', [
  'STARTED',
  'COMPLETED',
  'UNKNOWN',
]);
export const caseStatusEnum = pgEnum('case_status', CASE_STATUSES);
export const caseSeverityEnum = pgEnum('case_severity', CASE_SEVERITIES);
export const caseCategoryEnum = pgEnum('case_category', CASE_CATEGORIES);
export const graphNodeKindEnum = pgEnum('graph_node_kind', GRAPH_NODE_KINDS);
export const graphRelationshipEnum = pgEnum('graph_relationship', GRAPH_RELATIONSHIPS);
export const graphRiskLabelEnum = pgEnum('graph_risk_label', ['CONFIRMED_FRAUD']);

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const graphNodes = pgTable(
  'graph_nodes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    externalRef: text('external_ref').notNull(),
    kind: graphNodeKindEnum('kind').notNull(),
    label: text('label').notNull(),
    riskLabel: graphRiskLabelEnum('risk_label'),
    validUntil: timestamp('valid_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('graph_nodes_tenant_external_ref_unique').on(table.tenantId, table.externalRef),
    uniqueIndex('graph_nodes_tenant_internal_id_unique').on(table.tenantId, table.id),
    index('graph_nodes_tenant_kind_idx').on(table.tenantId, table.kind),
  ],
);

export const graphEdges = pgTable(
  'graph_edges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    externalRef: text('external_ref').notNull(),
    sourceNodeId: uuid('source_node_id').notNull(),
    targetNodeId: uuid('target_node_id').notNull(),
    relationship: graphRelationshipEnum('relationship').notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    check('graph_edges_no_self_loop', sql`${table.sourceNodeId} <> ${table.targetNodeId}`),
    foreignKey({
      columns: [table.tenantId, table.sourceNodeId],
      foreignColumns: [graphNodes.tenantId, graphNodes.id],
      name: 'graph_edges_tenant_source_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.targetNodeId],
      foreignColumns: [graphNodes.tenantId, graphNodes.id],
      name: 'graph_edges_tenant_target_fk',
    }),
    uniqueIndex('graph_edges_tenant_external_ref_unique').on(table.tenantId, table.externalRef),
    index('graph_edges_tenant_source_idx').on(table.tenantId, table.sourceNodeId, table.observedAt),
    index('graph_edges_tenant_target_idx').on(table.tenantId, table.targetNodeId, table.observedAt),
  ],
);

export const paymentIntents = pgTable(
  'payment_intents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    partnerCustomerRef: text('partner_customer_ref').notNull(),
    externalRef: text('external_ref').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    requestBody: jsonb('request_body').notNull(),
    responseBody: jsonb('response_body').notNull(),
    amountPaise: integer('amount_paise').notNull(),
    currency: text('currency').notNull().default('INR'),
    state: paymentStateEnum('state').notNull().default('CREATED'),
    decision: riskDecisionEnum('decision'),
    providerRequestReference: text('provider_request_reference'),
    resourceVersion: integer('resource_version').notNull().default(1),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    pendingSince: timestamp('pending_since', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('payment_intents_tenant_idempotency_unique').on(
      table.tenantId,
      table.idempotencyKey,
    ),
    uniqueIndex('payment_intents_tenant_external_ref_unique').on(table.tenantId, table.externalRef),
    uniqueIndex('payment_intents_tenant_internal_id_unique').on(table.tenantId, table.id),
    uniqueIndex('payment_intents_tenant_provider_ref_unique').on(
      table.tenantId,
      table.providerRequestReference,
    ),
    index('payment_intents_tenant_created_idx').on(table.tenantId, table.createdAt),
  ],
);

export const paymentStateEvents = pgTable(
  'payment_state_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    paymentIntentId: uuid('payment_intent_id').notNull(),
    eventKey: text('event_key').notNull(),
    fromState: paymentStateEnum('from_state'),
    toState: paymentStateEnum('to_state').notNull(),
    source: text('source').notNull(),
    evidence: jsonb('evidence').notNull().default({}),
    resourceVersion: integer('resource_version').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.paymentIntentId],
      foreignColumns: [paymentIntents.tenantId, paymentIntents.id],
      name: 'payment_state_events_tenant_payment_fk',
    }),
    uniqueIndex('payment_state_events_tenant_event_key_unique').on(
      table.tenantId,
      table.paymentIntentId,
      table.eventKey,
    ),
    index('payment_state_events_payment_time_idx').on(table.paymentIntentId, table.occurredAt),
  ],
);

export const idempotencyRecords = pgTable(
  'idempotency_records',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    operation: text('operation').notNull(),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    paymentExternalRef: text('payment_external_ref').notNull(),
    responseBody: jsonb('response_body'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.operation, table.key] }),
    index('idempotency_records_expiry_idx').on(table.expiresAt),
  ],
);

export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    eventKey: text('event_key').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    publishAttempts: integer('publish_attempts').notNull().default(0),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('outbox_events_tenant_event_key_unique').on(table.tenantId, table.eventKey),
    index('outbox_events_unpublished_idx').on(
      table.publishedAt,
      table.availableAt,
      table.createdAt,
    ),
  ],
);

export const providerAttempts = pgTable(
  'provider_attempts',
  {
    id: text('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    paymentIntentId: uuid('payment_intent_id').notNull(),
    provider: text('provider').notNull(),
    operation: providerAttemptOperationEnum('operation').notNull(),
    requestReference: text('request_reference').notNull(),
    requestHash: text('request_hash').notNull(),
    status: providerAttemptStatusEnum('status').notNull().default('STARTED'),
    providerStatus: providerPaymentStatusEnum('provider_status'),
    responseCode: text('response_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.paymentIntentId],
      foreignColumns: [paymentIntents.tenantId, paymentIntents.id],
      name: 'provider_attempts_tenant_payment_fk',
    }),
    uniqueIndex('provider_attempts_tenant_request_ref_unique').on(
      table.tenantId,
      table.provider,
      table.requestReference,
    ),
    index('provider_attempts_payment_created_idx').on(
      table.tenantId,
      table.paymentIntentId,
      table.createdAt,
    ),
  ],
);

export const providerEvents = pgTable(
  'provider_events',
  {
    id: text('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    paymentIntentId: uuid('payment_intent_id').notNull(),
    provider: text('provider').notNull(),
    providerEventId: text('provider_event_id').notNull(),
    providerReference: text('provider_reference').notNull(),
    providerStatus: providerPaymentStatusEnum('provider_status').notNull(),
    payloadHash: text('payload_hash').notNull(),
    amountPaise: integer('amount_paise').notNull(),
    applied: boolean('applied').notNull().default(false),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.paymentIntentId],
      foreignColumns: [paymentIntents.tenantId, paymentIntents.id],
      name: 'provider_events_tenant_payment_fk',
    }),
    uniqueIndex('provider_events_tenant_provider_event_unique').on(
      table.tenantId,
      table.provider,
      table.providerEventId,
    ),
    index('provider_events_payment_received_idx').on(
      table.tenantId,
      table.paymentIntentId,
      table.receivedAt,
    ),
  ],
);

export const syntheticProviderPayments = pgTable(
  'synthetic_provider_payments',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    providerReference: text('provider_reference').notNull(),
    paymentExternalRef: text('payment_external_ref').notNull(),
    amountPaise: integer('amount_paise').notNull(),
    scenario: text('scenario').notNull(),
    currentStatus: providerPaymentStatusEnum('current_status').notNull(),
    inquiryCount: integer('inquiry_count').notNull().default(0),
    lastInquiryRequestReference: text('last_inquiry_request_reference'),
    lastInquiryStatus: providerPaymentStatusEnum('last_inquiry_status'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.providerReference] })],
);

export const paymentRecoveryClocks = pgTable(
  'payment_recovery_clocks',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    paymentIntentId: uuid('payment_intent_id').notNull(),
    statusCheckDueAt: timestamp('status_check_due_at', { withTimezone: true }),
    pendingExpiresAt: timestamp('pending_expires_at', { withTimezone: true }),
    reversalDueAt: timestamp('reversal_due_at', { withTimezone: true }),
    complaintEligibleAt: timestamp('complaint_eligible_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.paymentIntentId] }),
    foreignKey({
      columns: [table.tenantId, table.paymentIntentId],
      foreignColumns: [paymentIntents.tenantId, paymentIntents.id],
      name: 'payment_recovery_clocks_tenant_payment_fk',
    }),
    index('payment_recovery_clocks_status_due_idx').on(table.statusCheckDueAt),
    index('payment_recovery_clocks_reversal_due_idx').on(table.reversalDueAt),
  ],
);

export const fraudCases = pgTable(
  'cases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    externalRef: text('external_ref').notNull(),
    paymentIntentId: uuid('payment_intent_id').notNull(),
    status: caseStatusEnum('status').notNull().default('OPEN'),
    severity: caseSeverityEnum('severity').notNull(),
    category: caseCategoryEnum('category').notNull(),
    summary: text('summary').notNull(),
    evidence: jsonb('evidence').notNull(),
    resourceVersion: integer('resource_version').notNull().default(1),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.paymentIntentId],
      foreignColumns: [paymentIntents.tenantId, paymentIntents.id],
      name: 'cases_tenant_payment_fk',
    }),
    uniqueIndex('cases_tenant_external_ref_unique').on(table.tenantId, table.externalRef),
    uniqueIndex('cases_tenant_payment_unique').on(table.tenantId, table.paymentIntentId),
    uniqueIndex('cases_tenant_internal_id_unique').on(table.tenantId, table.id),
    index('cases_tenant_status_opened_idx').on(table.tenantId, table.status, table.openedAt),
  ],
);

export const caseEvents = pgTable(
  'case_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    caseId: uuid('case_id').notNull(),
    eventKey: text('event_key').notNull(),
    eventType: text('event_type').notNull(),
    source: text('source').notNull(),
    payload: jsonb('payload').notNull().default({}),
    resourceVersion: integer('resource_version').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.caseId],
      foreignColumns: [fraudCases.tenantId, fraudCases.id],
      name: 'case_events_tenant_case_fk',
    }),
    uniqueIndex('case_events_tenant_event_key_unique').on(
      table.tenantId,
      table.caseId,
      table.eventKey,
    ),
    index('case_events_case_time_idx').on(table.tenantId, table.caseId, table.occurredAt),
  ],
);
