import { z } from 'zod';

export const GRAPH_NODE_KINDS = [
  'BENEFICIARY',
  'DEVICE_CLUSTER',
  'CUSTOMER',
  'FRAUD_CASE',
] as const;
export const GraphNodeKindSchema = z.enum(GRAPH_NODE_KINDS);
export type GraphNodeKind = z.infer<typeof GraphNodeKindSchema>;

export const GRAPH_RELATIONSHIPS = [
  'SHARED_DEVICE_CLUSTER',
  'PAID_THROUGH_CLUSTER',
  'CONFIRMED_CASE_LINK',
] as const;
export const GraphRelationshipSchema = z.enum(GRAPH_RELATIONSHIPS);
export type GraphRelationship = z.infer<typeof GraphRelationshipSchema>;

const GraphReferenceSchema = z.string().regex(/^[a-z][a-z0-9_]{5,95}$/);

export const GraphNodeSnapshotSchema = z.object({
  node_ref: GraphReferenceSchema,
  kind: GraphNodeKindSchema,
  label: z.string().min(1).max(80),
  depth: z.number().int().min(0).max(2),
  risk_label: z.literal('CONFIRMED_FRAUD').nullable(),
});
export type GraphNodeSnapshot = z.infer<typeof GraphNodeSnapshotSchema>;

export const GraphEdgeSnapshotSchema = z.object({
  edge_ref: GraphReferenceSchema,
  source_ref: GraphReferenceSchema,
  target_ref: GraphReferenceSchema,
  relationship: GraphRelationshipSchema,
});
export type GraphEdgeSnapshot = z.infer<typeof GraphEdgeSnapshotSchema>;

export const GraphRiskSnapshotSchema = z.object({
  destination_ref: GraphReferenceSchema,
  linked_confirmed_cases: z.number().int().min(0).max(20),
  minimum_hops: z.number().int().min(1).max(2).nullable(),
  risk_contribution: z.number().int().min(0).max(75),
  max_hops: z.literal(2),
  truncated: z.boolean(),
  observed_at: z.string().datetime({ offset: true }),
  nodes: z.array(GraphNodeSnapshotSchema).max(250),
  edges: z.array(GraphEdgeSnapshotSchema).max(500),
});
export type GraphRiskSnapshot = z.infer<typeof GraphRiskSnapshotSchema>;
