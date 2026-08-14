import React, { useState } from 'react';
import { SCENARIOS, ScenarioId } from './types/scenarios';
import { MerchantCheckout } from './components/MerchantCheckout';
import { MuleGraphViewer } from './components/MuleGraphViewer';
import { DisputeTrackerPage } from './pages/DisputeTrackerPage';

function App() {
  const [activeScenarioId, setActiveScenarioId] = useState<ScenarioId>('A');
  const [activeTab, setActiveTab] = useState<'CHECKOUT' | 'RECOVERY'>('CHECKOUT');
  const [paymentState, setPaymentState] = useState<{ id: string; state: string }>({
    id: 'txn_init_001',
    state: 'PENDING',
  });

  const activeScenario = SCENARIOS[activeScenarioId];

  return (
    <div className="min-h-screen bg-neutral-950 text-slate-100 flex flex-col items-center p-4 md:p-8 space-y-6 font-sans">
      <header className="text-center space-y-1">
        <h1 className="text-3xl font-black tracking-tight text-white">TRINETRA Consumer Demo</h1>
        <p className="text-xs text-gray-400">Deceptive Debit, Risk Evaluation & Recovery System</p>
      </header>

      {/* Top Bar Scenario Selector */}
      <div className="flex flex-wrap justify-center gap-2 max-w-3xl bg-neutral-900 p-2 rounded-xl border border-neutral-800">
        {(Object.keys(SCENARIOS) as ScenarioId[]).map((id) => (
          <button
            key={id}
            onClick={() => {
              setActiveScenarioId(id);
              setPaymentState({ id: `txn_${id.toLowerCase()}_1029`, state: id === 'E' ? 'PENDING' : 'INITIALIZED' });
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
              activeScenarioId === id
                ? 'bg-red-600 text-white shadow-lg'
                : 'bg-neutral-800 hover:bg-neutral-700 text-gray-300'
            }`}
          >
            Scenario {id}
          </button>
        ))}
      </div>

      {/* Scenario Header Info */}
      <div className="bg-neutral-900 border border-neutral-800 p-3 rounded-lg max-w-md w-full text-center">
        <p className="font-bold text-sm text-red-400">{activeScenario.title}</p>
        <p className="text-xs text-gray-400 mt-1">{activeScenario.subtitle}</p>
      </div>

      {/* Tab Selector */}
      <div className="flex space-x-2 border-b border-neutral-800 pb-2">
        <button
          onClick={() => setActiveTab('CHECKOUT')}
          className={`px-4 py-1.5 text-xs font-bold rounded-t-md ${
            activeTab === 'CHECKOUT' ? 'bg-neutral-800 text-white border-b-2 border-red-500' : 'text-gray-400'
          }`}
        >
          Checkout & Risk Engine
        </button>
        <button
          onClick={() => setActiveTab('RECOVERY')}
          className={`px-4 py-1.5 text-xs font-bold rounded-t-md ${
            activeTab === 'RECOVERY' ? 'bg-neutral-800 text-white border-b-2 border-amber-500' : 'text-gray-400'
          }`}
        >
          Recovery & Disputes (RBI T+5)
        </button>
      </div>

      {/* Dynamic Content */}
      <main className="w-full flex flex-col items-center space-y-6">
        {activeTab === 'CHECKOUT' ? (
          <>
            <MerchantCheckout
              scenario={activeScenario}
              onPaymentSuccess={(txnId) => setPaymentState({ id: txnId, state: 'SUCCEEDED' })}
              onEnterPendingState={(txnId) => {
                setPaymentState({ id: txnId, state: 'PENDING' });
                setActiveTab('RECOVERY');
              }}
            />
            {activeScenarioId === 'D' && <MuleGraphViewer />}
          </>
        ) : (
          <DisputeTrackerPage
            payment={paymentState}
            onStatusInquirySuccess={() => setPaymentState((prev) => ({ ...prev, state: 'SUCCEEDED' }))}
          />
        )}
      </main>
    </div>
  );
}

export default App;