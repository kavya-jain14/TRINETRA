import type { FastifyInstance } from 'fastify';

export interface HealthRouteConfig {
  persistence: 'postgresql' | 'in-memory-test-adapter';
  checks?: Readonly<Record<string, () => Promise<void>>>;
}

export async function registerHealthRoutes(
  app: FastifyInstance,
  config: HealthRouteConfig,
): Promise<void> {
  app.get('/health/live', async () => ({ status: 'ok', service: 'trinetra-api' }));
  app.get('/health/ready', async (_request, reply) => {
    const dependencies: Record<string, string> = { persistence: config.persistence };
    let isReady = true;

    await Promise.all(
      Object.entries(config.checks ?? {}).map(async ([name, check]) => {
        try {
          await check();
          dependencies[name] = 'ready';
        } catch {
          dependencies[name] = 'unavailable';
          isReady = false;
        }
      }),
    );

    return reply.code(isReady ? 200 : 503).send({
      status: isReady ? 'ready' : 'not_ready',
      service: 'trinetra-api',
      dependencies,
    });
  });
}
