import type { FastifyInstance } from 'fastify';

export interface HealthRouteConfig {
  persistence: 'postgresql' | 'in-memory-test-adapter';
}

export async function registerHealthRoutes(
  app: FastifyInstance,
  config: HealthRouteConfig,
): Promise<void> {
  app.get('/health/live', async () => ({ status: 'ok', service: 'trinetra-api' }));
  app.get('/health/ready', async () => ({
    status: 'ready',
    service: 'trinetra-api',
    dependencies: { persistence: config.persistence },
  }));
}
