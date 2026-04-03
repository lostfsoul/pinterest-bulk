import { useState } from 'react';
import AISettings from './AISettings';
import Keywords from './Keywords';
import Templates from './Templates';

type SettingsTab = 'ai' | 'keywords' | 'templates';

export default function Settings() {
  const [tab, setTab] = useState<SettingsTab>('ai');

  return (
    <div className="space-y-4">
      <div className="bg-white border-2 border-black p-4">
        <h1 className="text-2xl font-black uppercase">Settings</h1>
        <p className="text-xs text-gray-600">Global configuration for AI, keywords, and templates</p>
      </div>

      <div className="bg-white border-2 border-black p-3">
        <div className="flex gap-2">
          <button
            onClick={() => setTab('ai')}
            className={`px-3 py-2 text-xs font-black uppercase border-2 ${tab === 'ai' ? 'bg-accent text-white border-black' : 'border-black bg-bg-secondary'}`}
          >
            AI
          </button>
          <button
            onClick={() => setTab('keywords')}
            className={`px-3 py-2 text-xs font-black uppercase border-2 ${tab === 'keywords' ? 'bg-accent text-white border-black' : 'border-black bg-bg-secondary'}`}
          >
            Keywords
          </button>
          <button
            onClick={() => setTab('templates')}
            className={`px-3 py-2 text-xs font-black uppercase border-2 ${tab === 'templates' ? 'bg-accent text-white border-black' : 'border-black bg-bg-secondary'}`}
          >
            Templates
          </button>
        </div>
      </div>

      {tab === 'ai' && <AISettings />}
      {tab === 'keywords' && <Keywords />}
      {tab === 'templates' && <Templates />}
    </div>
  );
}
