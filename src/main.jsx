import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { motion } from 'framer-motion';
import { Music2, MapPin, LogOut, Search, CalendarDays, Ticket, RefreshCw, X, Check, Filter, Globe } from 'lucide-react';
import { COUNTRIES, CONTINENTS, countriesInContinent, continentOf } from './regions';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { ScatterplotLayer, PolygonLayer } from '@deck.gl/layers';
import { HeatmapLayer } from '@deck.gl/aggregation-layers';
import { TerraDraw, TerraDrawFreehandMode } from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
import './styles.css';

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
// Bold teal -> cyan ramp for the density heatmap.
const HEAT_COLORS = [[8, 40, 40, 0], [30, 110, 104, 140], [91, 200, 194, 190], [120, 230, 224, 225], [190, 255, 250, 255]];

const API = import.meta.env.VITE_API_BASE || '/api';
const initialAuth = { loading: true, authenticated: false, user: null, setupReady: false, missing: [], message: '' };

// Format a show's date/time as the venue's LOCAL wall-clock (the offset baked into the
// ISO string) instead of converting to the viewer's timezone. withTime adds hour:minute.
function fmtShowDate(iso, withTime) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!m) return null;
  const [, Y, Mo, D, H, Mi] = m;
  const hasTime = withTime && H != null;
  const d = new Date(Date.UTC(+Y, +Mo - 1, +D, hasTime ? +H : 12, hasTime ? +Mi : 0));
  return d.toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', ...(hasTime ? { hour: 'numeric', minute: '2-digit' } : {}), timeZone: 'UTC' });
}

// Humanize a seconds count for rate-limit cooldown messages.
function formatWait(secs) {
  if (secs >= 3600) return `${Math.ceil(secs / 3600)}h`;
  if (secs >= 60) return `${Math.ceil(secs / 60)}m`;
  return `${secs}s`;
}

// Cache the artist list + fetched shows so a page reload restores instantly
// without re-hitting Spotify (the source of rate-limit bans). Refresh forces a
// refetch. Keyed by user id so switching accounts doesn't show stale data.
const SHOW_CACHE_KEY = 'showfinder_cache_v5';
const SHOW_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
function loadShowCache(userId) {
  try {
    const raw = JSON.parse(localStorage.getItem(SHOW_CACHE_KEY) || 'null');
    if (!raw || Date.now() - raw.at > SHOW_CACHE_TTL_MS) return null;
    if (userId && raw.userId && raw.userId !== userId) return null;
    return raw;
  } catch { return null; }
}
function saveShowCache(userId, artists, events) {
  try { localStorage.setItem(SHOW_CACHE_KEY, JSON.stringify({ at: Date.now(), userId: userId || null, artists, events })); }
  catch { /* quota exceeded — skip caching, not fatal */ }
}

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

// Location string -> {lat, lon} via Nominatim, cached in localStorage. Network calls
// are paced to Nominatim's ~1 req/sec policy.
let lastGeoAt = 0;
async function geocodeQuery(q, cache) {
  const key = String(q || '').trim().toLowerCase();
  if (!key) return null;
  if (key in cache) return cache[key];
  const wait = 1100 - (Date.now() - lastGeoAt);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastGeoAt = Date.now();
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
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

// Resolve an event's coordinates from the richest available location, with fallbacks.
// Festival/3rd-party-ticketed shows (e.g. Fever) often have an empty city but a real
// venue + country, so we try venue+city+country first, then progressively looser queries.
async function geocodeEvent(event, cache) {
  const candidates = [
    [event.venue, event.city, event.country],
    [event.city, event.country],
    [event.venue, event.country],
    [event.venue, event.city],
    [event.city],
    [event.venue]
  ];
  const seen = new Set();
  for (const parts of candidates) {
    const q = parts.map(p => String(p || '').trim()).filter(Boolean).join(', ');
    if (!q || seen.has(q.toLowerCase())) continue;
    seen.add(q.toLowerCase());
    const r = await geocodeQuery(q, cache);
    if (r) return r;
  }
  return null;
}

// Map an affinity rank (0 = most liked) to a base dot diameter.
const dotSizeForRank = (rank) =>
  rank == null ? 12 : rank < 5 ? 24 : rank < 15 ? 20 : rank < 40 ? 16 : 12;

// Popup HTML for a show — built lazily on open (see bindPopup callback).
function buildPopupHtml(event, nameById) {
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const when = `${event.dayLabel ? event.dayLabel + ' ' : ''}${fmtShowDate(event.date, false) || 'Date TBA'}`;
  const artistName = (nameById && nameById.get(event.artistId)) || '';
  const lineupArr = (event.lineup || [event.artist]).filter(Boolean);
  const isMulti = lineupArr.length > 1;
  const titleIsLineup = isMulti && (event.name || '').length > 36;
  const headline = titleIsLineup ? (event.venue || `${artistName || lineupArr[0]} + ${lineupArr.length - 1} more`) : (event.name || event.artist);
  const ordered = artistName ? [artistName, ...lineupArr.filter(n => n !== artistName)] : lineupArr;
  const lineupStr = ordered.slice(0, 6).join(' · ') + (ordered.length > 6 ? ` +${ordered.length - 6} more` : '');
  const where = (titleIsLineup ? [event.city, event.country] : [event.venue, event.city, event.country]).filter(Boolean).join(', ') || 'Location TBA';
  const badge = artistName ? `<div style="font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;color:#FF5A3C;margin-bottom:4px">♪ ${esc(artistName)}</div>` : '';
  const lineupLine = isMulti ? `<br><span style="font-size:12px;color:#8B8389"><b style="color:#F4EFEA">+${lineupArr.length} acts:</b> ${esc(lineupStr)}</span>` : '';
  const vendor = event.ticketVendor ? `<br><em style="color:#8B8389">${event.onSale ? 'On sale' : 'Tickets'} · ${esc(event.ticketVendor)}</em>` : '';
  const img = event.image ? `<img src="${esc(event.image)}" alt="" style="width:100%;height:96px;object-fit:cover;border-radius:8px;margin-bottom:8px">` : '';
  return `${img}${badge}<strong style="font-family:'Cabinet Grotesk',sans-serif;font-size:16px">${esc(headline)}</strong><br><span style="font-family:'JetBrains Mono',monospace;font-size:12px;color:#FF5A3C">${esc(when)}</span><br><span style="font-family:'JetBrains Mono',monospace;font-size:12px;color:#8B8389">${esc(where)}</span>${lineupLine}${vendor}<br><a href="${esc(event.ticketUrl || event.url)}" target="_blank" rel="noreferrer">Tickets →</a>`;
}

// Ray-casting point-in-polygon. poly = [{lat, lng}, ...].
function pointInPolygon(lat, lng, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].lng, yi = poly[i].lat, xj = poly[j].lng, yj = poly[j].lat;
    if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

// Distance (km) from a point to a polygon edge, via a local equirectangular projection
// (accurate enough at a ~20km scale). Used to forgive shows just outside the drawn area.
const AREA_BUFFER_KM = 20;
function pointNearPolygon(lat, lng, poly, bufferKm = AREA_BUFFER_KM) {
  if (pointInPolygon(lat, lng, poly)) return true;
  const kx = 111.32 * Math.cos(lat * Math.PI / 180), ky = 110.57;
  const px = lng * kx, py = lat * ky;
  let min = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const ax = poly[j].lng * kx, ay = poly[j].lat * ky, bx = poly[i].lng * kx, by = poly[i].lat * ky;
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / ((dx * dx + dy * dy) || 1)));
    min = Math.min(min, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
  }
  return min <= bufferKm;
}

