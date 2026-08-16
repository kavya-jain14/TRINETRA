import {
  DemoPaymentListSchema,
  FraudCaseListSchema,
  type DemoPaymentSnapshot,
  type FraudCaseSnapshot,
} from '@trinetra/contracts';

export interface DemoOperationsSnapshot {
  payments: DemoPaymentSnapshot[];
  cases: FraudCaseSnapshot[];
}

export async function loadDemoOperations(signal?: AbortSignal): Promise<DemoOperationsSnapshot> {
  const options = {
    headers: { accept: 'application/json' },
    ...(signal ? { signal } : {}),
  };
  const [paymentsResponse, casesResponse] = await Promise.all([
    fetch('/api/v1/demo/payments?limit=12', options),
    fetch('/api/v1/demo/cases?limit=12', options),
  ]);
  if (!paymentsResponse.ok || !casesResponse.ok) {
    throw new Error(
      `TRINETRA operations request failed (${paymentsResponse.status}/${casesResponse.status}).`,
    );
  }
  return {
    payments: DemoPaymentListSchema.parse(await paymentsResponse.json()).payments,
    cases: FraudCaseListSchema.parse(await casesResponse.json()).cases,
  };
}
