import React, { useState, useEffect } from 'react';
import { LogOut, Cpu } from 'lucide-react';
import { api } from './api';
import Login from './components/Login';
import DirectionView from './components/DirectionView';
import ChefView from './components/ChefView';
import BeView from './components/BeView';
import OperateurView from './components/OperateurView';
import TvView from './components/TvView';

export default function App() {
  const [user, setUser] = useState(null);
  const [state, setState] = useState({ users: [], machines: [], pieces: [] });
  const [tab, setTab] = useState('');

  async function reload() {
    try {
      const data = await api('/api/state');
      setState(data);
    } catch {
      setUser(null);
    }
  }

  useEffect(() => {
    if (user) {
      reload();
      if (user.role === 'directeur') setTab('direction');
      else if (user.role === 'chef') setTab('chef');
      else if (user.role === 'be') setTab('be');
      else setTab('operateur');
      const timer = setInterval(reload, 10000);
      return () => clearInterval(timer);
    }
  }, [user]);

  if (!user) return <Login onLogin={setUser} />;

  const tabs = [];
  if (user.role === 'directeur') {
    tabs.push(['direction', '👔 Direction & Planning'], ['chef', '🛠️ Chef Atelier'], ['be', '📐 BE'], ['tv', '📺 TV']);
  } else if (user.role === 'chef') {
    tabs.push(['chef', '🛠️ Chef Atelier'], ['tv', '📺 TV']);
  } else if (user.role === 'be') {
    tabs.push(['be', '📐 Bureau Études']);
  } else {
    tabs.push(['operateur', '📱 Mon Travail'], ['tv', '📺 TV']);
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_right,#0f172a,#060a14_65%)]">
      <header className="sticky top-0 z-50 bg-[#060a14]/90 backdrop-blur border-b border-cyan-500/20 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-bold">
          <Cpu className="w-5 h-5 text-cyan-400 animate-pulse" />
          <span>Atelier Manager Pro</span>
          <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-xs">{user.nom}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                tab === id ? 'bg-gradient-to-r from-blue-600 to-cyan-500 text-white' : 'bg-[#19243d] text-slate-300 border border-slate-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          onClick={() => { localStorage.removeItem('atelier_token'); setUser(null); }}
          className="px-3 py-1.5 rounded-lg border border-slate-700 text-xs flex items-center gap-1 hover:border-red-400 cursor-pointer"
        >
          <LogOut className="w-3.5 h-3.5" /> Déconnexion
        </button>
      </header>

      <main className="max-w-7xl mx-auto p-4">
        {tab === 'direction' && <DirectionView state={state} reload={reload} />}
        {tab === 'chef' && <ChefView state={state} reload={reload} />}
        {tab === 'be' && <BeView state={state} reload={reload} />}
        {tab === 'operateur' && <OperateurView state={state} user={user} reload={reload} />}
        {tab === 'tv' && <TvView state={state} />}
      </main>
    </div>
  );
}
