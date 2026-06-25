import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { motion } from 'framer-motion';
import { Music2, MapPin, LogOut, Search, CalendarDays, Ticket, RefreshCw, X, Check } from 'lucide-react';
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

const CORAL_ICON = () => window.L.divIcon({
  className: 'border-0 bg-transparent',
  html: '<div class="pin-teardrop"></div>',
  iconSize: [18, 18], iconAnchor: [9, 18], popupAnchor: [0, -18]
});

function ConcertMap({ events }) {
  const containerRef = React.useRef(null);
  const mapRef = React.useRef(null);
  const layerRef = React.useRef(null);
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (!window.L || !containerRef.current || mapRef.current) return;
    const map = window.L.map(containerRef.current, { worldCopyJump: true, zoomControl: false }).setView([30, 5], 3);
    window.L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO', maxZoom: 19, subdomains: 'abcd'
    }).addTo(map);
    window.L.control.zoom({ position: 'bottomright' }).addTo(map);
    mapRef.current = map;
    layerRef.current = window.L.layerGroup().addTo(map);
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function plot() {
      const map = mapRef.current, layer = layerRef.current;
      if (!map || !layer) return;
      map.invalidateSize();
      layer.clearLayers();
      const cache = loadGeocodeCache();
      const bounds = [];
      let placed = 0;
      const cities = [...new Set(events.filter(e => e.lat == null || e.lon == null).map(e => String(e.city || '').trim()).filter(Boolean))];
      const uncached = cities.filter(c => !(c.toLowerCase() in cache));
      if (uncached.length) setStatus(`Placing ${uncached.length} new ${uncached.length === 1 ? 'city' : 'cities'} on the map`);
      for (const event of events) {
        if (cancelled) return;
        const hasCoords = event.lat != null && event.lon != null;
        const wasUncached = !hasCoords && event.city && !(String(event.city).trim().toLowerCase() in cache);
        const coords = hasCoords ? { lat: event.lat, lon: event.lon } : await geocodeCity(event.city, cache);
        if (cancelled) return;
        if (!coords) continue;
        const when = `${event.dayLabel ? event.dayLabel + ' ' : ''}${event.date ? new Date(event.date).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric' }) : 'Date TBA'}`;
        const lineup = (event.lineup || [event.artist]).join(', ');
        const where = [event.venue, event.city, event.country].filter(Boolean).join(', ') || 'Location TBA';
        const vendor = event.ticketVendor ? `<br><em style="color:#8B8389">${event.onSale ? 'On sale' : 'Tickets'} · ${event.ticketVendor}</em>` : '';
        const img = event.image ? `<img src="${event.image}" alt="" style="width:100%;height:96px;object-fit:cover;border-radius:8px;margin-bottom:8px">` : '';
        const popup = `${img}<strong style="font-family:'Cabinet Grotesk',sans-serif;font-size:16px">${event.name || event.artist}</strong><br><span style="font-family:'JetBrains Mono',monospace;font-size:12px;color:#FF5A3C">${when}</span><br><span style="font-family:'JetBrains Mono',monospace;font-size:12px;color:#8B8389">${where}</span><br><span style="font-size:13px">${lineup}</span>${vendor}<br><a href="${event.ticketUrl || event.url}" target="_blank" rel="noreferrer">Tickets →</a>`;
        window.L.marker([coords.lat, coords.lon], { icon: CORAL_ICON() }).bindPopup(popup).addTo(layer);
        bounds.push([coords.lat, coords.lon]);
        placed++;
        if (wasUncached) await new Promise(r => setTimeout(r, 1100));
      }
      if (cancelled) return;
      if (bounds.length) { map.invalidateSize(); map.fitBounds(bounds, { padding: [50, 50], maxZoom: 6 }); }
      setStatus(placed ? '' : 'No shows could be placed on the map yet.');
    }
    plot();
    return () => { cancelled = true; };
  }, [events]);

  return (
    <div className="relative">
      {!window.L && <div className="mb-3 rounded-md border border-ember/40 bg-ember/10 px-4 py-3 text-sm text-ember">Map library failed to load. Check your connection and reload.</div>}
      {status && <div className="absolute left-4 top-4 z-[500] rounded-full border border-line bg-canvas/70 px-3 py-1.5 font-mono text-xs text-muted backdrop-blur">{status}…</div>}
      <div ref={containerRef} className="h-[70vh] min-h-[420px] w-full overflow-hidden rounded-lg border border-line" />
    </div>
  );
}

