import { PAYMENT_STATES, RISK_DECISIONS } from '@trinetra/contracts';
import {
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

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const paymentIntents = pgTable(
  'payment_intents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    partnerCustomerRef: text('partner_customer_ref').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    amountPaise: integer('amount_paise').notNull(),
    currency: text('currency').notNull().default('INR'),
    state: paymentStateEnum('state').notNull().default('CREATED'),
    decision: riskDecisionEnum('decision'),
    resourceVersion: integer('resource_version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('payment_intents_tenant_idempotency_unique').on(
      table.tenantId,
      table.idempotencyKey,
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
    paymentIntentId: uuid('payment_intent_id')
      .notNull()
      .references(() => paymentIntents.id),
    fromState: paymentStateEnum('from_state'),
    toState: paymentStateEnum('to_state').notNull(),
    evidence: jsonb('evidence').notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
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
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (table) => [index('outbox_events_unpublished_idx').on(table.publishedAt, table.createdAt)],
);
