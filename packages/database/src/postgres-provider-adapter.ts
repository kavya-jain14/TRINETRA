import type { ProviderPaymentStatus, ProviderScenario } from '@trinetra/contracts';
import type {
  PaymentProviderAdapter,
  ProviderInquiryInput,
  ProviderOperationResult,
  ProviderSubmissionInput,
} from '@trinetra/payment-core';
import type { Pool, PoolClient, QueryResultRow } from 'pg';

interface SyntheticProviderRow extends QueryResultRow {
  tenant_id: string;
  provider_reference: string;
  payment_external_ref: string;
  amount_paise: number;
  scenario: ProviderScenario;
  current_status: ProviderPaymentStatus;
  inquiry_count: number;
  last_inquiry_request_reference: string | null;
  last_inquiry_status: ProviderPaymentStatus | null;
}

const initialStatus: Readonly<Record<ProviderScenario, ProviderPaymentStatus>> = {
  SUCCESS_IMMEDIATE: 'SUCCEEDED',
  PENDING_THEN_SUCCESS: 'PENDING',
  PENDING_THEN_REVERSED: 'PENDING',
  SOFT_DECLINE: 'FAILED_SOFT',
  HARD_DECLINE: 'FAILED_HARD',
  TIMEOUT_UNKNOWN: 'PENDING',
  DUPLICATE_CALLBACK: 'SUCCEEDED',
  OUT_OF_ORDER_CALLBACK: 'SUCCEEDED',
  INVALID_SIGNATURE_CALLBACK: 'SUCCEEDED',
};

function statusAfterInquiry(row: SyntheticProviderRow): ProviderPaymentStatus {
  if (row.scenario === 'PENDING_THEN_SUCCESS') return 'SUCCEEDED';
  if (row.scenario === 'PENDING_THEN_REVERSED') {
    return row.inquiry_count + 1 === 1 ? 'REVERSAL_PENDING' : 'REVERSED';
  }
  return row.current_status;
}

export class PostgresDeterministicPaymentProviderAdapter implements PaymentProviderAdapter {
  readonly name = 'trinetra-sandbox';

  constructor(private readonly pool: Pool) {}

  async submit(input: ProviderSubmissionInput): Promise<ProviderOperationResult> {
    const status = initialStatus[input.scenario];
    await this.pool.query(
      `INSERT INTO synthetic_provider_payments (
         tenant_id, provider_reference, payment_external_ref, amount_paise, scenario,
         current_status, inquiry_count, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, 0, now(), now())
       ON CONFLICT (tenant_id, provider_reference) DO NOTHING`,
      [
        input.tenantId,
        input.requestReference,
        input.paymentId,
        input.amountPaise,
        input.scenario,
        status,
      ],
    );
    const result = await this.pool.query<SyntheticProviderRow>(
      `SELECT tenant_id, provider_reference, payment_external_ref, amount_paise, scenario,
              current_status, inquiry_count, last_inquiry_request_reference,
              last_inquiry_status
         FROM synthetic_provider_payments
        WHERE tenant_id = $1 AND provider_reference = $2`,
      [input.tenantId, input.requestReference],
    );
    const stored = result.rows[0];
    if (
      !stored ||
      stored.payment_external_ref !== input.paymentId ||
      stored.amount_paise !== input.amountPaise ||
      stored.scenario !== input.scenario
    ) {
      throw new Error('Synthetic provider reference is already bound to different content.');
    }
    return {
      providerStatus: stored.current_status,
      responseCode: input.scenario === 'TIMEOUT_UNKNOWN' ? 'TIMEOUT_UNKNOWN' : 'SYNTHETIC_ACK',
      providerReference: input.requestReference,
      evidence: { synthetic_scenario: input.scenario },
    };
  }

  async inquire(input: ProviderInquiryInput): Promise<ProviderOperationResult> {
    return await this.#transaction(async (client) => {
      const result = await client.query<SyntheticProviderRow>(
        `SELECT tenant_id, provider_reference, payment_external_ref, amount_paise, scenario,
                current_status, inquiry_count, last_inquiry_request_reference,
                last_inquiry_status
           FROM synthetic_provider_payments
          WHERE tenant_id = $1 AND provider_reference = $2
          FOR UPDATE`,
        [input.tenantId, input.providerRequestReference],
      );
      const stored = result.rows[0];
      if (!stored || stored.payment_external_ref !== input.paymentId) {
        return {
          providerStatus: 'PENDING',
          responseCode: 'UNKNOWN_REFERENCE',
          providerReference: input.providerRequestReference,
          evidence: { inquiry_request_ref: input.requestReference },
        };
      }

      if (
        stored.last_inquiry_request_reference === input.requestReference &&
        stored.last_inquiry_status
      ) {
        return {
          providerStatus: stored.last_inquiry_status,
          responseCode: 'SYNTHETIC_STATUS_REPLAY',
          providerReference: input.providerRequestReference,
          evidence: {
            inquiry_request_ref: input.requestReference,
            inquiry_number: stored.inquiry_count,
            idempotent_replay: true,
          },
        };
      }

      const providerStatus = statusAfterInquiry(stored);
      const inquiryCount = stored.inquiry_count + 1;
      await client.query(
        `UPDATE synthetic_provider_payments
            SET current_status = $3,
                inquiry_count = $4,
                last_inquiry_request_reference = $5,
                last_inquiry_status = $3,
                updated_at = now()
          WHERE tenant_id = $1 AND provider_reference = $2`,
        [
          input.tenantId,
          stored.provider_reference,
          providerStatus,
          inquiryCount,
          input.requestReference,
        ],
      );
      return {
        providerStatus,
        responseCode: 'SYNTHETIC_STATUS',
        providerReference: input.providerRequestReference,
        evidence: {
          inquiry_request_ref: input.requestReference,
          inquiry_number: inquiryCount,
        },
      };
    });
  }

  async #transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
