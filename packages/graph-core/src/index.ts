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

export function assertBoundedTraversal(bounds: GraphTraversalBounds): void {
  if (
    bounds.maxNodes < 1 ||
    bounds.maxNodes > 500 ||
    bounds.windowDays < 1 ||
    bounds.windowDays > 365
  ) {
    throw new Error('Graph traversal exceeds TRINETRA safety bounds');
  }
}
