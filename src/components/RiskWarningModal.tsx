import React from 'react';

interface RiskWarningProps {
  decision: 'WARN' | 'STEP_UP';
  reasons: Array<{ code: string; user_message: string }>;
  onConfirm: () => void;
  onCancel: () => void;
  children?: React.ReactNode;
}

export const RiskWarningModal: React.FC<RiskWarningProps> = ({
  decision,
  reasons,
  onConfirm,
  onCancel,
  children
}) => {
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
      <div className="bg-neutral-900 border-2 border-red-500 p-6 rounded-xl max-w-lg text-white shadow-2xl">
        <div className="flex items-center space-x-2 text-red-500 mb-3">
          <span className="text-2xl font-black">⚠️ TRINETRA RISK WARNING</span>
        </div>
        <p className="text-sm text-gray-300 mb-4">
          Risk evaluation identified intent or security anomalies:
        </p>
        <div className="bg-neutral-800 p-3 rounded-md mb-4 space-y-2 border border-neutral-700">
          {reasons.map((r, idx) => (
            <p key={idx} className="text-sm text-red-400 font-medium">• {r.user_message}</p>
          ))}
        </div>

        {children}

        <blockquote className="border-l-2 border-yellow-500 pl-3 py-1 my-3 text-xs text-yellow-300 bg-yellow-950/20">
          <strong>NPCI Safety Reminder:</strong> Entering your UPI PIN authorises a DEBIT from your account. Never enter your PIN to receive money.
        </blockquote>

        <div className="flex space-x-3 mt-6">
          <button onClick={onCancel} className="flex-1 bg-neutral-700 hover:bg-neutral-600 text-white font-bold py-2.5 rounded-md transition">
            Cancel Payment (Safe)
          </button>
          <button onClick={onConfirm} className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold py-2.5 rounded-md transition">
            {decision === 'STEP_UP' ? 'Verify & Continue' : 'Acknowledge & Pay'}
          </button>
        </div>
      </div>
    </div>
  );
};