function ConcertMap({ events, nameById, rankById, drawMode, polygon, onPolygon, onCoords, hoveredId }) {
  const containerRef = React.useRef(null);
  const mapRef = React.useRef(null);
  const overlayRef = React.useRef(null);
  const popupRef = React.useRef(null);
  const nameByIdRef = React.useRef(nameById);
  nameByIdRef.current = nameById;
  const cbRef = React.useRef({ onPolygon, onCoords });
  cbRef.current = { onPolygon, onCoords };
  const [placed, setPlaced] = useState([]); // events with resolved {lat,lng}
  const [ready, setReady] = useState(0);    // bumps when the map+overlay are live
  const [status, setStatus] = useState('');
  const [prog, setProg] = useState(1);   // 0..1 placement progress (1 = idle/done)
  const [spark, setSpark] = useState(false);
  const [done, setDone] = useState(false); // keep the full border after the sweep finishes
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [head, setHead] = useState(null); // comet-head point along the frame
  const pathRef = React.useRef(null);
  const sweepRef = React.useRef(0);

  // Smoothly trace the full frame 0->1 (easeOutCubic), then fire the completion spark.
  function runSweep() {
    cancelAnimationFrame(sweepRef.current);
    setSpark(false);
    setDone(false);
    setProg(0);
    const dur = 1100;
    let start = null;
    const step = (t) => {
      if (start == null) start = t;
      const k = Math.min(1, (t - start) / dur);
      setProg(1 - Math.pow(1 - k, 3));
      if (k < 1) sweepRef.current = requestAnimationFrame(step);
      else { setProg(1); setDone(true); setSpark(true); setTimeout(() => setSpark(false), 950); }
    };
    sweepRef.current = requestAnimationFrame(step);
  }

  // Init MapLibre GL + deck.gl overlay (single interleaved canvas) once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({ container: containerRef.current, style: MAP_STYLE, center: [5, 30], zoom: 1.4, attributionControl: true });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    popupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: '280px', className: 'show-popup' });
    const overlay = new MapboxOverlay({
      interleaved: true, layers: [],
      onClick: (info) => {
        if (info?.object && info.layer?.id === 'shows' && mapRef.current) {
          popupRef.current.setLngLat([info.object.lng, info.object.lat]).setHTML(buildPopupHtml(info.object, nameByIdRef.current)).addTo(mapRef.current);
        }
      }
    });
    overlayRef.current = overlay;
    map.on('load', () => { map.addControl(overlay); setReady(r => r + 1); });
    return () => { try { map.remove(); } catch {} mapRef.current = null; overlayRef.current = null; };
  }, []);

  // Geocode events -> resolved {lat,lng} list. Debounced so streamed loads settle once.
  useEffect(() => {
    let cancelled = false;
    async function resolve() {
      const cache = loadGeocodeCache();
      const coordsMap = new Map();
      const out = [];
      let unplaced = 0;
      const needsGeo = events.filter(e => e.lat == null || e.lon == null).length;
      if (needsGeo) setStatus('Placing shows on the map');
      for (const event of events) {
        if (cancelled) return;
        const hasCoords = event.lat != null && event.lon != null;
        const coords = hasCoords ? { lat: event.lat, lon: event.lon } : await geocodeEvent(event, cache);
        if (cancelled) return;
        if (!coords) { unplaced++; continue; }
        coordsMap.set(event.id, { lat: coords.lat, lng: coords.lon });
        out.push({ ...event, lat: coords.lat, lng: coords.lon });
      }
      if (cancelled) return;
      cbRef.current.onCoords?.(coordsMap);
      setPlaced(out);
      setStatus(!out.length && unplaced ? 'No shows could be placed on the map yet.'
        : unplaced ? `${unplaced} ${unplaced === 1 ? 'show has' : 'shows have'} no map location` : '');
      const map = mapRef.current;
      if (map && out.length) {
        let minX = 180, minY = 90, maxX = -180, maxY = -90;
        for (const e of out) { minX = Math.min(minX, e.lng); maxX = Math.max(maxX, e.lng); minY = Math.min(minY, e.lat); maxY = Math.max(maxY, e.lat); }
        try { map.fitBounds([[minX, minY], [maxX, maxY]], { padding: 60, maxZoom: 6, duration: 600 }); } catch {}
      }
      if (out.length) runSweep();
    }
    const t = setTimeout(resolve, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [events]);

  // Build deck.gl layers: bold teal heatmap (under) + affinity-sized ember dots + drawn area.
  const filtered = useMemo(
    () => (polygon?.length ? placed.filter(e => pointNearPolygon(e.lat, e.lng, polygon)) : placed),
    [placed, polygon]
  );
  const layers = useMemo(() => {
    const heat = new HeatmapLayer({
      id: 'heat', data: filtered, getPosition: e => [e.lng, e.lat], getWeight: 1,
      radiusPixels: 55, intensity: 1.4, threshold: 0.04, weightsTextureSize: 512,
      opacity: 0.6, colorRange: HEAT_COLORS, aggregation: 'SUM'
    });
    const shows = new ScatterplotLayer({
      id: 'shows', data: filtered, pickable: true, stroked: false, radiusUnits: 'pixels',
      getPosition: e => [e.lng, e.lat],
      getRadius: e => (dotSizeForRank(rankById?.get(e.artistId)) / 2) * (e.id === hoveredId ? 1.7 : 1),
      getFillColor: e => (e.id === hoveredId ? [255, 138, 82, 240] : [255, 90, 60, 130]),
      updateTriggers: { getRadius: hoveredId, getFillColor: hoveredId }
    });
    const area = polygon?.length ? new PolygonLayer({
      id: 'area', data: [polygon.map(p => [p.lng, p.lat])], getPolygon: d => d,
      stroked: true, filled: true, getFillColor: [255, 90, 60, 18],
      getLineColor: [255, 90, 60, 210], getLineWidth: 2, lineWidthUnits: 'pixels'
    }) : null;
    return [heat, shows, area].filter(Boolean);
  }, [filtered, hoveredId, rankById, polygon]);

  useEffect(() => { overlayRef.current?.setProps({ layers }); }, [layers, ready]);

  // Freehand area draw (terra-draw) while drawMode is on.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !drawMode || !ready) return;
    const draw = new TerraDraw({ adapter: new TerraDrawMapLibreGLAdapter({ map }), modes: [new TerraDrawFreehandMode()] });
    draw.start();
    draw.setMode('freehand');
    draw.on('finish', (id) => {
      const feature = draw.getSnapshot().find(f => f.id === id);
      const coords = feature?.geometry?.coordinates?.[0] || [];
      const ring = coords.map(([lng, lat]) => ({ lat, lng }));
      if (ring.length >= 3) cbRef.current.onPolygon?.(ring);
      try { draw.clear(); } catch {}
    });
    return () => { try { draw.stop(); } catch {} };
  }, [drawMode, ready]);

  // Track the map's real pixel size so the progress frame's corners stay crisp
  // (no viewBox stretching) on the tall rectangle.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !window.ResizeObserver) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Position the comet head at the leading edge of the progress trace.
  useEffect(() => {
    const p = pathRef.current;
    if (!p || prog <= 0 || prog >= 1) { setHead(null); return; }
    try {
      const pt = p.getPointAtLength(p.getTotalLength() * prog);
      setHead({ x: pt.x, y: pt.y });
    } catch { setHead(null); }
  }, [prog, size]);

  return (
    <div className="relative">
      {status && <div className="absolute left-4 top-4 z-[500] flex items-center gap-2 rounded-full border border-line bg-canvas/70 px-3 py-1.5 font-mono text-xs text-muted backdrop-blur">{status}… <span className="text-ember">{Math.round(prog * 100)}%</span></div>}
      <div ref={containerRef} className="h-[70vh] min-h-[420px] w-full overflow-hidden rounded-lg border border-line" />
      {/* Progress ring tracing the map frame (pixel-accurate corners) + comet head,
          and a spark burst at the start/end corner when it completes. */}
      {(prog < 1 || done) && size.w > 0 && (() => {
        const { w, h } = size, R = 14, IN = 2, W = w - IN * 2, H = h - IN * 2, CX = IN + W / 2;
        // Start/end at the middle of the top edge, tracing clockwise around the frame.
        const d = `M ${CX} ${IN} H ${IN + W - R} A ${R} ${R} 0 0 1 ${IN + W} ${IN + R} V ${IN + H - R} A ${R} ${R} 0 0 1 ${IN + W - R} ${IN + H} H ${IN + R} A ${R} ${R} 0 0 1 ${IN} ${IN + H - R} V ${IN + R} A ${R} ${R} 0 0 1 ${IN + R} ${IN} H ${CX}`;
        return (
          <svg className="pointer-events-none absolute inset-0 z-[550]" width={w} height={h} fill="none" aria-hidden="true">
            <defs>
              <linearGradient id="prog-grad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#FF5A3C" stopOpacity="0.2" />
                <stop offset="100%" stopColor="#FF8A52" stopOpacity="1" />
              </linearGradient>
            </defs>
            <path ref={pathRef} d={d} stroke="url(#prog-grad)" strokeWidth="2.5" strokeLinecap="round"
              pathLength="1" strokeDasharray="1" strokeDashoffset={Math.max(0, 1 - prog)}
              style={{ filter: 'drop-shadow(0 0 6px rgba(255,90,60,.6))' }} />
            {head && <circle cx={head.x} cy={head.y} r="3.5" fill="#FFE2B8" style={{ filter: 'drop-shadow(0 0 8px rgba(255,140,80,.95))' }} />}
          </svg>
        );
      })()}
      {spark && <span className="map-spark pointer-events-none absolute z-[560]" style={{ left: '50%', top: 2 }} aria-hidden="true" />}
    </div>
  );
}

