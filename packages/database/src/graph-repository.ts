import type {
  GraphEdgeRecord,
  GraphFixture,
  GraphNeighborhood,
  GraphNeighborhoodNode,
  GraphRepository,
  GraphTraversalBounds,
} from '@trinetra/graph-core';
import { assertBoundedTraversal, maxGraphTraversalEdges } from '@trinetra/graph-core';
import type { Pool, PoolClient, QueryResultRow } from 'pg';

interface GraphNodeRow extends QueryResultRow {
  tenant_id: string;
  external_ref: string;
  kind: GraphNeighborhoodNode['kind'];
  label: string;
  risk_label: 'CONFIRMED_FRAUD' | null;
  valid_until: Date | null;
  created_at: Date;
  depth: number;
  candidates_truncated: boolean;
}

interface GraphEdgeRow extends QueryResultRow {
  tenant_id: string;
  external_ref: string;
  source_ref: string;
  target_ref: string;
  relationship: GraphEdgeRecord['relationship'];
  observed_at: Date;
  expires_at: Date;
}

function toNode(row: GraphNodeRow): GraphNeighborhoodNode {
  return {
    tenantId: row.tenant_id,
    ref: row.external_ref,
    kind: row.kind,
    label: row.label,
    riskLabel: row.risk_label,
    validUntil: row.valid_until,
    createdAt: row.created_at,
    depth: Number(row.depth),
  };
}

function toEdge(row: GraphEdgeRow): GraphEdgeRecord {
  return {
    tenantId: row.tenant_id,
    ref: row.external_ref,
    sourceRef: row.source_ref,
    targetRef: row.target_ref,
    relationship: row.relationship,
    observedAt: row.observed_at,
    expiresAt: row.expires_at,
  };
}

export class PostgresGraphRepository implements GraphRepository {
  constructor(private readonly pool: Pool) {}

