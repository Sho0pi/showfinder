import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const API = import.meta.env.VITE_API_BASE || '/api';
const initialAuth = { loading: true, authenticated: false, user: null, setupReady: false, missing: [], message: '' };

async function readJson(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || `Request failed with ${res.status}`);
  return data;
}

function LoginScreen({ auth }) {
  return <main className="loginPage">
    <section className="simpleLogin">
      <div className="spotifyMark">Spotify Show Finder</div>
      <div className="card loginCard">
        <p className="eyebrow">Concerts from your Spotify</p>
        <h1>Find shows from artists you already listen to.</h1>
        <p className="lede">Connect your Spotify account and we'll pull your followed artists and liked-song artists, then show upcoming concerts.</p>

        {auth.loading && <div className="notice">Checking Spotify connection...</div>}

        {!auth.loading && !auth.setupReady && <div className="notice error">
          <strong>Spotify isn't configured yet.</strong>
          <span>The app is missing server-side Spotify credentials. Add them to your local .env file, restart the server, then come back here.</span>
        </div>}

        {auth.message && <div className="notice error">{auth.message}</div>}

        <a className={`button loginButton ${!auth.setupReady ? 'disabled' : ''}`} href={`${API}/auth/login`} onClick={e => { if (!auth.setupReady) e.preventDefault(); }}>
          Continue with Spotify
        </a>

        <p className="finePrint">We only request permission to read your followed artists and saved tracks. No passwords, no tokens, no developer fields on this page.</p>
      </div>
    </section>
  </main>;
}

function App() {
  const [auth, setAuth] = useState(initialAuth);
  const [token, setToken] = useState(localStorage.getItem('spotify_access_token') || '');
  const [artists, setArtists] = useState([]);
  const [selected, setSelected] = useState([]);
  const [events, setEvents] = useState([]);
  const [mocked, setMocked] = useState(false);
  const [loading, setLoading] = useState('');
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ continent: '', country: '', city: '', radius: '', startDate: '', endDate: '' });
  const [artistSearch, setArtistSearch] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const urlToken = params.get('access_token');
    if (urlToken) {
      localStorage.setItem('spotify_access_token', urlToken);
      setToken(urlToken);
      history.replaceState({}, '', '/');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      setAuth(a => ({ ...a, loading: true }));
      try {
        const config = await fetch(`${API}/config`).then(readJson);
        let me = null;
        if (token) {
          try { me = await fetch(`${API}/me`, { headers: { authorization: `Bearer ${token}` } }).then(readJson); }
          catch { localStorage.removeItem('spotify_access_token'); setToken(''); }
        }
        if (cancelled) return;
        setAuth({ loading: false, authenticated: Boolean(me?.user), user: me?.user || null, setupReady: Boolean(config.ready), missing: config.missing || [], message: '' });
      } catch {
        if (!cancelled) setAuth({ loading: false, authenticated: false, user: null, setupReady: false, missing: [], message: 'The API server is not reachable. Start it with bun run dev so /api/config can respond.' });
      }
    }
    bootstrap();
    return () => { cancelled = true; };
  }, [token]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const code = params.get('code');
    if (!code || token) return;
    setLoading('Finishing Spotify login');
    fetch(`${API}/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) })
      .then(readJson).then(data => { localStorage.setItem('spotify_access_token', data.access_token); setToken(data.access_token); history.replaceState({}, '', '/'); })
      .catch(e => setError(e.message)).finally(() => setLoading(''));
  }, [token]);

  async function loadArtists() {
    setLoading('Loading your Spotify artists'); setError('');
    try { const data = await fetch(`${API}/artists`, { headers: { authorization: `Bearer ${token}` } }).then(readJson); setArtists(data.artists || []); setSelected((data.artists || []).slice(0, 20).map(a => a.id)); }
    catch (e) { setError(e.message); } finally { setLoading(''); }
  }

  async function findConcerts() {
    setLoading('Checking Spotify concert pages'); setError('');
    try { const data = await fetch(`${API}/spotify-concerts`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ artistIds: selected }) }).then(readJson); setEvents(data.events || []); }
    catch (e) { setError(e.message); } finally { setLoading(''); }
  }

  useEffect(() => {
    if (auth.authenticated && token && !artists.length && !loading) loadArtists();
  }, [auth.authenticated, token]);

  const visibleArtists = useMemo(() => {
    const query = artistSearch.trim().toLowerCase();
    return artists
      .filter(artist => !query || String(artist.name || '').toLowerCase().includes(query))
      .sort((a, b) => {
        const aSelected = selected.includes(a.id) ? 0 : 1;
        const bSelected = selected.includes(b.id) ? 0 : 1;
        if (aSelected !== bSelected) return aSelected - bSelected;
        return String(a.name || '').localeCompare(String(b.name || ''));
      });
  }, [artists, selected, artistSearch]);

  function selectVisibleArtists() {
    setSelected(current => [...new Set([...current, ...visibleArtists.map(artist => artist.id).filter(Boolean)])]);
  }

  function deselectVisibleArtists() {
    const visibleIds = new Set(visibleArtists.map(artist => artist.id));
    setSelected(current => current.filter(id => !visibleIds.has(id)));
  }

  if (!auth.authenticated) return <LoginScreen auth={auth} />;

  return <main>
    <section className="hero"><div><p className="eyebrow">Connected as {auth.user?.display_name || auth.user?.id}</p><h1>Your Spotify radar</h1><p>Your artists load automatically. Pick the ones you care about, then pull their latest Spotify releases.</p></div><button className="ghost" onClick={() => { localStorage.removeItem('spotify_access_token'); setToken(''); }}>Sign out</button></section>
    {error && <div className="notice error">{error}</div>}{loading && <div className="notice">{loading}...</div>}
    <section className="grid"><aside className="card"><h2>Actions</h2><p>This scrapes Spotify's own concert data and formats the results here.</p><button onClick={loadArtists}>Refresh artists</button><button onClick={findConcerts} disabled={!selected.length}>Find Spotify concerts</button></aside><section className="card"><div className="artistHeader"><div><h2>Artists</h2><p>{selected.length} selected. Selected artists stay on top.</p></div><div className="artistTools"><input value={artistSearch} onChange={e => setArtistSearch(e.target.value)} placeholder="Search artists" aria-label="Search artists" /><button className="ghost" onClick={selectVisibleArtists} disabled={!visibleArtists.length}>Select shown</button><button className="ghost" onClick={deselectVisibleArtists} disabled={!visibleArtists.length}>Deselect shown</button></div></div><div className="chips">{visibleArtists.map(a => <button key={a.id || a.name} className={`chip ${selected.includes(a.id) ? 'on' : ''}`} onClick={() => setSelected(s => s.includes(a.id) ? s.filter(x => x !== a.id) : [...s, a.id])}>{a.name}</button>)}</div></section></section>
    <section className="results eventGrid">{events.map(e => <a className="event" href={e.url} target="_blank" rel="noreferrer" key={e.id}><span>{e.date ? new Date(e.date).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Date TBA'}</span><h3>{e.name}</h3><p>{e.city || 'Location TBA'}</p><p>{(e.lineup || [e.artist]).join(', ')}</p></a>)}</section>
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);
