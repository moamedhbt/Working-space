import React, { useState, useEffect, useRef } from 'react';
import {
  LogOut, Cpu, BarChart3, Calendar, Sliders, FolderOpen,
  Wrench, Box, Tv, Shield, Search, ChevronLeft, ChevronRight, Smartphone, AlertTriangle, Activity
} from 'lucide-react';
import { api } from './api';
import Login from './components/Login';
import DirectionView from './components/DirectionView';
import ChefView from './components/ChefView';
import BeView from './components/BeView';
import OperateurView from './components/OperateurView';
import TvView from './components/TvView';

function defaultTabForRole(role) {
  if (role === 'directeur') return 'overview';
  if (role === 'chef') return 'chef';
  if (role === 'be') return 'be';
  if (role === 'tv') return 'tv';
  return 'operateur';
}

export default function App() {
  const [user, setUser] = useState(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [state, setState] = useState({ users: [], machines: [], pieces: [], pannes: [], auditLogs: [] });
  const [tab, setTab] = useState('overview');
  const [collapsed, setCollapsed] = useState(false);
  const [search, setSearch] = useState('');
  const [clock, setClock] = useState(new Date().toLocaleTimeString('fr-FR'));
  const searchInputRef = useRef(null);

  async function reload() {
    try {
      const data = await api('/api/state');
      setState(data);
      // Sync live user info (so renames or role updates reflect immediately)
      if (data.currentUser) {
        setUser(prev => {
          if (!prev) return data.currentUser;
          if (
            prev.nom !== data.currentUser.nom ||
            prev.role !== data.currentUser.role ||
            prev.username !== data.currentUser.username
          ) {
            return data.currentUser;
          }
          return prev;
        });
      }
    } catch {
      localStorage.removeItem('atelier_token');
      setUser(null);
    }
  }

  // Restore session on page refresh (F5)
  useEffect(() => {
    const token = localStorage.getItem('atelier_token');
    if (!token) {
      setAuthChecking(false);
      return;
    }
    api('/api/me')
      .then(res => {
        if (res.user) {
          setUser(res.user);
          setTab(defaultTabForRole(res.user.role));
        }
      })
      .catch(() => {
        localStorage.removeItem('atelier_token');
      })
      .finally(() => setAuthChecking(false));
  }, []);

  // Clock + Ctrl+K shortcut
  useEffect(() => {
    const t = setInterval(() => setClock(new Date().toLocaleTimeString('fr-FR')), 1000);
    const onKeyDown = e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      clearInterval(t);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    reload();
    const timer = setInterval(reload, 10000);
    return () => clearInterval(timer);
  }, [user?.id]);

  function handleLogin(u) {
    setUser(u);
    setTab(defaultTabForRole(u.role));
  }

  if (authChecking) {
    return (
      <div className="min-h-screen bg-[#0B0F14] text-slate-300 flex items-center justify-center text-xs font-mono-num">
        Chargement de la session...
      </div>
    );
  }

  if (!user) return <Login onLogin={handleLogin} />;

  const isDir = user.role === 'directeur';
  const openPannesCount = (state.pannes || []).filter(p => p.statut === 'Ouverte').length;

  const navGroups = isDir ? [
    {
      title: 'PILOTAGE',
      items: [
        ['overview', "Vue d'ensemble", BarChart3],
        ['pilotage', 'Pilotage & TRS', Activity],
        ['planning', 'Planning & Gantt', Calendar],
        ['simulator', 'Simulateur What-If', Sliders],
        ['dossiers', 'Dossiers & Clôture', FolderOpen]
      ]
    },
    {
      title: 'ATELIER',
      items: [
        ['chef', "Chef d'atelier", Wrench],
        ['be', "Bureau d'études", Box],
        ['tv', 'Écran TV', Tv]
      ]
    },
    {
      title: 'ADMINISTRATION',
      items: [
        ['admin', 'Comptes & Audit', Shield]
      ]
    }
  ] : user.role === 'chef' ? [
    { title: 'ATELIER', items: [['chef', "Chef d'atelier", Wrench], ['tv', 'Écran TV', Tv]] }
  ] : user.role === 'be' ? [
    { title: 'INGÉNIERIE', items: [['be', "Bureau d'études", Box]] }
  ] : user.role === 'tv' ? [
    { title: 'AFFICHAGE', items: [['tv', 'Écran TV', Tv]] }
  ] : [
    { title: 'POSTE', items: [['operateur', 'Poste Opérateur', Smartphone], ['tv', 'Écran TV', Tv]] }
  ];

  const allItems = navGroups.flatMap(g => g.items);
  const activeLabel = allItems.find(([id]) => id === tab)?.[1] || "Vue d'ensemble";

  return (
    <div className="min-h-screen bg-cyber-grid text-slate-100 flex flex-col md:flex-row">
      {/* DESKTOP SIDEBAR */}
      <aside className={`hidden md:flex flex-col shrink-0 bg-[#0B0F14] border-r border-[#1E2A38] transition-all duration-200 ${collapsed ? 'w-16' : 'w-56'}`}>
        <div className="h-12 px-4 border-b border-[#1E2A38] flex items-center justify-between">
          {!collapsed && (
            <div className="flex items-center gap-2 font-semibold text-xs tracking-wider text-white">
              <Cpu className="w-4 h-4 text-[#22D3EE]" />
              <span>ATELIER MANAGER</span>
            </div>
          )}
          <button onClick={() => setCollapsed(!collapsed)} className="p-1 rounded hover:bg-[#111821] text-slate-400 cursor-pointer">
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>

        <div className="flex-1 py-4 px-2.5 space-y-5 overflow-y-auto">
          {navGroups.map(g => (
            <div key={g.title}>
              {!collapsed && <div className="px-2.5 mb-1.5 text-[10px] font-semibold tracking-widest text-slate-500">{g.title}</div>}
              <div className="space-y-0.5">
                {g.items.map(([id, label, Icon]) => {
                  const active = tab === id;
                  return (
                    <button
                      key={id}
                      onClick={() => setTab(id)}
                      className={`w-full px-2.5 py-2 rounded-[6px] text-xs font-medium flex items-center gap-2.5 transition cursor-pointer ${
                        active
                          ? 'bg-[#22D3EE]/10 text-[#22D3EE] border border-[#22D3EE]/30 shadow-[0_0_12px_rgba(34,211,238,0.12)]'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-[#111821] border border-transparent'
                      }`}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      {!collapsed && <span className="truncate">{label}</span>}
                      {!collapsed && id === 'chef' && openPannesCount > 0 && (
                        <span className="ml-auto px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 text-[10px] font-mono-num">
                          {openPannesCount}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="p-2.5 border-t border-[#1E2A38]">
          <button
            onClick={() => { localStorage.removeItem('atelier_token'); setUser(null); }}
            className="w-full px-2.5 py-2 rounded-[6px] text-xs text-slate-400 hover:text-white hover:bg-[#111821] flex items-center gap-2.5 cursor-pointer"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            {!collapsed && <span>Déconnexion</span>}
          </button>
        </div>
      </aside>

      {/* MAIN COLUMN */}
      <div className="flex-1 min-w-0 flex flex-col pb-16 md:pb-0">
        {/* SLIM HEADER */}
        <header className="h-12 bg-[#0B0F14]/90 backdrop-blur border-b border-[#1E2A38] px-4 flex items-center justify-between gap-3 sticky top-0 z-40">
          <div className="flex items-center gap-3 min-w-0">
            <div className="text-xs text-slate-100 font-medium truncate">
              {activeLabel}
            </div>
            {openPannesCount > 0 && (
              <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-500/15 border border-red-500/40 text-red-300 text-[10px] font-medium">
                <AlertTriangle className="w-3 h-3" /> {openPannesCount} panne(s)
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 bg-[#111821] border border-[#1E2A38] rounded-[6px] px-2.5 py-1 text-xs text-slate-400">
              <Search className="w-3.5 h-3.5" />
              <input
                ref={searchInputRef}
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Rechercher un OF, une pièce..."
                className="bg-transparent text-slate-200 placeholder-slate-500 focus:outline-none w-40"
              />
              <kbd className="text-[10px] px-1 py-0.5 rounded bg-[#0B0F14] border border-[#1E2A38] font-mono-num">Ctrl K</kbd>
            </div>
            <span className="px-2 py-0.5 rounded-[6px] bg-[#22D3EE]/10 border border-[#22D3EE]/30 text-[#22D3EE] text-xs font-medium">
              {user.nom}
            </span>
            <button
              onClick={() => { localStorage.removeItem('atelier_token'); setUser(null); }}
              className="md:hidden p-1.5 rounded-[6px] border border-[#1E2A38] text-slate-400 hover:text-white"
              title="Déconnexion"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
            <span className="hidden sm:inline text-xs font-mono-num text-slate-400">{clock}</span>
          </div>
        </header>

        {/* CONTENT */}
        <main className="flex-1 p-4 md:p-6 max-w-[1440px] w-full mx-auto">
          {['overview', 'pilotage', 'planning', 'simulator', 'dossiers', 'admin'].includes(tab) && (
            <DirectionView state={state} user={user} reload={reload} activePanel={tab} search={search} />
          )}
          {tab === 'chef' && <ChefView state={state} user={user} reload={reload} search={search} />}
          {tab === 'be' && <BeView state={state} user={user} reload={reload} />}
          {tab === 'operateur' && <OperateurView state={state} user={user} reload={reload} />}
          {tab === 'tv' && <TvView state={state} />}
        </main>
      </div>

      {/* MOBILE BOTTOM BAR */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-[#0B0F14] border-t border-[#1E2A38] flex overflow-x-auto px-1 py-1.5 gap-0.5 z-40">
        {allItems.map(([id, label, Icon]) => {
          const short = id === 'tv' ? 'TV' : id === 'admin' ? 'Admin' : label.split(' ')[0];
          return (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex flex-col items-center shrink-0 gap-0.5 px-2.5 py-1 text-[10px] ${tab === id ? 'text-[#22D3EE]' : 'text-slate-400'}`}
            >
              <Icon className="w-4 h-4" />
              <span className="whitespace-nowrap">{short}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