  async ensureFixture(fixture: GraphFixture): Promise<void> {
    if (fixture.nodes.length === 0) throw new Error('A graph fixture requires at least one node.');
    const tenantId = fixture.nodes[0]!.tenantId;
    if (
      fixture.nodes.some((node) => node.tenantId !== tenantId) ||
      fixture.edges.some((edge) => edge.tenantId !== tenantId)
    ) {
      throw new Error('A graph fixture cannot span tenants.');
    }

    await this.#transaction(async (client) => {
      for (const node of fixture.nodes) {
        const result = await client.query<GraphNodeRow>(
          `INSERT INTO graph_nodes (
             tenant_id, external_ref, kind, label, risk_label, valid_until, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (tenant_id, external_ref) DO UPDATE
             SET valid_until = GREATEST(graph_nodes.valid_until, EXCLUDED.valid_until)
           RETURNING tenant_id, external_ref, kind, label, risk_label, valid_until,
                     created_at, 0::integer AS depth`,
          [
            node.tenantId,
            node.ref,
            node.kind,
            node.label,
            node.riskLabel,
            node.validUntil,
            node.createdAt,
          ],
        );
        const stored = result.rows[0];
        if (
          !stored ||
          stored.kind !== node.kind ||
          stored.label !== node.label ||
          stored.risk_label !== node.riskLabel
        ) {
          throw new Error(`Graph node ${node.ref} is already bound to different content.`);
        }
      }

      for (const edge of fixture.edges) {
        const result = await client.query<GraphEdgeRow>(
          `INSERT INTO graph_edges (
             tenant_id, external_ref, source_node_id, target_node_id, relationship,
             observed_at, expires_at
           )
           SELECT $1, $2, source.id, target.id, $5, $6, $7
             FROM graph_nodes source
             JOIN graph_nodes target ON target.tenant_id = source.tenant_id
            WHERE source.tenant_id = $1
              AND source.external_ref = $3
              AND target.external_ref = $4
           ON CONFLICT (tenant_id, external_ref) DO UPDATE
             SET observed_at = GREATEST(graph_edges.observed_at, EXCLUDED.observed_at),
                 expires_at = GREATEST(graph_edges.expires_at, EXCLUDED.expires_at)
           RETURNING tenant_id, external_ref,
                     (SELECT external_ref FROM graph_nodes
                       WHERE tenant_id = graph_edges.tenant_id
                         AND id = graph_edges.source_node_id) AS source_ref,
                     (SELECT external_ref FROM graph_nodes
                       WHERE tenant_id = graph_edges.tenant_id
                         AND id = graph_edges.target_node_id) AS target_ref,
                     relationship, observed_at, expires_at`,
          [
            edge.tenantId,
            edge.ref,
            edge.sourceRef,
            edge.targetRef,
            edge.relationship,
            edge.observedAt,
            edge.expiresAt,
          ],
        );
        const stored = result.rows[0];
        if (!stored) throw new Error(`Graph edge ${edge.ref} references a missing node.`);
        if (
          stored.source_ref !== edge.sourceRef ||
          stored.target_ref !== edge.targetRef ||
          stored.relationship !== edge.relationship
        ) {
          throw new Error(`Graph edge ${edge.ref} is already bound to different content.`);
        }
      }
    });
  }

  async findNeighborhood(
    destinationRef: string,
    bounds: GraphTraversalBounds,
    asOf: Date,
  ): Promise<GraphNeighborhood> {
    assertBoundedTraversal(bounds);
    const cutoff = new Date(asOf.getTime() - bounds.windowDays * 24 * 60 * 60 * 1000);
    const edgeLimit = Math.min(bounds.maxNodes * 2, maxGraphTraversalEdges);
    const nodesResult = await this.pool.query<GraphNodeRow>(
      `WITH RECURSIVE start_node AS MATERIALIZED (
         SELECT id
           FROM graph_nodes
          WHERE tenant_id = $1
            AND external_ref = $2
            AND (valid_until IS NULL OR valid_until > $5)
       ), first_hop_edges AS MATERIALIZED (
         SELECT edge.id, edge.tenant_id, edge.source_node_id, edge.target_node_id,
                edge.observed_at, edge.external_ref
           FROM graph_edges edge
           JOIN start_node start
             ON edge.source_node_id = start.id OR edge.target_node_id = start.id
          WHERE edge.tenant_id = $1
            AND edge.observed_at >= $4
            AND edge.observed_at <= $5
            AND edge.expires_at > $5
          ORDER BY edge.observed_at DESC, edge.external_ref
          LIMIT $6
       ), first_hop_node_candidates AS MATERIALIZED (
         SELECT DISTINCT ON (neighbor.id)
                neighbor.id AS node_id, edge.observed_at, edge.external_ref
           FROM first_hop_edges edge
           CROSS JOIN start_node start
           JOIN graph_nodes neighbor
             ON neighbor.tenant_id = $1
            AND neighbor.id = CASE
                  WHEN edge.source_node_id = start.id THEN edge.target_node_id
                  ELSE edge.source_node_id
                END
          WHERE neighbor.valid_until IS NULL OR neighbor.valid_until > $5
          ORDER BY neighbor.id, edge.observed_at DESC, edge.external_ref
       ), first_hop_nodes AS MATERIALIZED (
         SELECT node_id
           FROM first_hop_node_candidates
          ORDER BY observed_at DESC, external_ref, node_id
          LIMIT $9
       ), second_hop_edges AS MATERIALIZED (
         SELECT unique_edge.id, unique_edge.tenant_id, unique_edge.source_node_id,
                unique_edge.target_node_id, unique_edge.observed_at, unique_edge.external_ref
           FROM (
             SELECT DISTINCT ON (edge.id)
                    edge.id, edge.tenant_id, edge.source_node_id, edge.target_node_id,
                    edge.observed_at, edge.external_ref
               FROM graph_edges edge
               JOIN first_hop_nodes hop
                 ON edge.source_node_id = hop.node_id OR edge.target_node_id = hop.node_id
              WHERE edge.tenant_id = $1
                AND edge.observed_at >= $4
                AND edge.observed_at <= $5
                AND edge.expires_at > $5
              ORDER BY edge.id
           ) unique_edge
          ORDER BY unique_edge.observed_at DESC, unique_edge.external_ref
          LIMIT $6
       ), candidate_edges AS MATERIALIZED (
         SELECT combined.id, combined.tenant_id, combined.source_node_id,
                combined.target_node_id, combined.observed_at, combined.external_ref
           FROM (
             SELECT * FROM first_hop_edges
             UNION
             SELECT * FROM second_hop_edges
           ) combined
          ORDER BY combined.observed_at DESC, combined.external_ref
          LIMIT $6
       ), eligible_edges AS MATERIALIZED (
         SELECT id, tenant_id, source_node_id, target_node_id
           FROM candidate_edges
          ORDER BY observed_at DESC, external_ref
          LIMIT $7
       ), walk(node_id, depth) AS (
         SELECT id, 0 FROM start_node
         UNION
         SELECT neighbor.id, walk.depth + 1
           FROM walk
           JOIN eligible_edges edge
             ON edge.source_node_id = walk.node_id OR edge.target_node_id = walk.node_id
           JOIN graph_nodes neighbor
             ON neighbor.tenant_id = $1
            AND neighbor.id = CASE
                  WHEN edge.source_node_id = walk.node_id THEN edge.target_node_id
                  ELSE edge.source_node_id
                END
          WHERE walk.depth < $3
            AND (neighbor.valid_until IS NULL OR neighbor.valid_until > $5)
       ), ranked AS (
         SELECT node_id, MIN(depth)::integer AS depth
           FROM walk
          GROUP BY node_id
          ORDER BY MIN(depth), node_id
          LIMIT $8
       )
       SELECT node.tenant_id, node.external_ref, node.kind, node.label, node.risk_label,
              node.valid_until, node.created_at, ranked.depth,
              ((SELECT COUNT(*) > $7 FROM first_hop_edges)
                OR (SELECT COUNT(*) > $7 FROM second_hop_edges)
                OR (SELECT COUNT(*) > $7 FROM candidate_edges)) AS candidates_truncated
         FROM ranked
         JOIN graph_nodes node ON node.tenant_id = $1 AND node.id = ranked.node_id
        WHERE node.valid_until IS NULL OR node.valid_until > $5
        ORDER BY ranked.depth, node.external_ref`,
      [
        bounds.tenantId,
        destinationRef,
        bounds.maxHops,
        cutoff,
        asOf,
        edgeLimit + 1,
        edgeLimit,
        bounds.maxNodes + 1,
        bounds.maxNodes,
      ],
    );
    const truncatedByCandidates = nodesResult.rows[0]?.candidates_truncated ?? false;
    const truncatedByNodes = nodesResult.rows.length > bounds.maxNodes;
    const selectedRows = nodesResult.rows.slice(0, bounds.maxNodes);
    const refs = selectedRows.map((row) => row.external_ref);
    if (refs.length === 0) return { nodes: [], edges: [], truncated: false };

    const edgesResult = await this.pool.query<GraphEdgeRow>(
      `SELECT edge.tenant_id, edge.external_ref,
              source.external_ref AS source_ref, target.external_ref AS target_ref,
              edge.relationship, edge.observed_at, edge.expires_at
         FROM graph_edges edge
         JOIN graph_nodes source
           ON source.tenant_id = edge.tenant_id AND source.id = edge.source_node_id
         JOIN graph_nodes target
           ON target.tenant_id = edge.tenant_id AND target.id = edge.target_node_id
        WHERE edge.tenant_id = $1
          AND edge.observed_at >= $2
          AND edge.observed_at <= $3
          AND edge.expires_at > $3
          AND source.external_ref = ANY($4::text[])
          AND target.external_ref = ANY($4::text[])
        ORDER BY edge.external_ref
        LIMIT $5`,
      [bounds.tenantId, cutoff, asOf, refs, edgeLimit + 1],
    );
    const truncatedByEdges = edgesResult.rows.length > edgeLimit;
    return {
      nodes: selectedRows.map(toNode),
      edges: edgesResult.rows.slice(0, edgeLimit).map(toEdge),
      truncated: truncatedByCandidates || truncatedByNodes || truncatedByEdges,
    };
  }

  async #transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