function Pill({ children, className = '' }) {
  return <span className={`inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 font-mono text-xs text-muted ${className}`}>{children}</span>;
}

function LoginScreen({ auth, authError }) {
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
          {authError && <div className="mt-6 rounded-md border border-ember/40 bg-ember/10 px-4 py-3 text-sm text-ember">{authError}</div>}
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

function ArtistRail({ artists, selected, toggle, counts }) {
  if (!artists.length) return null;
  return (
    <div className="flex max-h-[320px] flex-wrap content-start gap-x-4 gap-y-5 overflow-y-auto px-1 pt-2 pr-1">
      {artists.map((a) => {
        const on = selected.includes(a.id);
        const count = counts[a.id] || 0;
        return (
          <button
            key={a.id || a.name}
            onClick={() => toggle(a.id)}
            aria-pressed={on}
            title={a.name}
            className="relative flex w-[84px] flex-none flex-col items-center text-center"
          >
            {/* Avatar (clips the photo) */}
            <div className={`relative grid h-[78px] w-[78px] place-items-center overflow-hidden rounded-full bg-surface2 font-display text-2xl font-extrabold text-muted ${on ? 'shadow-[0_0_0_3px_var(--color-ember)]' : 'shadow-[0_0_0_1px_var(--color-line)]'}`}>
              {/* Initial letter sits behind; the photo covers it. If the image fails
                  to load (or there is none), the letter shows through. */}
              <span className={on ? '' : 'opacity-50'}>{a.name?.[0] || '?'}</span>
              {a.image && (
                <img
                  src={a.image}
                  alt={a.name}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  onError={e => { e.currentTarget.style.display = 'none'; }}
                  className={`absolute inset-0 h-full w-full object-cover transition ${on ? '' : 'opacity-50'}`}
                />
              )}
            </div>
            {/* Count badge — outside the clipped avatar so it's always visible */}
            {count > 0 && <span className="absolute right-1 top-0 z-10 grid h-5 min-w-[20px] place-items-center rounded-full border-2 border-surface bg-ember px-1 font-mono text-[10px] font-bold text-canvas shadow">{count}</span>}
            {on && <span className="absolute right-1 top-[58px] z-10 grid h-6 w-6 place-items-center rounded-full border-2 border-surface bg-ember text-canvas"><Check size={13} strokeWidth={3} /></span>}
            <div className={`mt-1.5 text-xs leading-tight break-words ${on ? 'font-semibold text-ink' : 'text-muted'}`}>{a.name}</div>
          </button>
        );
      })}
    </div>
  );
}

function RegionBar({ regionSet, setRegionSet }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);

  const toggleCountry = (c) => setRegionSet(s => { const n = new Set(s); n.has(c) ? n.delete(c) : n.add(c); return n; });
  const continentState = (code) => {
    const cs = countriesInContinent(code);
    const on = cs.filter(c => regionSet.has(c)).length;
    return on === 0 ? 'none' : on === cs.length ? 'all' : 'some';
  };
  const toggleContinent = (code) => {
    const cs = countriesInContinent(code);
    const allOn = cs.every(c => regionSet.has(c));
    setRegionSet(s => { const n = new Set(s); cs.forEach(c => allOn ? n.delete(c) : n.add(c)); return n; });
  };

  const query = q.trim().toLowerCase();
  const results = query
    ? Object.keys(COUNTRIES).filter(c => COUNTRIES[c].name.toLowerCase().includes(query) || c.toLowerCase() === query).slice(0, 8)
    : [];
  // Individual chips only for countries whose continent isn't fully selected (the
  // continent chip already represents those), so picking a whole continent stays tidy.
  const chips = [...regionSet].filter(c => continentState(continentOf(c)) !== 'all');

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <span className="mr-1 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted"><Globe size={13} /> Region</span>
      {CONTINENTS.map(ct => {
        const st = continentState(ct.code);
        return (
          <button key={ct.code} onClick={() => toggleContinent(ct.code)}
            className={`rounded-full px-3 py-1.5 text-sm transition ${st === 'all' ? 'bg-ember text-canvas' : st === 'some' ? 'border border-ember text-ember' : 'border border-line text-muted hover:text-ink'}`}>
            {ct.name}
          </button>
        );
      })}
      <div className="relative">
        <input
          value={q} onChange={e => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="+ country" aria-label="Add country"
          className="w-32 rounded-full border border-line bg-canvas px-3 py-1.5 text-sm text-ink outline-none focus:border-ember"
        />
        {open && results.length > 0 && (
          <div className="absolute z-[600] mt-1 max-h-60 w-56 overflow-auto rounded-md border border-line bg-surface p-1 shadow-xl">
            {results.map(c => (
              <button key={c} onMouseDown={() => { toggleCountry(c); setQ(''); }}
                className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-surface2 ${regionSet.has(c) ? 'text-ember' : 'text-ink'}`}>
                {COUNTRIES[c].name}<span className="font-mono text-xs text-muted">{c}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {chips.map(c => (
        <span key={c} className="inline-flex items-center gap-1 rounded-full bg-surface2 px-2.5 py-1 font-mono text-xs text-ink">
          {c} <button onClick={() => toggleCountry(c)} className="text-muted hover:text-ember" aria-label={`Remove ${c}`}><X size={12} /></button>
        </span>
      ))}
      {regionSet.size > 0 && <button onClick={() => setRegionSet(new Set())} className="text-xs text-muted underline hover:text-ember">clear</button>}
    </div>
  );
}

function ShowCard({ e, i, artistName, onHover }) {
  const date = `${e.dayLabel ? e.dayLabel.toUpperCase() + ' · ' : ''}${fmtShowDate(e.date, true) || 'Date TBA'}`;
  const lineup = (e.lineup || []).filter(Boolean);
  const isMulti = lineup.length > 1;
  const others = artistName ? lineup.filter(n => n !== artistName) : lineup;
  const ordered = artistName ? [artistName, ...others] : lineup;
  // Festivals put the WHOLE lineup in the title — give them a short headline
  // (venue/festival name, else "<your artist> + N more") instead.
  const titleIsLineup = isMulti && (e.name || '').length > 36;
  const headline = titleIsLineup
    ? (e.venue || `${artistName || lineup[0] || 'Festival'} + ${lineup.length - 1} more`)
    : e.name;
  const where = (titleIsLineup
    ? [e.city, e.country]
    : [e.venue, e.city, e.country]).filter(Boolean).join(', ') || 'Location TBA';
  return (
    <motion.a
      href={e.ticketUrl || e.url} target="_blank" rel="noreferrer"
      onMouseEnter={() => onHover?.(e.id)} onMouseLeave={() => onHover?.(null)}
      initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: 'easeOut', delay: Math.min(i * 0.04, 0.4) }}
      whileHover={{ y: -3 }}
      className="group flex h-full flex-col overflow-hidden rounded-md border border-line bg-surface transition-colors hover:border-ember/50"
    >
      <div className="relative">
        <div className="h-[140px] w-full bg-gradient-to-br from-surface2 to-[#171a22]" />
        {e.image && (
          <img
            src={e.image}
            alt={e.artist}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            width="320"
            height="150"
            onError={ev => { ev.currentTarget.style.display = 'none'; }}
            className="absolute inset-0 h-[140px] w-full object-cover"
          />
        )}
        {artistName && (
          <span className="absolute bottom-2 left-2 inline-flex max-w-[88%] items-center gap-1.5 truncate rounded-full bg-canvas/85 px-2.5 py-1 font-mono text-[11px] font-semibold text-ember backdrop-blur">
            <Music2 size={12} /> {artistName}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <div className="font-mono text-xs tracking-wide text-ember">{date}</div>
        <h3 className="mt-1 line-clamp-2 font-display text-lg font-bold leading-snug tracking-tight">{headline}</h3>
        <div className="mt-1 truncate font-mono text-xs text-muted">{where}</div>
        {isMulti && (
          <p className="mt-2 line-clamp-1 text-xs text-muted">
            <span className="font-mono text-[10px] uppercase tracking-wider">+{lineup.length} acts: </span>
            {ordered.map((n, idx) => <span key={n + idx} className={n === artistName ? 'font-semibold text-ink' : ''}>{n}{idx < ordered.length - 1 ? ' · ' : ''}</span>)}
          </p>
        )}
        {e.genres?.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {e.genres.slice(0, 3).map(g => <span key={g} className="rounded-full border border-teal/30 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-teal">{g}</span>)}
          </div>
        )}
        <div className="ticket-stub mt-auto flex items-center justify-between pt-3.5">
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
  const [authError, setAuthError] = useState('');
  const [token, setToken] = useState(localStorage.getItem('spotify_access_token') || '');
  const [artists, setArtists] = useState([]);
  const [selected, setSelected] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState('');
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ continent: '', country: '', city: '', radius: '', startDate: '', endDate: '' });
  const [artistSearch, setArtistSearch] = useState('');
  const [hideEmpty, setHideEmpty] = useState(false);
  const [regionSet, setRegionSet] = useState(() => new Set());
  const [topN, setTopN] = useState(0);
  const [drawMode, setDrawMode] = useState(false);
  const [areaPolygon, setAreaPolygon] = useState(null);
  const [coordsById, setCoordsById] = useState(() => new Map());
  const [hoveredId, setHoveredId] = useState(null);
  const [sortBy, setSortBy] = useState('artist'); // 'artist' (recommended) | 'date' | 'alpha'

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const urlToken = params.get('access_token');
    if (urlToken) {
      localStorage.setItem('spotify_access_token', urlToken);
      // A fresh login (e.g. a new Spotify app with its own quota) must clear any
      // leftover cooldown and stale cache from a previous app/account — otherwise
      // an old 5.6h ban keeps blocking client-side even though the new app is fine.
      localStorage.removeItem('spotify_cooldown_until');
      localStorage.removeItem(SHOW_CACHE_KEY);
      setToken(urlToken);
      history.replaceState({}, '', '/');
      return;
    }
    // Spotify bounced us back with an error (often a transient "server_error").
    // Surface it instead of silently dumping the user on a blank login screen.
    const authError = params.get('error');
    if (authError) {
      const message = authError === 'server_error'
        ? 'Spotify hit a temporary error finishing login. This is usually transient — tap Continue with Spotify to try again.'
        : authError === 'access_denied'
          ? 'Spotify login was cancelled. Tap Continue with Spotify to try again.'
          : `Spotify login failed (${authError}). Tap Continue with Spotify to try again.`;
      setAuthError(message);
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
        let rejected = false; // true only on a genuine 401/403 — a bad/expired token
        if (token) {
          try {
            const res = await fetch(`${API}/me`, { headers: { authorization: `Bearer ${token}` } });
            if (res.status === 401 || res.status === 403) rejected = true;
            else me = await res.json().catch(() => null);
          } catch { /* network blip — transient, keep the token and stay logged in */ }
        }
        if (cancelled) return;
        if (rejected) { localStorage.removeItem('spotify_access_token'); setToken(''); }
        // A valid token means logged in. /me being rate-limited (429 -> user:null)
        // or a transient error must NOT bounce the user back to the login page.
        const authenticated = Boolean(token) && !rejected;
        setAuth({
          loading: false,
          authenticated,
          user: me?.user || null,
          setupReady: Boolean(config.ready),
          missing: config.missing || [],
          message: authenticated && me?.rateLimited ? 'Spotify is busy right now — your profile will load shortly.' : ''
        });
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

  // Load artists, then immediately prefetch the show list for ALL of them so each
  // artist can display a count badge and clicking one shows their shows instantly.
  async function loadEverything(force = false) {
    // Refresh (force) overrides any client-side cooldown and drops the cache so the
    // dataset fully rebuilds from Spotify — the user explicitly asked for fresh data.
    if (force) { localStorage.removeItem('spotify_cooldown_until'); localStorage.removeItem(SHOW_CACHE_KEY); }
    // Otherwise respect an active cooldown — re-bursting during a ban extends it.
    const until = Number(localStorage.getItem('spotify_cooldown_until') || 0);
    if (Date.now() < until) {
      setError(`Spotify rate limit active. Try again in ${formatWait(Math.ceil((until - Date.now()) / 1000))}, or tap Refresh to retry now.`);
      return;
    }
    // Fresh cache → restore instantly, hit Spotify zero times. Refresh bypasses it.
    if (!force) {
      const cached = loadShowCache(auth.user?.id);
      if (cached?.artists?.length) {
        setArtists(cached.artists);
        setEvents(cached.events || []);
        // Only treat already-enriched events as done; the rest re-enrich on demand.
        enrichedRef.current = new Set((cached.events || []).filter(e => e.enriched).map(e => e.id).filter(Boolean));
        setError('');
        return;
      }
    }
    setError(''); setLoading('Loading your artists');
    try {
      const res = await fetch(`${API}/artists`, { headers: { authorization: `Bearer ${token}` } });
      if (res.status === 429) {
        const body = await res.json().catch(() => ({}));
        const secs = Number(body.retryAfter) || 60;
        localStorage.setItem('spotify_cooldown_until', String(Date.now() + secs * 1000));
        setError(`Spotify rate limit hit. Your account is in a cooldown — try again in ${formatWait(secs)}.`);
        setLoading('');
        return;
      }
      const data = await readJson(res);
      localStorage.removeItem('spotify_cooldown_until');
      const list = data.artists || [];
      setArtists(list);
      const ids = list.map(a => a.id).filter(Boolean);
      if (!ids.length) { setLoading(''); return; }
      enrichedRef.current = new Set();
      setEvents([]);
      const imgById = new Map(list.map(a => [a.id, a.image]));
      // Stream one artist at a time through a wide client pool — each artist's
      // badge appears the instant its own request resolves.
      const POOL = 10;
      let next = 0, done = 0;
      const collected = []; // accumulate for the cache (setEvents is async/streamed)
      setLoading('');
      setProgress({ done: 0, total: ids.length });
      async function worker() {
        while (next < ids.length) {
          const id = ids[next++];
          try {
            const res = await fetch(`${API}/spotify-concerts`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ artistIds: [id] }), signal: AbortSignal.timeout(30000) }).then(readJson);
            if (res.events?.length) {
              const withImg = res.events.map(e => ({ ...e, image: e.image || imgById.get(e.artistId) || null }));
              collected.push(...withImg);
              setEvents(cur => [...cur, ...withImg]);
            }
          } catch {}
          done++;
          setProgress({ done, total: ids.length });
        }
      }
      await Promise.all(Array.from({ length: Math.min(POOL, ids.length) }, () => worker()));
      setProgress(null);
    } catch (e) { setError(e.message); }
    finally { setLoading(''); setProgress(null); }
  }

  useEffect(() => {
    const until = Number(localStorage.getItem('spotify_cooldown_until') || 0);
    if (Date.now() < until) {
      setError(`Spotify rate limit active. Try again in ${formatWait(Math.ceil((until - Date.now()) / 1000))}.`);
      return;
    }
    if (auth.authenticated && token && !artists.length && !loading) loadEverything();
  }, [auth.authenticated, token]);

  const nameById = useMemo(() => new Map(artists.map(a => [a.id, a.name])), [artists]);
  // Artist affinity rank (0 = most liked) — drives bigger dots for favourite artists.
  const rankById = useMemo(() => new Map(artists.map((a, i) => [a.id, i])), [artists]);

  // The same concert can be returned once per ticket vendor (e.g. Eventim + Ticketmaster)
  // as separate entries with different ids/urls. Collapse them to one show per
  // artist + day + city. Prefer the entry that's enriched / has a ticket vendor.
  const dedupedEvents = useMemo(() => {
    const byKey = new Map();
    for (const e of events) {
      const day = String(e.date || '').slice(0, 10);
      const city = String(e.city || '').trim().toLowerCase();
      const key = `${e.artistId || ''}|${day}|${city}`;
      const prev = byKey.get(key);
      if (!prev) { byKey.set(key, e); continue; }
      // Keep the richer record (enriched, or has a ticket vendor/venue).
      const score = x => (x.enriched ? 2 : 0) + (x.ticketVendor ? 1 : 0) + (x.venue ? 1 : 0);
      if (score(e) > score(prev)) byKey.set(key, e);
    }
    return [...byKey.values()];
  }, [events]);

  // Upcoming-show count per artist (from the prefetched list) for the rail badges.
  const countByArtist = useMemo(() => {
    const m = {};
    for (const e of dedupedEvents) if (e.artistId) m[e.artistId] = (m[e.artistId] || 0) + 1;
    return m;
  }, [dedupedEvents]);

  const visibleArtists = useMemo(() => {
    const query = artistSearch.trim().toLowerCase();
    const rank = new Map(artists.map((a, i) => [a.id, i]));
    return artists
      .filter(artist => !query || String(artist.name || '').toLowerCase().includes(query))
      .filter(artist => !hideEmpty || (countByArtist[artist.id] || 0) > 0)
      .sort((a, b) => {
        const aSelected = selected.includes(a.id) ? 0 : 1;
        const bSelected = selected.includes(b.id) ? 0 : 1;
        if (aSelected !== bSelected) return aSelected - bSelected;
        return (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0);
      });
  }, [artists, selected, artistSearch, hideEmpty, countByArtist]);

  // Selected artists' shows after the date filter — drives enrichment so that
  // country populates BEFORE the region filter narrows (otherwise un-enriched
  // shows get filtered out, never enriched, and the region filter shows nothing).
  const selectedEvents = useMemo(() => dedupedEvents.filter(e => {
    if (e.artistId && !selected.includes(e.artistId)) return false;
    const day = String(e.date || '').slice(0, 10);
    if (filters.startDate && (!day || day < filters.startDate)) return false;
    if (filters.endDate && (!day || day > filters.endDate)) return false;
    return true;
  }), [dedupedEvents, selected, filters.startDate, filters.endDate]);

  // What's actually shown = selected shows narrowed by the region filter.
  const shownEvents = useMemo(() => {
    const list = regionSet.size ? selectedEvents.filter(e => regionSet.has(e.country)) : selectedEvents;
    const byDate = (a, b) => {
      const da = String(a.date || ''), db = String(b.date || '');
      if (!da) return db ? 1 : 0;
      if (!db) return -1;
      return da.localeCompare(db);
    };
    return [...list].sort((a, b) => {
      if (sortBy === 'artist') { // by artist affinity (love), then date
        const ra = rankById.get(a.artistId) ?? Infinity, rb = rankById.get(b.artistId) ?? Infinity;
        if (ra !== rb) return ra - rb;
        return byDate(a, b);
      }
      if (sortBy === 'alpha') { // by show/artist name
        const na = nameById.get(a.artistId) || a.artist || a.name || '';
        const nb = nameById.get(b.artistId) || b.artist || b.name || '';
        return na.localeCompare(nb) || byDate(a, b);
      }
      return byDate(a, b); // 'date' (default): soonest first
    });
  }, [selectedEvents, regionSet, sortBy, rankById, nameById]);

  // Cards narrow further to the custom drawn area (by each show's resolved coords).
  const areaEvents = useMemo(() => {
    if (!areaPolygon?.length) return shownEvents;
    return shownEvents.filter(e => {
      const c = coordsById.get(e.id);
      return c && pointNearPolygon(c.lat, c.lng, areaPolygon);
    });
  }, [shownEvents, areaPolygon, coordsById]);

  // Lazily enrich (venue/genres/vendor/coords) only the shows currently shown.
  const enrichedRef = React.useRef(new Set());
  useEffect(() => {
    const todo = selectedEvents.filter(e => e.id && e.url && !enrichedRef.current.has(e.id));
    if (!todo.length) return;
    let cancelled = false;
    (async () => {
      for (let i = 0; i < todo.length; i += 100) {
        const chunk = todo.slice(i, i + 100);
        chunk.forEach(e => enrichedRef.current.add(e.id));
        try {
          const { details } = await fetch(`${API}/concert-detail`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ concerts: chunk.map(e => ({ id: e.id, url: e.url })) }) }).then(readJson);
          if (cancelled || !details) continue;
          setEvents(cur => cur.map(e => details[e.id] ? { ...e, ...details[e.id], image: e.image || details[e.id].image, enriched: true } : e));
        } catch {}
      }
    })();
    return () => { cancelled = true; };
  }, [selectedEvents]);

  // Top up artist avatars that still have no image (Spotify Dev-Mode rate limits mean
  // /api/artists can only fetch a slice per load). Re-asks the lightweight image endpoint
  // in rounds with a pause; the server cache fills, so each round resolves more until done.
  const fillingImagesRef = React.useRef(false);
  useEffect(() => {
    if (!token || !artists.length || fillingImagesRef.current) return;
    const missing = artists.filter(a => a.id && !a.image).map(a => a.id);
    if (!missing.length) return;
    fillingImagesRef.current = true;
    let cancelled = false;
    (async () => {
      const pending = new Set(missing);
      for (let round = 0; round < 10 && !cancelled && pending.size; round++) {
        let images;
        try {
          ({ images } = await fetch(`${API}/artist-images`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ ids: [...pending] }) }).then(readJson));
        } catch { break; }
        if (cancelled || !images) break;
        const filled = [...pending].filter(id => images[id]);
        if (!filled.length) break; // no progress (rate-limited / no image available)
        filled.forEach(id => pending.delete(id));
        setArtists(cur => cur.map(a => images[a.id] ? { ...a, image: images[a.id] } : a));
        await new Promise(r => setTimeout(r, 1500));
      }
      fillingImagesRef.current = false;
    })();
    return () => { cancelled = true; fillingImagesRef.current = false; };
  }, [token, artists.length]);

  // Persist the full dataset (artists + shows + enrichment + image URLs) to the cache
  // whenever it changes, debounced. One source of truth for all cache writes, so reloads
  // within the TTL cost zero Spotify calls. Enrichment merges land here too.
  const saveTimerRef = React.useRef(null);
  useEffect(() => {
    if (!auth.authenticated) return;
    if (!artists.length && !events.length) return;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => saveShowCache(auth.user?.id, artists, events), 1500);
    return () => clearTimeout(saveTimerRef.current);
  }, [artists, events, auth.authenticated, auth.user?.id]);

  // Persist geocoded coords onto the events so the map/area filter never re-geocode
  // them — makes filter changes instant and survives reload via the show cache.
  function handleCoords(m) {
    setCoordsById(m);
    setEvents(cur => {
      let changed = false;
      const next = cur.map(e => {
        const c = m.get(e.id);
        if (c && (e.lat == null || e.lon == null)) { changed = true; return { ...e, lat: c.lat, lon: c.lng }; }
        return e;
      });
      return changed ? next : cur;
    });
  }

  // Default: select the first 50 artists once they load (nothing selected yet).
  const defaultedRef = React.useRef(false);
  useEffect(() => {
    if (defaultedRef.current || !artists.length || selected.length) return;
    defaultedRef.current = true;
    const top = artists.slice(0, 50).map(a => a.id).filter(Boolean);
    setSelected(top);
    setTopN(top.length);
  }, [artists, selected.length]);

  function toggleArtist(id) { setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]); }
  function selectVisibleArtists() {
    setSelected(current => [...new Set([...current, ...visibleArtists.map(artist => artist.id).filter(Boolean)])]);
  }
  function deselectVisibleArtists() {
    const visibleIds = new Set(visibleArtists.map(artist => artist.id));
    setSelected(current => current.filter(id => !visibleIds.has(id)));
  }

  if (!auth.authenticated) return <LoginScreen auth={auth} authError={authError} />;

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
          <LogOut size={15} /> {auth.user?.display_name || auth.user?.id || 'Sign out'}
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
      {progress && (
        <div className="mt-5 rounded-md border border-line bg-surface px-4 py-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-ink">Scanning your library for upcoming shows</span>
            <span className="font-mono text-xs text-muted">{progress.done} / {progress.total} artists</span>
          </div>
          <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-canvas">
            <div className="h-full rounded-full bg-ember transition-[width] duration-200" style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} />
          </div>
        </div>
      )}

      {/* Controls */}
      <section className="mt-7 grid items-start gap-6 lg:grid-cols-[320px_1fr]">
        <aside className="rounded-lg border border-line bg-surface/70 p-5 backdrop-blur">
          <h2 className="font-display text-lg font-bold">Actions</h2>
          <p className="mt-1 text-sm text-muted">Click an artist to drop their shows on the map.</p>
          <div className="mt-4 grid gap-2">
            <button onClick={() => loadEverything(true)} title="Refresh from Spotify (rebuild the cache)" className={ghostCls}><RefreshCw size={15} /> Refresh</button>
          </div>
          <div className="mt-4">
            <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">Select top</div>
            <div className="mt-2 flex gap-1.5">
              {[20, 40, 50, 100].map(n => <button key={n} disabled={!artists.length} onClick={() => { setTopN(n); setSelected(artists.slice(0, n).map(a => a.id)); }} className={`flex-1 ${ghostCls}`}>{n}</button>)}
              <button disabled={!artists.length} onClick={() => { setTopN(artists.length); setSelected(artists.map(a => a.id).filter(Boolean)); }} className={`flex-1 ${ghostCls}`}>All</button>
              <button disabled={!artists.length} onClick={() => { setTopN(0); setSelected([]); }} className={`flex-1 ${ghostCls}`}>None</button>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <input
                type="range" min={0} max={artists.length || 0} value={Math.min(topN, artists.length)} disabled={!artists.length}
                onChange={e => { const n = Number(e.target.value); setTopN(n); setSelected(artists.slice(0, n).map(a => a.id)); }}
                className="h-1.5 flex-1 accent-ember disabled:opacity-40"
                aria-label="Select top N artists"
              />
              <span className="w-16 text-right font-mono text-xs text-muted">{Math.min(topN, artists.length)}/{artists.length}</span>
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
              <button onClick={() => setHideEmpty(v => !v)} aria-pressed={hideEmpty} className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3 py-2 text-sm transition ${hideEmpty ? 'bg-ember text-canvas' : 'border border-line text-ink hover:border-ember/60'}`}><Filter size={14} /> Hide empty</button>
            </div>
          </div>
          <ArtistRail artists={visibleArtists} selected={selected} toggle={toggleArtist} counts={countByArtist} />
        </section>
      </section>

      {/* Results — region filter + map on top, cards below */}
      {selected.length > 0 && (
        <>
          <section className="mt-8">
            <div className="mb-3 flex items-baseline gap-2">
              <h2 className="font-display text-lg font-bold">On the map</h2>
              <span className="font-mono text-xs text-muted">{areaEvents.length} {areaEvents.length === 1 ? 'show' : 'shows'}{areaPolygon ? ' in area' : ''}</span>
              <div className="ml-auto flex items-center gap-2">
                <button onClick={() => setDrawMode(v => !v)} aria-pressed={drawMode} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition ${drawMode ? 'bg-ember text-canvas' : 'border border-line text-ink hover:border-ember/60'}`}>
                  <MapPin size={14} /> {drawMode ? 'Click points, double-click to finish' : 'Draw area'}
                </button>
                {areaPolygon && <button onClick={() => { setAreaPolygon(null); setDrawMode(false); }} className={ghostCls}><X size={14} /> Clear area</button>}
              </div>
            </div>
            <RegionBar regionSet={regionSet} setRegionSet={setRegionSet} />
            <ConcertMap events={shownEvents} nameById={nameById} rankById={rankById} drawMode={drawMode} polygon={areaPolygon} onPolygon={ring => { setAreaPolygon(ring); setDrawMode(false); }} onCoords={handleCoords} hoveredId={hoveredId} />
          </section>
          {areaEvents.length > 0 && (
            <div className="mt-6 flex items-center gap-2">
              <span className="font-mono text-xs uppercase tracking-[0.14em] text-muted">Sort</span>
              <div className="flex items-center rounded-full border border-line p-0.5">
                {[['artist', 'Recommended'], ['date', 'Date'], ['alpha', 'A–Z']].map(([k, label]) => (
                  <button key={k} onClick={() => setSortBy(k)} aria-pressed={sortBy === k}
                    className={`rounded-full px-3 py-1 text-xs transition ${sortBy === k ? 'bg-ember text-canvas' : 'text-muted hover:text-ink'}`}>{label}</button>
                ))}
              </div>
            </div>
          )}
          {areaEvents.length > 0
            ? <section className="mt-4 grid auto-rows-fr gap-5 sm:grid-cols-2 lg:grid-cols-3">{areaEvents.map((e, i) => <ShowCard key={e.id} e={e} i={i} artistName={nameById.get(e.artistId)} onHover={setHoveredId} />)}</section>
            : <p className="mt-6 font-mono text-sm text-muted">No shows match your filters.</p>}
        </>
      )}
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
