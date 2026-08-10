import type { FastifyInstance } from 'fastify';

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health/live', async () => ({ status: 'ok', service: 'trinetra-api' }));
  app.get('/health/ready', async () => ({
    status: 'ready',
    service: 'trinetra-api',
    dependencies: { persistence: 'foundation-memory-adapter' },
  }));
}
