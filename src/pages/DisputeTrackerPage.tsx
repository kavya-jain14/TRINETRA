import React, { useState, useEffect } from 'react';

interface DisputeTrackerProps {
  payment?: {
    id?: string;
    state?: string;
  };
  onStatusInquirySuccess?: () => void;
}

export const DisputeTrackerPage: React.FC<DisputeTrackerProps> = ({
  payment,
  onStatusInquirySuccess,
}) => {
  const [currentState, setCurrentState] = useState(payment?.state || 'PENDING');
  const [odrRef, setOdrRef] = useState<string | null>(null);
  const [comments, setComments] = useState('');
  const [secondsRemaining, setSecondsRemaining] = useState(432000); // 5 Days = 432000 seconds

  const transactionId = payment?.id || 'txn_default_1029';

  useEffect(() => {
    if (payment?.state) {
      setCurrentState(payment.state);
    }
  }, [payment?.state]);

  // RBI T+5 Days Countdown
  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsRemaining((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatCountdown = (secs: number) => {
    const d = Math.floor(secs / (3600 * 24));
    const h = Math.floor((secs % (3600 * 24)) / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return `T+${d} Days ${h}h ${m}m ${s}s`;
  };

  const handleStatusInquiry = () => {
    setCurrentState('RESOLVING...');
    setTimeout(() => {
      setCurrentState('SUCCEEDED');
      if (onStatusInquirySuccess) onStatusInquirySuccess();
      alert('Status Inquiry Resolved: Late PSP Success Callback Received!');
    }, 1000);
  };

  const handleFileOdrDispute = (e: React.FormEvent) => {
    e.preventDefault();
    const generatedRef = `DISP-2026-${Math.floor(1000 + Math.random() * 9000)}`;
    setOdrRef(generatedRef);
    setCurrentState('ODR_DISPUTE_FILED');
  };

  return (
    <div className="bg-neutral-900 border border-neutral-700 p-6 rounded-lg max-w-md w-full text-slate-50 shadow-xl space-y-4">
      <h2 className="text-xl font-bold border-b border-neutral-700 pb-2">
        Recovery & Dispute Center
      </h2>

      {/* Transaction Summary */}
      <div className="text-sm space-y-1 bg-neutral-950 p-3 rounded border border-neutral-800">
        <p>
          <span className="text-gray-400">Transaction ID: </span>
          <span className="font-mono text-amber-400">{transactionId}</span>
        </p>
        <p>
          <span className="text-gray-400">Status: </span>
          <span className="font-semibold text-emerald-400">{currentState}</span>
        </p>
        <p className="text-xs text-gray-500">Idempotency Lock: Active (Prevents Duplicate Debits)</p>
      </div>

      {/* Scenario E: Perform Status Inquiry */}
      {currentState === 'PENDING' && (
        <button
          onClick={handleStatusInquiry}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 rounded-md transition text-sm"
        >
          Perform Status Inquiry (PSP Sync)
        </button>
      )}

      {/* Scenario F: RBI T+5 Days Auto-Reversal Clock */}
      <div className="border border-amber-500/40 bg-amber-950/20 p-3 rounded space-y-1">
        <p className="text-xs font-bold text-amber-400">⏰ RBI T+5 Days Auto-Reversal Clock</p>
        <p className="text-lg font-mono font-bold text-yellow-300">
          {formatCountdown(secondsRemaining)}
        </p>
        <p className="text-[11px] text-gray-300">
          Compensation Rule: <strong>₹100/day</strong> automatically credited if unresolved after T+5 days.
        </p>
      </div>

      {/* File Official ODR Dispute */}
      {!odrRef ? (
        <form onSubmit={handleFileOdrDispute} className="space-y-2 border-t border-neutral-800 pt-3">
          <label className="block text-xs text-gray-400">Grievance Comments:</label>
          <br></br>
          <textarea
            required
            rows={2}
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            placeholder="Describe issue (e.g., Merchant confirmation missing after debit)..."
            className="w-full bg-neutral-950 border border-neutral-700 rounded p-2 text-xs text-white focus:outline-none focus:border-amber-500"
          />
          <br></br>
          <button
            type="submit"
            className="w-full bg-amber-600 hover:bg-amber-700 text-white font-bold py-2 rounded-md transition text-sm"
          >
            File Official ODR Dispute
          </button>
        </form>
      ) : (
        <div className="bg-emerald-950/50 border border-emerald-500 p-3 rounded text-emerald-300 text-xs space-y-1">
          <p className="font-bold">✓ Official ODR Dispute Submitted</p>
          <p>
            Reference Number: <code className="font-mono font-bold text-white">{odrRef}</code>
          </p>
          <p className="text-gray-400">Logged to Network Recovery Console.</p>
        </div>
      )}
    </div>
  );
};