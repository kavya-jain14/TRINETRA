import { DemoPaymentSnapshotSchema, type DemoPaymentSnapshot } from '@trinetra/contracts';

export async function runTrustedPayment(
  runId: string,
  signal?: AbortSignal,
): Promise<DemoPaymentSnapshot> {
  const response = await fetch('/api/v1/demo/scenarios/trusted-payment/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ run_id: runId }),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error(`TRINETRA demo request failed (${response.status}).`);
  return DemoPaymentSnapshotSchema.parse(await response.json());
}
