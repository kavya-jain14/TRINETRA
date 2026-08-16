import {
  GraphRiskSnapshotSchema,
  type GraphNodeKind,
  type GraphRelationship,
  type GraphRiskSnapshot,
} from '@trinetra/contracts';

export interface GraphTraversalBounds {
  tenantId: string;
  maxHops: 1 | 2;
  maxNodes: number;
  windowDays: number;
}

export const defaultGraphTraversalBounds: Omit<GraphTraversalBounds, 'tenantId'> = {
  maxHops: 2,
  maxNodes: 250,
  windowDays: 90,
};

export const maxGraphTraversalEdges = 500;

export function assertBoundedTraversal(bounds: GraphTraversalBounds): void {
  if (
    bounds.tenantId.length === 0 ||
    !Number.isInteger(bounds.maxHops) ||
    bounds.maxHops < 1 ||
    bounds.maxHops > 2 ||
    !Number.isInteger(bounds.maxNodes) ||
    bounds.maxNodes < 1 ||
    bounds.maxNodes > 250 ||
    !Number.isInteger(bounds.windowDays) ||
    bounds.windowDays < 1 ||
    bounds.windowDays > 365
  ) {
    throw new Error('Graph traversal exceeds TRINETRA safety bounds');
  }
}

export interface GraphNodeRecord {
  tenantId: string;
  ref: string;
  kind: GraphNodeKind;
  label: string;
  riskLabel: 'CONFIRMED_FRAUD' | null;
  validUntil: Date | null;
  createdAt: Date;
}

export interface GraphEdgeRecord {
  tenantId: string;
  ref: string;
  sourceRef: string;
  targetRef: string;
  relationship: GraphRelationship;
  observedAt: Date;
  expiresAt: Date;
}

export interface GraphFixture {
  nodes: readonly GraphNodeRecord[];
  edges: readonly GraphEdgeRecord[];
}

export interface GraphNeighborhoodNode extends GraphNodeRecord {
  depth: number;
}

export interface GraphNeighborhood {
  nodes: readonly GraphNeighborhoodNode[];
  edges: readonly GraphEdgeRecord[];
  truncated: boolean;
}

export interface GraphRepository {
  ensureFixture(fixture: GraphFixture): Promise<void>;
  findNeighborhood(
    destinationRef: string,
    bounds: GraphTraversalBounds,
    asOf: Date,
  ): Promise<GraphNeighborhood>;
}

function graphKey(tenantId: string, ref: string): string {
  return `${tenantId}:${ref}`;
}

function cloneNode(node: GraphNodeRecord): GraphNodeRecord {
  return {
    ...node,
    validUntil: node.validUntil ? new Date(node.validUntil) : null,
    createdAt: new Date(node.createdAt),
  };
}

function cloneEdge(edge: GraphEdgeRecord): GraphEdgeRecord {
  return {
    ...edge,
    observedAt: new Date(edge.observedAt),
    expiresAt: new Date(edge.expiresAt),
  };
}

export class InMemoryGraphRepository implements GraphRepository {
  readonly #nodes = new Map<string, GraphNodeRecord>();
  readonly #edges = new Map<string, GraphEdgeRecord>();

  async ensureFixture(fixture: GraphFixture): Promise<void> {
    for (const node of fixture.nodes) {
      const key = graphKey(node.tenantId, node.ref);
      const existing = this.#nodes.get(key);
      if (
        existing &&
        (existing.kind !== node.kind ||
          existing.label !== node.label ||
          existing.riskLabel !== node.riskLabel)
      ) {
        throw new Error(`Graph node ${node.ref} is already bound to different content.`);
      }
      this.#nodes.set(key, cloneNode(node));
    }

    for (const edge of fixture.edges) {
      const source = this.#nodes.get(graphKey(edge.tenantId, edge.sourceRef));
      const target = this.#nodes.get(graphKey(edge.tenantId, edge.targetRef));
      if (!source || !target) throw new Error(`Graph edge ${edge.ref} references a missing node.`);
      const key = graphKey(edge.tenantId, edge.ref);
      const existing = this.#edges.get(key);
      if (
        existing &&
        (existing.sourceRef !== edge.sourceRef ||
          existing.targetRef !== edge.targetRef ||
          existing.relationship !== edge.relationship)
      ) {
        throw new Error(`Graph edge ${edge.ref} is already bound to different content.`);
      }
      this.#edges.set(key, cloneEdge(edge));
    }
  }

