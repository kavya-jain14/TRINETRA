import { DemoPaymentListSchema, type DemoPaymentSnapshot } from '@trinetra/contracts';

export async function listDemoPayments(signal?: AbortSignal): Promise<DemoPaymentSnapshot[]> {
  const response = await fetch('/api/v1/demo/payments?limit=8', {
    headers: { accept: 'application/json' },
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error(`TRINETRA timeline request failed (${response.status}).`);
  return DemoPaymentListSchema.parse(await response.json()).payments;
}
