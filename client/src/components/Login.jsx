import React, { useState } from 'react';
import { Lock, Cpu } from 'lucide-react';
import { api } from '../api';

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function submit(u = username, p = password) {
    try {
      setError('');
      const res = await api('/api/login', 'POST', { username: u, password: p });
      localStorage.setItem('atelier_token', res.token);
      onLogin(res.user);
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[radial-gradient(circle_at_top_right,#0f172a,#060a14_65%)]">
      <div className="w-full max-w-md bg-[#11192b]/90 border border-cyan-500/20 rounded-2xl p-6 shadow-2xl">
        <div className="flex items-center gap-3 mb-2">
          <Cpu className="w-7 h-7 text-cyan-400 animate-pulse" />
          <h1 className="text-xl font-bold tracking-wide">Atelier Manager Pro</h1>
        </div>
        <p className="text-xs text-slate-400 mb-6">Système sécurisé de gestion d'atelier, planning & IA</p>

        {error && <div className="mb-4 p-3 rounded-lg bg-red-500/20 border border-red-500/50 text-red-300 text-xs">{error}</div>}

        <label className="text-xs font-semibold text-slate-400">Identifiant</label>
        <input
          className="w-full mt-1 mb-3 px-3 py-2.5 rounded-lg bg-[#060a14] border border-cyan-500/20 text-sm focus:outline-none focus:border-cyan-400"
          value={username}
          onChange={e => setUsername(e.target.value)}
          placeholder="ex: directeur, chef, be, karim"
        />

        <label className="text-xs font-semibold text-slate-400">Mot de passe</label>
        <input
          type="password"
          className="w-full mt-1 mb-5 px-3 py-2.5 rounded-lg bg-[#060a14] border border-cyan-500/20 text-sm focus:outline-none focus:border-cyan-400"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="Mot de passe"
        />

        <button
          onClick={() => submit()}
          className="w-full py-2.5 rounded-lg bg-gradient-to-r from-blue-600 to-cyan-500 font-semibold text-sm flex items-center justify-center gap-2 hover:opacity-90 transition cursor-pointer"
        >
          <Lock className="w-4 h-4" /> Connexion sécurisée
        </button>

        <div className="mt-5 pt-4 border-t border-slate-800">
          <p className="text-xs text-slate-400 mb-2">Accès rapide (mot de passe: <code>1234</code>) :</p>
          <div className="flex flex-wrap gap-2">
            {[
              ['directeur', '👔 Directeur'],
              ['chef', '🛠️ Chef'],
              ['be', '📐 BE'],
              ['karim', '📱 Opérateur']
            ].map(([u, label]) => (
              <button
                key={u}
                onClick={() => submit(u, '1234')}
                className="px-2.5 py-1.5 rounded-lg border border-slate-700 text-xs hover:border-cyan-400 transition cursor-pointer"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
