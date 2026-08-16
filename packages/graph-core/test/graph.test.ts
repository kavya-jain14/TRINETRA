import { describe, expect, it } from 'vitest';

import {
  assertBoundedTraversal,
  GraphRiskService,
  InMemoryGraphRepository,
  syntheticMuleDestinationRef,
} from '../src/index.js';

const tenantA = '00000000-0000-4000-8000-000000000001';
const tenantB = '00000000-0000-4000-8000-000000000002';
const now = new Date('2026-08-16T12:00:00.000Z');

describe('bounded graph risk', () => {
  it('finds two confirmed synthetic cases at exactly two hops', async () => {
    const repository = new InMemoryGraphRepository();
    const service = new GraphRiskService(repository);
    await service.ensureSyntheticMuleFixture(tenantA, now);

    const result = await service.assessDestination(tenantA, syntheticMuleDestinationRef, now);

    expect(result).toMatchObject({
      destination_ref: syntheticMuleDestinationRef,
      linked_confirmed_cases: 2,
      minimum_hops: 2,
      risk_contribution: 75,
      max_hops: 2,
      truncated: false,
    });
    expect(result.nodes).toHaveLength(6);
    expect(result.edges).toHaveLength(5);
  });

  it('keeps the same destination token isolated by tenant', async () => {
    const repository = new InMemoryGraphRepository();
    const service = new GraphRiskService(repository);
    await service.ensureSyntheticMuleFixture(tenantA, now);

    const otherTenant = await service.assessDestination(tenantB, syntheticMuleDestinationRef, now);

    expect(otherTenant.linked_confirmed_cases).toBe(0);
    expect(otherTenant.nodes).toEqual([]);
    expect(otherTenant.edges).toEqual([]);
  });

  it('expires stale graph evidence and rejects unsafe bounds', async () => {
    const repository = new InMemoryGraphRepository();
    const service = new GraphRiskService(repository);
    await service.ensureSyntheticMuleFixture(tenantA, now);

    const expired = await service.assessDestination(
      tenantA,
      syntheticMuleDestinationRef,
      new Date('2026-11-15T12:00:00.000Z'),
    );

    expect(expired.risk_contribution).toBe(0);
    expect(expired.nodes).toEqual([]);
    expect(() =>
      assertBoundedTraversal({ tenantId: tenantA, maxHops: 2, maxNodes: 251, windowDays: 90 }),
    ).toThrow('Graph traversal exceeds TRINETRA safety bounds');
    expect(() =>
      assertBoundedTraversal({
        tenantId: tenantA,
        maxHops: 3 as 2,
        maxNodes: 250,
        windowDays: 90,
      }),
    ).toThrow('Graph traversal exceeds TRINETRA safety bounds');
  });
});
