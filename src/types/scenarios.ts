export type ScenarioId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

export interface ScenarioConfig {
  id: ScenarioId;
  title: string;
  subtitle: string;
  riskScore: number;
  decision: 'ALLOW' | 'STEP_UP' | 'BLOCK';
  merchantName: string;
  resolvedVpa: string;
  amountPaise: number;
  isDeceptiveCollect: boolean;
  isRemoteAccessActive: boolean;
  reasons: Array<{ code: string; user_message: string }>;
}

export const SCENARIOS: Record<ScenarioId, ScenarioConfig> = {
  A: {
    id: 'A',
    title: 'A — Trusted Everyday Payment',
    subtitle: 'Known device & merchant. Prior successful relationship.',
    riskScore: 12,
    decision: 'ALLOW',
    merchantName: 'Aarav Electronics',
    resolvedVpa: 'aarav.elec@bank',
    amountPaise: 249900,
    isDeceptiveCollect: false,
    isRemoteAccessActive: false,
    reasons: [],
  },
  B: {
    id: 'B',
    title: 'B — Deceptive Collect Request',
    subtitle: 'UI claims "Receive Refund", but triggers DEBIT collect with screen sharing.',
    riskScore: 92,
    decision: 'BLOCK',
    merchantName: 'Instant Cash Refunds',
    resolvedVpa: 'deceptive.collect@vpa',
    amountPaise: 500000,
    isDeceptiveCollect: true,
    isRemoteAccessActive: true,
    reasons: [
      { code: 'INTENT_CONFLICT', user_message: 'NPCI Alert: Entering UPI PIN authorises a DEBIT, not receipt of money.' },
      { code: 'REMOTE_ACCESS_DETECTED', user_message: 'Active screen-sharing or remote access software detected.' },
    ],
  },
  C: {
    id: 'C',
    title: 'C — QR / Payee Mismatch',
    subtitle: 'UI display is Metro Café, but resolved VPA belongs to personal token.',
    riskScore: 68,
    decision: 'STEP_UP',
    merchantName: 'Metro Café',
    resolvedVpa: 'scammer99@vpa',
    amountPaise: 185000,
    isDeceptiveCollect: false,
    isRemoteAccessActive: false,
    reasons: [
      { code: 'PAYEE_MERCHANT_MISMATCH', user_message: 'Display merchant (Metro Café) does not match resolved VPA (scammer99@vpa).' },
    ],
  },
  D: {
    id: 'D',
    title: 'D — Mule-Network Proximity',
    subtitle: 'Beneficiary is 2 hops from synthetic fraud cluster.',
    riskScore: 88,
    decision: 'BLOCK',
    merchantName: 'Global Digital Pay',
    resolvedVpa: 'mule.node2@vpa',
    amountPaise: 950000,
    isDeceptiveCollect: false,
    isRemoteAccessActive: false,
    reasons: [
      { code: 'SYNTHETIC_MULE_CLUSTER', user_message: 'Beneficiary linked to known multi-hop mule account network.' },
    ],
  },
  E: {
    id: 'E',
    title: 'E — Timeout & Idempotency Lock',
    subtitle: 'PSP returns timeout; retry uses same idempotency key.',
    riskScore: 25,
    decision: 'ALLOW',
    merchantName: 'Utility Services Ltd',
    resolvedVpa: 'utility.pay@bank',
    amountPaise: 120000,
    isDeceptiveCollect: false,
    isRemoteAccessActive: false,
    reasons: [],
  },
  F: {
    id: 'F',
    title: 'F — Reversal Clock & ODR Dispute',
    subtitle: 'Debit succeeded but merchant confirmation missing. T+5 timer active.',
    riskScore: 40,
    decision: 'ALLOW',
    merchantName: 'Transit Metro Card',
    resolvedVpa: 'transit.recharge@bank',
    amountPaise: 50000,
    isDeceptiveCollect: false,
    isRemoteAccessActive: false,
    reasons: [],
  },
};