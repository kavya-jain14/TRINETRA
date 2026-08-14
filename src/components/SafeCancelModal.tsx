import React, { useState } from 'react';

export const SafeCancelModal: React.FC<{ paymentIntentId: string; onClose: () => void }> = ({
  paymentIntentId,
  onClose
}) => {
  const [reported, setReported] = useState(false);

  const handleReport = async () => {
    setReported(true);
  };

  return (
    <div className="bg-obsidian-900 border border-gray-700 p-6 rounded-lg text-ivory max-w-md">
      <h3 className="text-lg font-bold text-green-400 mb-2">✓ Payment Safely Cancelled</h3>
      <p className="text-sm text-gray-300 mb-4">No funds were debited from your account.</p>
      {!reported ? (
        <div className="border-t border-obsidian-700 pt-3">
          <p className="text-xs text-gray-400 mb-3">Help protect others in the network by reporting this fraud pattern.</p>
          <button onClick={handleReport} className="w-full bg-vermilion-700 hover:bg-vermilion-800 text-white font-semibold py-2 rounded text-sm">
            Report Fraud to Network
          </button>
        </div>
      ) : (
        <p className="text-xs text-green-400 font-mono mt-2">✓ Report submitted to risk operations console.</p>
      )}
      <button onClick={onClose} className="w-full mt-4 bg-gray-800 text-gray-300 py-2 rounded text-sm">Close</button>
    </div>
  );
};
