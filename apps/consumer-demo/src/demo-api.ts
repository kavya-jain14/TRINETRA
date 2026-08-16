import {
  DemoPaymentSnapshotSchema,
  type DemoPaymentSnapshot,
  type DemoScenario,
} from '@trinetra/contracts';

export async function runDemoScenario(
  scenario: DemoScenario['key'],
  runId: string,
  signal?: AbortSignal,
): Promise<DemoPaymentSnapshot> {
  const response = await fetch(`/api/v1/demo/scenarios/${scenario}/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ run_id: runId }),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error(`TRINETRA demo request failed (${response.status}).`);
  return DemoPaymentSnapshotSchema.parse(await response.json());
}

export async function recoverDemoScenario(
  scenario: 'timeout-recovery' | 'reversal-recovery',
  runId: string,
  signal?: AbortSignal,
): Promise<DemoPaymentSnapshot> {
  const response = await fetch(`/api/v1/demo/scenarios/${scenario}/recover`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ run_id: runId }),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error(`TRINETRA recovery request failed (${response.status}).`);
  return DemoPaymentSnapshotSchema.parse(await response.json());
}
