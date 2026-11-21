import React, { useState, useEffect } from 'react';
import { LogOut, Cpu, LayoutDashboard, Wrench, Compass, Smartphone, Tv } from 'lucide-react';
import { api } from './api';
import Login from './components/Login';
import DirectionView from './components/DirectionView';
import ChefView from './components/ChefView';
import BeView from './components/BeView';
import OperateurView from './components/OperateurView';
import TvView from './components/TvView';

export default function App() {
  const [user, setUser] = useState(null);
  const [state, setState] = useState({ users: [], machines: [], pieces: [], auditLogs: [] });
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
    tabs.push(
      ['direction', 'Direction & Planning', LayoutDashboard],
      ['chef', 'Chef Atelier', Wrench],
      ['be', 'Bureau d\'Études', Compass],
      ['tv', 'Écran TV', Tv]
    );
  } else if (user.role === 'chef') {
    tabs.push(['chef', 'Chef Atelier', Wrench], ['tv', 'Écran TV', Tv]);
  } else if (user.role === 'be') {
    tabs.push(['be', 'Bureau d\'Études', Compass]);
  } else {
    tabs.push(['operateur', 'Poste Opérateur', Smartphone], ['tv', 'Écran TV', Tv]);
  }

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-100">
      <header className="sticky top-0 z-50 bg-[#090d16]/95 backdrop-blur border-b border-slate-800 px-5 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Cpu className="w-5 h-5 text-sky-400" />
          <span className="font-semibold tracking-tight text-sm">ATELIER MANAGER</span>
          <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-sky-400 text-xs font-medium">{user.nom}</span>
        </div>

        <nav className="flex flex-wrap gap-1.5">
          {tabs.map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition cursor-pointer ${
                tab === id ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </nav>

        <button
          onClick={() => { localStorage.removeItem('atelier_token'); setUser(null); }}
          className="px-3 py-1.5 rounded-lg border border-slate-800 text-xs text-slate-400 hover:text-white hover:border-slate-700 flex items-center gap-1.5 cursor-pointer"
        >
          <LogOut className="w-3.5 h-3.5" /> Déconnexion
        </button>
      </header>

      <main className="max-w-7xl mx-auto p-5">
        {tab === 'direction' && <DirectionView state={state} reload={reload} />}
        {tab === 'chef' && <ChefView state={state} reload={reload} />}
        {tab === 'be' && <BeView state={state} reload={reload} />}
        {tab === 'operateur' && <OperateurView state={state} user={user} reload={reload} />}
        {tab === 'tv' && <TvView state={state} />}
      </main>
    </div>
  );
}
