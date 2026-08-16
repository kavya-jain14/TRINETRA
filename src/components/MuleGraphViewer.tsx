import React from 'react';

export const MuleGraphViewer: React.FC = () => {
  return (
    <div className="bg-neutral-900 border border-neutral-700 p-4 rounded-lg max-w-md w-full text-slate-100 shadow-xl text-xs space-y-3">
      <h3 className="font-bold text-red-400 text-sm border-b border-neutral-700 pb-2">
        🕸️ Graph Evidence: Mule Network Proximity
      </h3>
      <p className="text-gray-300">
        Beneficiary <code className="text-amber-400">mule.node2@vpa</code> is <strong>2 hops</strong> away from 2 confirmed synthetic identity fraud nodes.
      </p>

      <div className="bg-neutral-950 p-3 rounded border border-neutral-800 space-y-2 font-mono">
        <div className="flex items-center justify-between text-gray-400">
          <span>[User Device]</span> ➔ <span>[Target: mule.node2@vpa]</span>
        </div>
        <div className="text-center text-red-400 font-bold">↓ 1 Hop Link</div>
        <div className="flex items-center justify-between text-red-400">
          <span>[Cluster IP: 182.72.x.x]</span> ➔ <span>[Synthetic Case #8021]</span>
        </div>
      </div>

      <div className="bg-red-950/40 border border-red-700 p-2.5 rounded text-red-300">
        🔒 <strong>Analyst Action:</strong> High integrity score spike (88/100). Auto-generated case file <code>CASE-MULE-2026-9011</code>.
      </div>
    </div>
  );
};