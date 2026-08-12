import type { Pool } from 'pg';

export interface EnsureTenantInput {
  id: string;
  slug: string;
  name: string;
}

export async function ensureTenant(pool: Pool, input: EnsureTenantInput): Promise<void> {
  await pool.query(
    `INSERT INTO tenants (id, slug, name)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, name = EXCLUDED.name`,
    [input.id, input.slug, input.name],
  );
}
