import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('database migrations', () => {
  it('creates the tenant-scoped case key before the case-event foreign key', () => {
    const migration = readFileSync(
      new URL('../drizzle/0003_third_warstar.sql', import.meta.url),
      'utf8',
    );
    const uniqueKey = migration.indexOf('CREATE UNIQUE INDEX "cases_tenant_internal_id_unique"');
    const foreignKey = migration.indexOf(
      'ALTER TABLE "case_events" ADD CONSTRAINT "case_events_tenant_case_fk"',
    );

    expect(uniqueKey).toBeGreaterThanOrEqual(0);
    expect(foreignKey).toBeGreaterThan(uniqueKey);
  });

  it('creates tenant-scoped graph keys before bounded edge foreign keys', () => {
    const migration = readFileSync(
      new URL('../drizzle/0004_bounded_graph_risk.sql', import.meta.url),
      'utf8',
    );
    const nodeKey = migration.indexOf(
      'CREATE UNIQUE INDEX "graph_nodes_tenant_internal_id_unique"',
    );
    const sourceForeignKey = migration.indexOf(
      'ALTER TABLE "graph_edges" ADD CONSTRAINT "graph_edges_tenant_source_fk"',
    );

    expect(nodeKey).toBeGreaterThanOrEqual(0);
    expect(sourceForeignKey).toBeGreaterThan(nodeKey);
    expect(migration).toContain('CONSTRAINT "graph_edges_no_self_loop"');
  });
});