  async findNeighborhood(
    destinationRef: string,
    bounds: GraphTraversalBounds,
    asOf: Date,
  ): Promise<GraphNeighborhood> {
    assertBoundedTraversal(bounds);
    const start = this.#nodes.get(graphKey(bounds.tenantId, destinationRef));
    if (!start || (start.validUntil && start.validUntil <= asOf)) {
      return { nodes: [], edges: [], truncated: false };
    }

    const cutoff = new Date(asOf.getTime() - bounds.windowDays * 24 * 60 * 60 * 1000);
    const edgeCandidates = [...this.#edges.values()]
      .filter(
        (edge) =>
          edge.tenantId === bounds.tenantId &&
          edge.observedAt >= cutoff &&
          edge.observedAt <= asOf &&
          edge.expiresAt > asOf,
      )
      .sort(
        (left, right) =>
          right.observedAt.getTime() - left.observedAt.getTime() ||
          left.ref.localeCompare(right.ref),
      );
    const depths = new Map<string, number>([[destinationRef, 0]]);
    const selectedEdges = new Map<string, GraphEdgeRecord>();
    let frontier = [destinationRef];
    let truncated = false;

    for (let depth = 1; depth <= bounds.maxHops && frontier.length > 0; depth += 1) {
      const next: string[] = [];
      for (const current of frontier) {
        for (const edge of edgeCandidates) {
          const neighbor =
            edge.sourceRef === current
              ? edge.targetRef
              : edge.targetRef === current
                ? edge.sourceRef
                : null;
          if (!neighbor || depths.has(neighbor)) continue;
          const node = this.#nodes.get(graphKey(bounds.tenantId, neighbor));
          if (!node || (node.validUntil && node.validUntil <= asOf)) continue;
          if (!selectedEdges.has(edge.ref) && selectedEdges.size >= maxGraphTraversalEdges) {
            truncated = true;
            continue;
          }
          selectedEdges.set(edge.ref, edge);
          if (depths.size >= bounds.maxNodes) {
            truncated = true;
            continue;
          }
          depths.set(neighbor, depth);
          next.push(neighbor);
        }
      }
      frontier = next;
    }

    const nodes = [...depths.entries()]
      .map(([ref, depth]) => ({
        ...cloneNode(this.#nodes.get(graphKey(bounds.tenantId, ref))!),
        depth,
      }))
      .sort((left, right) => left.depth - right.depth || left.ref.localeCompare(right.ref));
    const included = new Set(nodes.map((node) => node.ref));
    const edges = [...selectedEdges.values()]
      .filter((edge) => included.has(edge.sourceRef) && included.has(edge.targetRef))
      .map(cloneEdge)
      .sort((left, right) => left.ref.localeCompare(right.ref));
    return { nodes, edges, truncated };
  }
}

export const syntheticMuleDestinationRef = 'vpa_tok_graph_destination_47';

export function syntheticMuleFixture(tenantId: string, now: Date): GraphFixture {
  const expiresAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
  const node = (
    ref: string,
    kind: GraphNodeKind,
    label: string,
    riskLabel: 'CONFIRMED_FRAUD' | null = null,
  ): GraphNodeRecord => ({
    tenantId,
    ref,
    kind,
    label,
    riskLabel,
    validUntil: expiresAt,
    createdAt: now,
  });
  const edge = (
    ref: string,
    sourceRef: string,
    targetRef: string,
    relationship: GraphRelationship,
  ): GraphEdgeRecord => ({
    tenantId,
    ref,
    sourceRef,
    targetRef,
    relationship,
    observedAt: now,
    expiresAt,
  });

  return {
    nodes: [
      node(syntheticMuleDestinationRef, 'BENEFICIARY', 'Current destination'),
      node('graph_cluster_demo_12', 'DEVICE_CLUSTER', 'Shared device cluster'),
      node('graph_customer_demo_21', 'CUSTOMER', 'New sender A'),
      node('graph_customer_demo_34', 'CUSTOMER', 'New sender B'),
      node(
        'graph_case_confirmed_01',
        'FRAUD_CASE',
        'Confirmed synthetic case A',
        'CONFIRMED_FRAUD',
      ),
      node(
        'graph_case_confirmed_02',
        'FRAUD_CASE',
        'Confirmed synthetic case B',
        'CONFIRMED_FRAUD',
      ),
    ],
    edges: [
      edge(
        'graph_edge_destination_cluster',
        syntheticMuleDestinationRef,
        'graph_cluster_demo_12',
        'SHARED_DEVICE_CLUSTER',
      ),
      edge(
        'graph_edge_cluster_case_01',
        'graph_cluster_demo_12',
        'graph_case_confirmed_01',
        'CONFIRMED_CASE_LINK',
      ),
      edge(
        'graph_edge_cluster_case_02',
        'graph_cluster_demo_12',
        'graph_case_confirmed_02',
        'CONFIRMED_CASE_LINK',
      ),
      edge(
        'graph_edge_customer_21_cluster',
        'graph_customer_demo_21',
        'graph_cluster_demo_12',
        'PAID_THROUGH_CLUSTER',
      ),
      edge(
        'graph_edge_customer_34_cluster',
        'graph_customer_demo_34',
        'graph_cluster_demo_12',
        'PAID_THROUGH_CLUSTER',
      ),
    ],
  };
}

export class GraphRiskService {
  constructor(private readonly repository: GraphRepository) {}

  async ensureSyntheticMuleFixture(tenantId: string, now: Date): Promise<void> {
    await this.repository.ensureFixture(syntheticMuleFixture(tenantId, now));
  }

  async assessDestination(
    tenantId: string,
    destinationRef: string,
    asOf: Date,
  ): Promise<GraphRiskSnapshot> {
    const bounds: GraphTraversalBounds = { tenantId, ...defaultGraphTraversalBounds };
    const neighborhood = await this.repository.findNeighborhood(destinationRef, bounds, asOf);
    const confirmedCases = neighborhood.nodes.filter(
      (node) => node.riskLabel === 'CONFIRMED_FRAUD' && node.depth > 0,
    );
    const minimumHops =
      confirmedCases.length > 0 ? Math.min(...confirmedCases.map((node) => node.depth)) : null;
    const riskContribution =
      confirmedCases.length === 0 ? 0 : Math.min(75, 45 + confirmedCases.length * 15);

    return GraphRiskSnapshotSchema.parse({
      destination_ref: destinationRef,
      linked_confirmed_cases: confirmedCases.length,
      minimum_hops: minimumHops,
      risk_contribution: riskContribution,
      max_hops: 2,
      truncated: neighborhood.truncated,
      observed_at: asOf.toISOString(),
      nodes: neighborhood.nodes.map((node) => ({
        node_ref: node.ref,
        kind: node.kind,
        label: node.label,
        depth: node.depth,
        risk_label: node.riskLabel,
      })),
      edges: neighborhood.edges.map((edge) => ({
        edge_ref: edge.ref,
        source_ref: edge.sourceRef,
        target_ref: edge.targetRef,
        relationship: edge.relationship,
      })),
    });
  }
}
