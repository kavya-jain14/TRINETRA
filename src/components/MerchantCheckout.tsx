import React, { useState } from 'react';
import { ScenarioConfig } from '../types/scenarios';
import { RiskWarningModal } from './RiskWarningModal';
import { SafeCancelModal } from './SafeCancelModal';

interface MerchantCheckoutProps {
  scenario: ScenarioConfig;
  onPaymentSuccess: (txnId: string) => void;
  onEnterPendingState: (txnId: string) => void;
}

export const MerchantCheckout: React.FC<MerchantCheckoutProps> = ({
  scenario,
  onPaymentSuccess,
  onEnterPendingState,
}) => {
  const [loading, setLoading] = useState(false);
  const [showWarning, setShowWarning] = useState(false);
  const [showSafeCancel, setShowSafeCancel] = useState(false);
  const [vpaConfirmInput, setVpaConfirmInput] = useState('');
  const [stepUpVerified, setStepUpVerified] = useState(false);

  const handlePayClick = () => {
    setLoading(true);
    setTimeout(() => {
      setLoading(false);

      if (scenario.id === 'E') {
        // Scenario E: Timeout -> Pending
        onEnterPendingState('txn_idemp_lock_9021');
        return;
      }

      if (scenario.decision === 'ALLOW') {
        alert('Payment Completed Successfully! State: SUCCEEDED');
        onPaymentSuccess('txn_success_7712');
      } else {
        setShowWarning(true);
      }
    }, 600);
  };

  const handleStepUpConfirm = () => {
    if (scenario.id === 'C' && vpaConfirmInput !== scenario.resolvedVpa) {
      alert(`VPA Mismatch! Please type exact resolved VPA: ${scenario.resolvedVpa}`);
      return;
    }
    setShowWarning(false);
    setStepUpVerified(true);
    alert('Risk Acknowledged & Authorised! State: SUCCEEDED');
    onPaymentSuccess(`txn_${scenario.id.toLowerCase()}_8821`);
  };

  return (
    <div className="bg-neutral-900 border border-neutral-700 p-6 rounded-lg max-w-md w-full text-slate-50 font-sans shadow-xl">
      {/* Risk Score Pill */}
      <div className="flex justify-between items-center border-b border-neutral-700 pb-3 mb-4">
        <h2 className="text-xl font-bold">Merchant Checkout</h2>
        <span
          className={`px-3 py-1 text-xs font-bold rounded-full border ${
            scenario.riskScore > 70
              ? 'bg-red-950/80 text-red-400 border-red-600'
              : scenario.riskScore > 50
              ? 'bg-amber-950/80 text-amber-400 border-amber-600'
              : 'bg-emerald-950/80 text-emerald-400 border-emerald-600'
          }`}
        >
          Risk Score: {scenario.riskScore}/100 ({scenario.decision})
        </span>
      </div>

      {/* Deceptive Collect Warning Banner */}
      {scenario.isDeceptiveCollect && (
        <div className="bg-red-950/40 border border-red-500 text-red-300 p-3 rounded mb-4 text-xs">
          <strong>⚠️ DECEPTIVE COLLECT DETECTED:</strong> User intent indicates receiving money, but merchant payload requests account DEBIT.
        </div>
      )}

      {/* Remote Access Banner */}
      {scenario.isRemoteAccessActive && (
        <div className="bg-amber-950/40 border border-amber-500 text-amber-300 p-2.5 rounded mb-4 text-xs flex items-center gap-2">
          <span>📲</span>
          <span>Remote access / screen sharing software active on host device.</span>
        </div>
      )}

      {/* Merchant Info */}
      <div className="my-3 space-y-1">
        <p className="text-xs text-gray-400">Paying To (UI Display)</p>
        <p className="text-lg font-semibold text-slate-50">{scenario.merchantName}</p>
        <p className="text-xs font-mono text-amber-400">Resolved VPA: {scenario.resolvedVpa}</p>
      </div>

      <div className="my-4">
        <p className="text-xs text-gray-400">Amount</p>
        <p className="text-3xl font-mono font-bold text-slate-50">
          ₹{(scenario.amountPaise / 100).toFixed(2)}
        </p>
      </div>

      <button
        onClick={handlePayClick}
        disabled={loading}
        className="w-full bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-bold py-3 rounded-md transition"
      >
        {loading ? 'TRINETRA Engine Evaluating...' : 'Proceed to Authorise Payment'}
      </button>

      {/* Risk Warning / Step-Up Modal */}
      {showWarning && (
        <RiskWarningModal
          decision={scenario.decision === 'BLOCK' ? 'WARN' : 'STEP_UP'}
          reasons={scenario.reasons}
          onConfirm={handleStepUpConfirm}
          onCancel={() => {
            setShowWarning(false);
            setShowSafeCancel(true);
          }}
        >
          {/* Scenario C Step Up Input */}
          {scenario.id === 'C' && (
            <div className="my-3 bg-neutral-800 p-3 rounded border border-amber-600/50">
              <label className="block text-xs font-semibold text-amber-400 mb-1">
                Confirm Receiver VPA to proceed:
              </label>
              <input
                type="text"
                placeholder={scenario.resolvedVpa}
                value={vpaConfirmInput}
                onChange={(e) => setVpaConfirmInput(e.target.value)}
                className="w-full bg-neutral-900 border border-neutral-600 rounded px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-amber-500"
              />
            </div>
          )}
        </RiskWarningModal>
      )}

      {/* Safe Cancel Modal */}
      {showSafeCancel && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
          <SafeCancelModal
            paymentIntentId={`pi_${scenario.id}_9921`}
            onClose={() => setShowSafeCancel(false)}
          />
        </div>
      )}
    </div>
  );
};