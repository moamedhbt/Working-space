import React, { useState } from 'react';
import { Lock, ShieldCheck } from 'lucide-react';
import { api, setAuthToken } from '../api';

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(u = username, p = password) {
    try {
      setError('');
      setLoading(true);
      const res = await api('/api/login', 'POST', { username: u, password: p });
      setAuthToken(res.token);
      onLogin(res.user);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[#090d16]">
      <div className="w-full max-w-sm bg-[#111827] border border-slate-800 rounded-xl p-7 shadow-2xl">
        <div className="flex items-center gap-2.5 mb-1">
          <ShieldCheck className="w-6 h-6 text-sky-400" />
          <h1 className="text-lg font-semibold tracking-tight text-white">Atelier Manager</h1>
        </div>
        <p className="text-xs text-slate-400 mb-6">Système de Gestion de Production & Planning</p>

        {error && <div className="mb-4 p-2.5 rounded-lg bg-red-950/60 border border-red-800 text-red-300 text-xs">{error}</div>}

        <form onSubmit={e => { e.preventDefault(); submit(); }} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-400">Identifiant</label>
            <input
              className="w-full mt-1 px-3 py-2 rounded-lg bg-[#090d16] border border-slate-800 text-sm text-white focus:outline-none focus:border-sky-500"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="Nom d'utilisateur"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-400">Mot de passe</label>
            <input
              type="password"
              className="w-full mt-1 px-3 py-2 rounded-lg bg-[#090d16] border border-slate-800 text-sm text-white focus:outline-none focus:border-sky-500"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-60 font-medium text-sm text-white flex items-center justify-center gap-2 transition cursor-pointer"
          >
            <Lock className="w-4 h-4" /> {loading ? 'Connexion...' : 'Se connecter'}
          </button>
        </form>

        <div className="mt-5 pt-4 border-t border-slate-800">
          <p className="text-[11px] text-slate-500 mb-2">Connexion rapide (mot de passe : 1234)</p>
          <div className="grid grid-cols-2 gap-2">
            {[
              ['directeur', 'Directeur'],
              ['chef', 'Chef Atelier'],
              ['be', 'Bureau Études'],
              ['karim', 'Opérateur']
            ].map(([u, label]) => (
              <button
                key={u}
                onClick={() => submit(u, '1234')}
                className="px-2.5 py-1.5 rounded-lg bg-[#090d16] border border-slate-800 text-xs text-slate-300 hover:border-sky-500 hover:text-white transition cursor-pointer"
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