function Pill({ children, className = '' }) {
  return <span className={`inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 font-mono text-xs text-muted ${className}`}>{children}</span>;
}

function LoginScreen({ auth }) {
  return (
    <main className="grid min-h-screen place-items-center px-6">
      <div className="w-full max-w-xl text-center">
        <div className="mb-6 inline-flex items-center gap-2 font-display text-lg font-extrabold tracking-tight">
          <span className="h-3 w-3 rounded-full bg-ember shadow-[0_0_18px_#FF5A3C]" /> Show Finder
        </div>
        <div className="rounded-lg border border-line bg-surface/70 p-8 backdrop-blur md:p-12">
          <p className="font-mono text-xs uppercase tracking-[0.22em] text-teal">Concerts from your Spotify</p>
          <h1 className="mt-3 font-display text-5xl font-extrabold leading-[0.95] tracking-tight md:text-6xl">
            Your music,<br /><span className="text-ember">made physical.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-md text-lg text-muted">Connect Spotify and we'll map every upcoming show from the artists you actually listen to.</p>
          {auth.loading && <p className="mt-6 font-mono text-sm text-muted">Checking Spotify connection…</p>}
          {!auth.loading && !auth.setupReady && (
            <div className="mt-6 rounded-md border border-ember/40 bg-ember/10 px-4 py-3 text-left text-sm text-ember">
              <strong className="block">Spotify isn't configured yet.</strong>
              <span className="text-ember/80">Add server-side Spotify credentials to your .env, restart, and come back.</span>
            </div>
          )}
          {auth.message && <div className="mt-6 rounded-md border border-ember/40 bg-ember/10 px-4 py-3 text-sm text-ember">{auth.message}</div>}
          <a
            href={`${API}/auth/login`}
            onClick={e => { if (!auth.setupReady) e.preventDefault(); }}
            className={`mt-7 inline-flex items-center gap-2 rounded-full bg-ember px-7 py-3.5 font-semibold text-canvas transition hover:-translate-y-0.5 ${!auth.setupReady ? 'pointer-events-none opacity-50' : ''}`}
          >
            <Music2 size={18} /> Continue with Spotify
          </a>
          <p className="mx-auto mt-6 max-w-md font-mono text-xs text-muted">We only read your followed artists and saved tracks. No passwords, no tokens.</p>
        </div>
      </div>
    </main>
  );
}

function ArtistRail({ artists, selected, toggle }) {
  if (!artists.length) return null;
  return (
    <div className="flex max-h-[300px] flex-wrap gap-x-4 gap-y-5 overflow-y-auto pr-1">
      {artists.map((a, i) => {
        const on = selected.includes(a.id);
        return (
          <button
            key={a.id || a.name}
            onClick={() => toggle(a.id)}
            aria-pressed={on}
            className={`w-[78px] flex-none text-center transition ${on ? '' : 'opacity-50 hover:opacity-100'}`}
          >
            <div className={`relative mx-auto grid h-[78px] w-[78px] place-items-center overflow-hidden rounded-full bg-surface2 font-display text-2xl font-extrabold text-muted ${on ? 'shadow-[0_0_0_3px_var(--color-ember)]' : 'shadow-[0_0_0_1px_var(--color-line)]'}`}>
              {a.image ? <img src={a.image} alt={a.name} loading="lazy" className="h-full w-full object-cover" /> : (a.name?.[0] || '?')}
              {on && <span className="absolute -bottom-0.5 -right-0.5 grid h-6 w-6 place-items-center rounded-full border-2 border-surface bg-ember text-canvas"><Check size={13} strokeWidth={3} /></span>}
            </div>
            <div className={`mt-1.5 font-mono text-[10px] ${on ? 'text-ember' : 'text-muted'}`}>#{i + 1}</div>
            <div className={`truncate text-xs ${on ? 'font-semibold text-ink' : 'text-muted'}`}>{a.name}</div>
          </button>
        );
      })}
    </div>
  );
}

