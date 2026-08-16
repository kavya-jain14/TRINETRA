import type { ProviderPaymentStatus, ProviderScenario } from '@trinetra/contracts';

export interface ProviderSubmissionInput {
  tenantId: string;
  paymentId: string;
  requestReference: string;
  amountPaise: number;
  scenario: ProviderScenario;
}

export interface ProviderInquiryInput {
  tenantId: string;
  paymentId: string;
  requestReference: string;
  providerRequestReference: string;
}

export interface ProviderOperationResult {
  providerStatus: ProviderPaymentStatus;
  responseCode: string;
  providerReference: string;
  evidence: Readonly<Record<string, unknown>>;
}

export interface PaymentProviderAdapter {
  readonly name: string;
  submit(input: ProviderSubmissionInput): Promise<ProviderOperationResult>;
  inquire(input: ProviderInquiryInput): Promise<ProviderOperationResult>;
}

interface SyntheticPayment {
  scenario: ProviderScenario;
  inquiryCount: number;
  lastInquiryRequestReference: string | null;
  lastInquiryStatus: ProviderPaymentStatus | null;
}

const initialProviderStatus: Readonly<Record<ProviderScenario, ProviderPaymentStatus>> = {
  SUCCESS_IMMEDIATE: 'SUCCEEDED',
  TIMEOUT_THEN_SUCCESS: 'PENDING',
  PENDING_THEN_SUCCESS: 'PENDING',
  PENDING_THEN_REVERSED: 'PENDING',
  SOFT_DECLINE: 'FAILED_SOFT',
  HARD_DECLINE: 'FAILED_HARD',
  TIMEOUT_UNKNOWN: 'PENDING',
  DUPLICATE_CALLBACK: 'SUCCEEDED',
  OUT_OF_ORDER_CALLBACK: 'SUCCEEDED',
  INVALID_SIGNATURE_CALLBACK: 'SUCCEEDED',
};

export class DeterministicPaymentProviderAdapter implements PaymentProviderAdapter {
  readonly name = 'trinetra-sandbox';
  readonly #payments = new Map<string, SyntheticPayment>();
  #submissionCount = 0;
  #inquiryCount = 0;

  get submissionCount(): number {
    return this.#submissionCount;
  }

  get inquiryCount(): number {
    return this.#inquiryCount;
  }

  async submit(input: ProviderSubmissionInput): Promise<ProviderOperationResult> {
    this.#submissionCount += 1;
    this.#payments.set(`${input.tenantId}:${input.requestReference}`, {
      scenario: input.scenario,
      inquiryCount: 0,
      lastInquiryRequestReference: null,
      lastInquiryStatus: null,
    });
    if (input.scenario === 'TIMEOUT_THEN_SUCCESS') {
      throw new Error('Synthetic provider response timed out after accepting the submission.');
    }
    const providerStatus = initialProviderStatus[input.scenario];
    return {
      providerStatus,
      responseCode: input.scenario === 'TIMEOUT_UNKNOWN' ? 'TIMEOUT_UNKNOWN' : 'SYNTHETIC_ACK',
      providerReference: input.requestReference,
      evidence: { synthetic_scenario: input.scenario },
    };
  }

  async inquire(input: ProviderInquiryInput): Promise<ProviderOperationResult> {
    this.#inquiryCount += 1;
    const payment = this.#payments.get(`${input.tenantId}:${input.providerRequestReference}`);
    if (!payment) {
      return {
        providerStatus: 'PENDING',
        responseCode: 'UNKNOWN_REFERENCE',
        providerReference: input.providerRequestReference,
        evidence: { inquiry_request_ref: input.requestReference },
      };
    }

    if (
      payment.lastInquiryRequestReference === input.requestReference &&
      payment.lastInquiryStatus
    ) {
      return {
        providerStatus: payment.lastInquiryStatus,
        responseCode: 'SYNTHETIC_STATUS_REPLAY',
        providerReference: input.providerRequestReference,
        evidence: {
          inquiry_request_ref: input.requestReference,
          inquiry_number: payment.inquiryCount,
          idempotent_replay: true,
        },
      };
    }

    payment.inquiryCount += 1;
    let providerStatus = initialProviderStatus[payment.scenario];
    if (
      payment.scenario === 'PENDING_THEN_SUCCESS' ||
      payment.scenario === 'TIMEOUT_THEN_SUCCESS'
    ) {
      providerStatus = 'SUCCEEDED';
    }
    if (payment.scenario === 'PENDING_THEN_REVERSED') {
      providerStatus = payment.inquiryCount === 1 ? 'REVERSAL_PENDING' : 'REVERSED';
    }
    payment.lastInquiryRequestReference = input.requestReference;
    payment.lastInquiryStatus = providerStatus;

    return {
      providerStatus,
      responseCode: 'SYNTHETIC_STATUS',
      providerReference: input.providerRequestReference,
      evidence: {
        inquiry_request_ref: input.requestReference,
        inquiry_number: payment.inquiryCount,
      },
    };
  }
}
