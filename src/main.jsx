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

const GEOCODE_CACHE_KEY = 'geocode_cache_v1';

function loadGeocodeCache() {
  try { return JSON.parse(localStorage.getItem(GEOCODE_CACHE_KEY) || '{}'); }
  catch { return {}; }
}

function saveGeocodeCache(cache) {
  try { localStorage.setItem(GEOCODE_CACHE_KEY, JSON.stringify(cache)); } catch {}
}

// City string -> {lat, lon} via Nominatim, cached in localStorage.
// Returns null for empty/unresolvable cities. Caches misses too (as null) so
// we never re-hit the network for a city Nominatim can't place.
async function geocodeCity(city, cache) {
  const key = String(city || '').trim().toLowerCase();
  if (!key) return null;
  if (key in cache) return cache[key];
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(city)}`;
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    const data = await res.json().catch(() => []);
    const hit = data[0];
    cache[key] = hit ? { lat: Number(hit.lat), lon: Number(hit.lon) } : null;
  } catch {
    cache[key] = null;
  }
  saveGeocodeCache(cache);
  return cache[key];
}

function ConcertMap({ events }) {
  const containerRef = React.useRef(null);
  const mapRef = React.useRef(null);
  const layerRef = React.useRef(null);
  const [status, setStatus] = useState('');

  // Init the Leaflet map once.
  useEffect(() => {
    if (!window.L || !containerRef.current || mapRef.current) return;
    const map = window.L.map(containerRef.current, { worldCopyJump: true }).setView([20, 0], 2);
    window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap', maxZoom: 18
    }).addTo(map);
    mapRef.current = map;
    layerRef.current = window.L.layerGroup().addTo(map);
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Geocode + plot whenever events change. Nominatim asks for <=1 req/s, so we
  // queue lookups serially with a small gap; the cache makes repeats free.
  useEffect(() => {
    let cancelled = false;
    async function plot() {
      const map = mapRef.current, layer = layerRef.current;
      if (!map || !layer) return;
      layer.clearLayers();
      const cache = loadGeocodeCache();
      const bounds = [];
      let placed = 0;
      const cities = [...new Set(events.map(e => String(e.city || '').trim()).filter(Boolean))];
      const uncached = cities.filter(c => !(c.toLowerCase() in cache));
      if (uncached.length) setStatus(`Placing ${uncached.length} new ${uncached.length === 1 ? 'city' : 'cities'} on the map`);
      for (const event of events) {
        if (cancelled) return;
        // Prefer exact coordinates from the detail data; geocode the city only as fallback.
        const hasCoords = event.lat != null && event.lon != null;
        const wasUncached = !hasCoords && event.city && !(String(event.city).trim().toLowerCase() in cache);
        const coords = hasCoords ? { lat: event.lat, lon: event.lon } : await geocodeCity(event.city, cache);
        if (cancelled) return;
        if (!coords) continue;
        const when = `${event.dayLabel ? event.dayLabel + ' ' : ''}${event.date ? new Date(event.date).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric' }) : 'Date TBA'}`;
        const lineup = (event.lineup || [event.artist]).join(', ');
        const where = [event.venue, event.city, event.country].filter(Boolean).join(', ') || 'Location TBA';
        const vendor = event.ticketVendor ? `<br><em>${event.onSale ? 'On sale' : 'Tickets'} · ${event.ticketVendor}</em>` : '';
        const img = event.image ? `<img src="${event.image}" alt="" style="width:100%;height:96px;object-fit:cover;border-radius:8px;margin-bottom:6px">` : '';
        const popup = `${img}<strong>${event.name || event.artist}</strong><br>${when}<br>${where}<br>${lineup}${vendor}<br><a href="${event.url}" target="_blank" rel="noreferrer">Open in Spotify</a>`;
        window.L.marker([coords.lat, coords.lon]).bindPopup(popup).addTo(layer);
        bounds.push([coords.lat, coords.lon]);
        placed++;
        if (wasUncached) await new Promise(r => setTimeout(r, 1100));
      }
      if (cancelled) return;
      if (bounds.length) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 6 });
      setStatus(placed ? '' : 'No shows could be placed on the map yet.');
    }
    plot();
    return () => { cancelled = true; };
  }, [events]);

  return <div className="mapWrap">
    {!window.L && <div className="notice error">Map library failed to load. Check your connection and reload.</div>}
    {status && <div className="notice">{status}...</div>}
    <div className="map" ref={containerRef} />
  </div>;
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
  const [view, setView] = useState('list');

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
    try { const data = await fetch(`${API}/artists`, { headers: { authorization: `Bearer ${token}` } }).then(readJson); setArtists(data.artists || []); }
    catch (e) { setError(e.message); } finally { setLoading(''); }
  }

  async function findConcerts() {
    setLoading('Loading your shows'); setError('');
    try {
      const data = await fetch(`${API}/spotify-concerts`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ artistIds: selected }) }).then(readJson);
      const list = data.events || [];
      setEvents(list);
      setLoading('');
      // Background enrich: venue/genres/vendor/coords fill in without blocking.
      if (list.length) {
        fetch(`${API}/concert-detail`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ concerts: list.map(e => ({ id: e.id, url: e.url })) }) })
          .then(readJson)
          .then(({ details }) => setEvents(cur => cur.map(e => details?.[e.id] ? { ...e, ...details[e.id], image: e.image || details[e.id].image } : e)))
          .catch(() => {});
      }
    } catch (e) { setError(e.message); setLoading(''); }
  }

  useEffect(() => {
    if (auth.authenticated && token && !artists.length && !loading) loadArtists();
  }, [auth.authenticated, token]);

  const visibleArtists = useMemo(() => {
    const query = artistSearch.trim().toLowerCase();
    // artists arrive ranked by listening affinity from the server; keep that order
    // within the selected/unselected groups (selected stay on top).
    const rank = new Map(artists.map((a, i) => [a.id, i]));
    return artists
      .filter(artist => !query || String(artist.name || '').toLowerCase().includes(query))
      .sort((a, b) => {
        const aSelected = selected.includes(a.id) ? 0 : 1;
        const bSelected = selected.includes(b.id) ? 0 : 1;
        if (aSelected !== bSelected) return aSelected - bSelected;
        return (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0);
      });
  }, [artists, selected, artistSearch]);

  // Only show shows whose artist is still selected and that fall in the date range.
  const shownEvents = useMemo(() => events.filter(e => {
    if (e.artistId && !selected.includes(e.artistId)) return false;
    const day = String(e.date || '').slice(0, 10);
    if (filters.startDate && (!day || day < filters.startDate)) return false;
    if (filters.endDate && (!day || day > filters.endDate)) return false;
    return true;
  }), [events, selected, filters.startDate, filters.endDate]);

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
    <section className="grid"><aside className="card"><h2>Actions</h2><p>This scrapes Spotify's own concert data and formats the results here.</p><button onClick={loadArtists}>Refresh artists</button><button onClick={findConcerts} disabled={!selected.length}>Find Spotify concerts</button>
      <div className="topSelect"><span>Select top</span>{[20, 40, 50, 100].map(n => <button key={n} className="ghost" disabled={!artists.length} onClick={() => setSelected(artists.slice(0, n).map(a => a.id))}>{n}</button>)}</div>
      <div className="dateFilter"><label><span>From</span><input type="date" value={filters.startDate} onChange={e => setFilters(f => ({ ...f, startDate: e.target.value }))} /></label><label><span>To</span><input type="date" value={filters.endDate} onChange={e => setFilters(f => ({ ...f, endDate: e.target.value }))} /></label>{(filters.startDate || filters.endDate) && <button className="ghost" onClick={() => setFilters(f => ({ ...f, startDate: '', endDate: '' }))}>Clear dates</button>}</div>
    </aside><section className="card"><div className="artistHeader"><div><h2>Artists</h2><p>{selected.length} selected. Selected artists stay on top.</p></div><div className="artistTools"><input value={artistSearch} onChange={e => setArtistSearch(e.target.value)} placeholder="Search artists" aria-label="Search artists" /><button className="ghost" onClick={selectVisibleArtists} disabled={!visibleArtists.length}>Select shown</button><button className="ghost" onClick={deselectVisibleArtists} disabled={!visibleArtists.length}>Deselect shown</button></div></div><div className="chips">{visibleArtists.map(a => <button key={a.id || a.name} className={`chip ${selected.includes(a.id) ? 'on' : ''}`} onClick={() => setSelected(s => s.includes(a.id) ? s.filter(x => x !== a.id) : [...s, a.id])}>{a.name}</button>)}</div></section></section>
    {shownEvents.length > 0 && <div className="viewToggle"><button className={`ghost ${view === 'list' ? 'on' : ''}`} onClick={() => setView('list')}>List</button><button className={`ghost ${view === 'map' ? 'on' : ''}`} onClick={() => setView('map')}>Map</button></div>}
    {view === 'map'
      ? <section className="results"><ConcertMap events={shownEvents} /></section>
      : <section className="results eventGrid">{shownEvents.map(e => <a className="event" href={e.url} target="_blank" rel="noreferrer" key={e.id}>
          {e.image && <img className="eventImg" src={e.image} alt={e.artist} loading="lazy" decoding="async" width="320" height="150" />}
          <span>{e.dayLabel ? `${e.dayLabel} · ` : ''}{e.date ? new Date(e.date).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Date TBA'}</span>
          <h3>{e.name}</h3>
          <p>{[e.venue, e.city, e.country].filter(Boolean).join(', ') || 'Location TBA'}</p>
          <p>{(e.lineup || [e.artist]).join(', ')}</p>
          {e.genres?.length > 0 && <div className="genres">{e.genres.slice(0, 4).map(g => <span className="genre" key={g}>{g}</span>)}</div>}
          {e.ticketVendor && <span className="vendor">{e.onSale ? 'On sale' : 'Tickets'} · {e.ticketVendor}</span>}
        </a>)}</section>}
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);