function ShowCard({ e, i }) {
  const date = `${e.dayLabel ? e.dayLabel.toUpperCase() + ' · ' : ''}${e.date ? new Date(e.date).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Date TBA'}`;
  const where = [e.venue, e.city, e.country].filter(Boolean).join(', ') || 'Location TBA';
  return (
    <motion.a
      href={e.ticketUrl || e.url} target="_blank" rel="noreferrer"
      initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: 'easeOut', delay: Math.min(i * 0.04, 0.4) }}
      whileHover={{ y: -3 }}
      className="group block overflow-hidden rounded-md border border-line bg-surface transition-colors hover:border-ember/50"
    >
      {e.image
        ? <img src={e.image} alt={e.artist} loading="lazy" decoding="async" width="320" height="150" className="h-[150px] w-full object-cover" />
        : <div className="h-[150px] w-full bg-gradient-to-br from-surface2 to-[#171a22]" />}
      <div className="p-[18px]">
        <div className="font-mono text-xs tracking-wide text-ember">{date}</div>
        <h3 className="mt-1.5 font-display text-xl font-bold tracking-tight">{e.name}</h3>
        <div className="mt-1 font-mono text-xs text-muted">{where}</div>
        {e.genres?.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {e.genres.slice(0, 4).map(g => <span key={g} className="rounded-full border border-teal/30 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-teal">{g}</span>)}
          </div>
        )}
        <div className="ticket-stub mt-3.5 flex items-center justify-between pt-3.5">
          <span className="font-mono text-[11px] text-ink">{e.ticketVendor ? <>{e.onSale ? 'on sale' : 'tickets'} · <b className="text-ember">{e.ticketVendor}</b></> : 'view show'}</span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-ember px-3.5 py-2 text-[13px] font-semibold text-canvas">
            <Ticket size={13} /> Tickets
          </span>
        </div>
      </div>
    </motion.a>
  );
}

