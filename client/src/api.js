const TOKEN_KEY = 'atelier_token';
let memoryToken = '';

export function getAuthToken() {
  if (memoryToken) return memoryToken;
  try {
    const ls = window.localStorage.getItem(TOKEN_KEY);
    if (ls) {
      memoryToken = ls;
      return ls;
    }
  } catch {}
  try {
    const ss = window.sessionStorage.getItem(TOKEN_KEY);
    if (ss) {
      memoryToken = ss;
      return ss;
    }
  } catch {}
  return '';
}

export function setAuthToken(token) {
  memoryToken = token || '';
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {}
  try {
    if (token) window.sessionStorage.setItem(TOKEN_KEY, token);
    else window.sessionStorage.removeItem(TOKEN_KEY);
  } catch {}
}

export function clearAuthToken() {
  setAuthToken('');
}

export async function api(url, method = 'GET', body = null) {
  const token = getAuthToken();
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text?.slice(0, 200) || `Erreur HTTP ${res.status}` };
  }
  if (!res.ok) {
    const err = new Error(data.error || `Erreur serveur (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}