function App() {
  const [auth, setAuth] = useState(initialAuth);
  const [token, setToken] = useState(localStorage.getItem('spotify_access_token') || '');
  const [artists, setArtists] = useState([]);
  const [selected, setSelected] = useState([]);
  const [events, setEvents] = useState([]);
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

  const shownEvents = useMemo(() => events.filter(e => {
    if (e.artistId && !selected.includes(e.artistId)) return false;
    const day = String(e.date || '').slice(0, 10);
    if (filters.startDate && (!day || day < filters.startDate)) return false;
    if (filters.endDate && (!day || day > filters.endDate)) return false;
    return true;
  }), [events, selected, filters.startDate, filters.endDate]);

  function toggleArtist(id) { setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]); }
  function selectVisibleArtists() {
    setSelected(current => [...new Set([...current, ...visibleArtists.map(artist => artist.id).filter(Boolean)])]);
  }
  function deselectVisibleArtists() {
    const visibleIds = new Set(visibleArtists.map(artist => artist.id));
    setSelected(current => current.filter(id => !visibleIds.has(id)));
  }

  if (!auth.authenticated) return <LoginScreen auth={auth} />;

  const inputCls = 'w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm text-ink outline-none [color-scheme:dark] focus:border-ember';
  const ghostCls = 'inline-flex items-center justify-center gap-1.5 rounded-full border border-line px-3 py-2 text-sm text-ink transition hover:border-ember/60 disabled:opacity-40';

  return (
    <main className="mx-auto w-[min(1180px,94vw)] pb-20 pt-7">
      {/* Top bar */}
      <div className="mb-7 flex items-center justify-between">
        <div className="flex items-center gap-2 font-display text-xl font-extrabold tracking-tight">
          <span className="h-3 w-3 rounded-full bg-ember shadow-[0_0_18px_#FF5A3C]" /> Show Finder
        </div>
        <button onClick={() => { localStorage.removeItem('spotify_access_token'); setToken(''); }} className={ghostCls}>
          <LogOut size={15} /> {auth.user?.display_name || auth.user?.id}
        </button>
      </div>

      {/* Hero */}
      <section>
        <p className="font-mono text-xs uppercase tracking-[0.22em] text-teal">your concert radar</p>
        <h1 className="mt-1.5 font-display text-5xl font-extrabold leading-[0.92] tracking-tight md:text-7xl">
          Your music, <span className="text-ember">made physical.</span>
        </h1>
        <p className="mt-3 max-w-xl text-lg text-muted">The artists you actually listen to — and exactly where to catch them live.</p>
      </section>

      {error && <div className="mt-5 rounded-md border border-ember/40 bg-ember/10 px-4 py-3 text-sm text-ember">{error}</div>}
      {loading && <div className="mt-5 rounded-md border border-line bg-surface px-4 py-3 font-mono text-sm text-muted">{loading}…</div>}

      {/* Controls */}
      <section className="mt-7 grid items-start gap-6 lg:grid-cols-[320px_1fr]">
        <aside className="rounded-lg border border-line bg-surface/70 p-5 backdrop-blur">
          <h2 className="font-display text-lg font-bold">Actions</h2>
          <p className="mt-1 text-sm text-muted">Pick your artists, then pull their upcoming shows.</p>
          <div className="mt-4 grid gap-2">
            <button onClick={loadArtists} className={ghostCls}><RefreshCw size={15} /> Refresh artists</button>
            <button onClick={findConcerts} disabled={!selected.length} className="inline-flex items-center justify-center gap-2 rounded-full bg-ember px-4 py-2.5 font-semibold text-canvas transition hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-40">
              <MapPin size={16} /> Find concerts
            </button>
          </div>
          <div className="mt-4">
            <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">Select top</div>
            <div className="mt-2 flex gap-1.5">
              {[20, 40, 50, 100].map(n => <button key={n} disabled={!artists.length} onClick={() => setSelected(artists.slice(0, n).map(a => a.id))} className={`flex-1 ${ghostCls}`}>{n}</button>)}
            </div>
          </div>
          <div className="mt-4 grid gap-2.5 border-t border-line pt-4">
            <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted flex items-center gap-1.5"><CalendarDays size={13} /> Date range</div>
            <label className="grid gap-1"><span className="font-mono text-[11px] text-muted">From</span><input type="date" value={filters.startDate} onChange={e => setFilters(f => ({ ...f, startDate: e.target.value }))} className={inputCls} /></label>
            <label className="grid gap-1"><span className="font-mono text-[11px] text-muted">To</span><input type="date" value={filters.endDate} onChange={e => setFilters(f => ({ ...f, endDate: e.target.value }))} className={inputCls} /></label>
            {(filters.startDate || filters.endDate) && <button onClick={() => setFilters(f => ({ ...f, startDate: '', endDate: '' }))} className={ghostCls}><X size={14} /> Clear dates</button>}
          </div>
        </aside>

        <section className="rounded-lg border border-line bg-surface/70 p-5 backdrop-blur">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-bold">Your artists</h2>
              <p className="font-mono text-xs text-muted">{selected.length} selected · ranked by listening</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input value={artistSearch} onChange={e => setArtistSearch(e.target.value)} placeholder="Search" aria-label="Search artists" className={`${inputCls} pl-8`} />
              </div>
              <button onClick={selectVisibleArtists} disabled={!visibleArtists.length} className={`${ghostCls} whitespace-nowrap`}>Select shown</button>
              <button onClick={deselectVisibleArtists} disabled={!visibleArtists.length} className={`${ghostCls} whitespace-nowrap`}>Clear shown</button>
            </div>
          </div>
          <ArtistRail artists={visibleArtists} selected={selected} toggle={toggleArtist} />
        </section>
      </section>

      {/* Results — map always on top, cards below */}
      {shownEvents.length > 0 && (
        <>
          <section className="mt-8">
            <div className="mb-3 flex items-baseline gap-2">
              <h2 className="font-display text-lg font-bold">On the map</h2>
              <span className="font-mono text-xs text-muted">{shownEvents.length} {shownEvents.length === 1 ? 'show' : 'shows'}</span>
            </div>
            <ConcertMap events={shownEvents} />
          </section>
          <section className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {shownEvents.map((e, i) => <ShowCard key={e.id} e={e} i={i} />)}
          </section>
        </>
      )}
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
