const PORT = Number(Bun.env.PORT || Bun.env.API_PORT || 45678);
const SPOTIFY_CLIENT_ID = Bun.env.SPOTIFY_CLIENT_ID || '';
const SPOTIFY_CLIENT_SECRET = Bun.env.SPOTIFY_CLIENT_SECRET || '';
const SPOTIFY_REDIRECT_URI = Bun.env.SPOTIFY_REDIRECT_URI || 'http://127.0.0.1:45678/callback';
const DIST_DIR = new URL('../dist/', import.meta.url);

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json' }
});

function logAuth(event: string, details: Record<string, unknown> = {}) {
  const safeDetails = { ...details };
  for (const key of Object.keys(safeDetails)) {
    if (key.toLowerCase().includes('token') || key.toLowerCase().includes('secret') || key.toLowerCase().includes('code')) {
      safeDetails[key] = '[redacted]';
    }
  }
  console.log(`[auth] ${new Date().toISOString()} ${event}`, JSON.stringify(safeDetails));
}

const mimeTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

function contentType(pathname: string) {
  const match = pathname.match(/\.[^.]+$/);
  return match ? mimeTypes[match[0]] || 'application/octet-stream' : 'application/octet-stream';
}

async function serveStatic(pathname: string) {
  const safePath = pathname === '/' ? '/index.html' : pathname;
  const decoded = decodeURIComponent(safePath);
  if (decoded.includes('..')) return json({ error: 'Bad path' }, 400);

  const file = Bun.file(new URL(`.${decoded}`, DIST_DIR));
  if (await file.exists()) {
    return new Response(file, { headers: { 'content-type': contentType(decoded) } });
  }

  const index = Bun.file(new URL('./index.html', DIST_DIR));
  if (await index.exists()) {
    return new Response(index, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  }

  return json({ error: 'Frontend build not found. Run bun run build first.' }, 404);
}

const mockEvents = (artists: string[]) => artists.slice(0, 12).map((artist, i) => ({
  id: `mock-${artist}-${i}`,
  artist,
  name: `${artist} Live`,
  date: new Date(Date.now() + (i + 7) * 86400000).toISOString().slice(0, 10),
  venue: ['The Fillmore', 'Roundhouse', 'Olympia Theatre', 'Forum'][i % 4],
  city: ['New York', 'London', 'Paris', 'Sydney'][i % 4],
  country: ['US', 'GB', 'FR', 'AU'][i % 4],
  continent: ['North America', 'Europe', 'Europe', 'Oceania'][i % 4],
  url: 'https://www.ticketmaster.com/',
  source: 'mock'
}));

async function spotify(path: string, accessToken: string, retries = 2): Promise<any> {
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    headers: { authorization: `Bearer ${accessToken}` }
  });
  // Back off and retry on rate limiting (Spotify sends Retry-After in seconds).
  if (res.status === 429 && retries > 0) {
    const wait = Math.min(Number(res.headers.get('retry-after') || 1), 10);
    await new Promise(r => setTimeout(r, (wait + 0.3) * 1000));
    return spotify(path, accessToken, retries - 1);
  }
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function getFollowedArtists(accessToken: string) {
  const artists = [];
  let after = '';
  do {
    const data = await spotify(`/me/following?type=artist&limit=50${after ? `&after=${after}` : ''}`, accessToken);
    artists.push(...(data.artists?.items || []));
    after = data.artists?.cursors?.after || '';
  } while (after && artists.length < 500);
  return artists;
}

// Returns id -> { artist, count }, where count is how many liked tracks feature
// that artist (a rough affinity signal).
async function getLikedSongArtists(accessToken: string) {
  const map = new Map<string, { artist: any; count: number }>();
  let offset = 0;
  while (offset < 500) {
    const data = await spotify(`/me/tracks?limit=50&offset=${offset}`, accessToken);
    for (const item of data.items || []) {
      for (const artist of item.track?.artists || []) {
        const key = artist.id || artist.name;
        const entry = map.get(key) || { artist, count: 0 };
        entry.count++;
        map.set(key, entry);
      }
    }
    if (!data.next) break;
    offset += 50;
  }
  return map;
}

// Returns id -> rank (lower = listened to more). Recent listening (medium_term)
// ranks above all-time (long_term). Empty if the user-top-read scope is missing.
async function getTopArtists(accessToken: string) {
  const rank = new Map<string, number>();
  const ranges = ['medium_term', 'long_term'];
  for (let r = 0; r < ranges.length; r++) {
    try {
      const data = await spotify(`/me/top/artists?limit=50&time_range=${ranges[r]}`, accessToken);
      (data.items || []).forEach((a: any, i: number) => { if (a.id && !rank.has(a.id)) rank.set(a.id, r * 100 + i); });
    } catch (error) {
      logAuth('top_artists_error', { range: ranges[r], message: error instanceof Error ? error.message : 'top fetch failed' });
    }
  }
  return rank;
}

function stripHtml(value: string) {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

const SCRAPER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ── Fast path: harvest a pathfinder token once, replay the API for every artist ──
// The concerts page authorizes pathfinder with authorization + client-token +
// spotify-app-version headers and a persisted query hash. We capture those live
// from one browser load (so a Spotify deploy that rotates the hash self-heals on
// the next harvest), cache them, and then hit the API with plain fetch.
const HARVEST_TTL_MS = 40 * 60 * 1000;
let harvestCache: { headers: Record<string, string>; hash: string; capturedAt: number } | null = null;
let harvestInFlight: Promise<any> | null = null;

async function harvestSpotifyApi() {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ userAgent: SCRAPER_UA });
    let cap: { headers: Record<string, string>; hash: string } | null = null;
    page.on('request', (req) => {
      if (cap || !req.url().includes('pathfinder/v2/query') || req.method() !== 'POST') return;
      let body: any = {};
      try { body = JSON.parse(req.postData() || '{}'); } catch {}
      if (!/concert/i.test(body.operationName || '')) return;
      const h = req.headers();
      cap = {
        headers: {
          authorization: h.authorization,
          'client-token': h['client-token'],
          'spotify-app-version': h['spotify-app-version'],
          'app-platform': h['app-platform'] || 'WebPlayer',
          'user-agent': h['user-agent'] || SCRAPER_UA,
          accept: 'application/json',
          'content-type': 'application/json;charset=UTF-8'
        },
        hash: body.extensions?.persistedQuery?.sha256Hash || ''
      };
    });
    await page.goto('https://open.spotify.com/artist/0jq1z5MQSlFtvpbnLzeEul/concerts', { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(2500);
    if (!cap || !cap.headers.authorization || !cap.headers['client-token'] || !cap.hash) {
      throw new Error('Failed to harvest pathfinder credentials');
    }
    harvestCache = { ...cap, capturedAt: Date.now() };
    return harvestCache;
  } finally {
    await browser.close();
  }
}

// Coalesce concurrent harvests — under load many pathfinder calls can 401/403 at
// once; without this each would launch its own browser (a launch storm that locks
// the machine). All callers share one in-flight harvest.
async function getHarvest(force = false) {
  if (!force && harvestCache && Date.now() - harvestCache.capturedAt < HARVEST_TTL_MS) return harvestCache;
  if (harvestInFlight) return harvestInFlight;
  harvestInFlight = harvestSpotifyApi().finally(() => { harvestInFlight = null; });
  return harvestInFlight;
}

// Fetch one artist's concerts from pathfinder. Re-harvests once on 401/403,
// backs off once on 429, and times out so a hung request can't stall a worker.
async function pathfinderConcerts(artistId: string, artistName: string, retry = true): Promise<any[]> {
  const harvest = await getHarvest();
  const body = JSON.stringify({
    variables: { artistUri: `spotify:artist:${artistId}`, geoHash: null, includeNearby: false },
    operationName: 'ArtistConcerts',
    extensions: { persistedQuery: { version: 1, sha256Hash: harvest.hash } }
  });
  const res = await fetch('https://api-partner.spotify.com/pathfinder/v2/query', { method: 'POST', headers: harvest.headers, body, signal: AbortSignal.timeout(15000) });
  if ((res.status === 401 || res.status === 403) && retry) {
    await getHarvest(true);
    return pathfinderConcerts(artistId, artistName, false);
  }
  if (res.status === 429 && retry) {
    const wait = Math.min(Number(res.headers.get('retry-after') || 2), 10);
    await new Promise(r => setTimeout(r, (wait + 0.3) * 1000));
    return pathfinderConcerts(artistId, artistName, false);
  }
  if (!res.ok) throw new Error(`pathfinder ${res.status}`);
  const data = await res.json();
  const items = data?.data?.concerts?.concerts?.items || [];
  return items.map((item: any) => {
    const c = item.data || {};
    const id = String(c.uri || '').split(':').pop() || '';
    const lineup = (c.artists?.items || []).map((a: any) => a.data?.profile?.name).filter(Boolean);
    const name = artistName || c.title || lineup[0] || 'Concert';
    return {
      id,
      artistId,
      artist: name,
      name: c.title || name,
      date: c.startDateIsoString || '',
      city: c.location?.city || '',
      lineup: lineup.length ? lineup : [name],
      type: 'Spotify concert',
      url: `https://open.spotify.com/concert/${id}`,
      source: 'spotify-pathfinder'
    };
  }).filter((e: any) => e.id);
}

// ── Detail: curl-style fetch of /concert/{id} returns server-rendered HTML with a
// base64 Redux-state blob carrying the full concert entity (venue, country, genres,
// ticket vendor, AND coordinates). No browser, no token, no geocoding. ──
const CURL_UA = 'curl/8.4.0';

function parseConcertDetailHtml(html: string, concertId: string) {
  const empty = { venue: null, country: null, lat: null, lon: null, dayLabel: null, genres: [] as string[], ticketVendor: null, ticketUrl: null, onSale: false, image: null as string | null };
  const blobs = html.match(/[A-Za-z0-9+/]{800,}={0,2}/g) || [];
  for (const b64 of blobs) {
    let json: any;
    try { json = JSON.parse(Buffer.from(b64, 'base64').toString('utf8')); } catch { continue; }
    const items = json?.session?.entities?.items || json?.entities?.items;
    if (!items) continue;
    const key = Object.keys(items).find(k => k.includes(concertId)) || Object.keys(items).find(k => k.startsWith('spotify:concert:'));
    if (!key) continue;
    const c = items[key];
    const offer = c.offers?.items?.[0] || {};
    const dayLabel = c.startDateIsoString ? new Date(c.startDateIsoString).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }) : null;
    const image = pickImage(c.artists?.items?.[0]?.data?.visuals?.avatarImage?.sources, 320);
    return {
      venue: c.location?.name || null,
      country: c.location?.country || null,
      lat: c.location?.coordinates?.latitude ?? null,
      lon: c.location?.coordinates?.longitude ?? null,
      dayLabel,
      genres: (c.concepts?.items || []).map((g: any) => g.data?.name).filter(Boolean),
      ticketVendor: offer.providerName || null,
      ticketUrl: offer.url || null,
      onSale: String(offer.saleType || '').includes('on-sale'),
      image
    };
  }
  return empty;
}

async function fetchConcertDetail(url: string, concertId: string, retries = 2): Promise<any> {
  const res = await fetch(url, { headers: { 'user-agent': CURL_UA, accept: 'text/html' }, signal: AbortSignal.timeout(15000) });
  // open.spotify.com rate-limits by IP — back off on 429 and retry.
  if (res.status === 429 && retries > 0) {
    const wait = Math.min(Number(res.headers.get('retry-after') || 2), 15);
    await new Promise(r => setTimeout(r, (wait + 0.3) * 1000));
    return fetchConcertDetail(url, concertId, retries - 1);
  }
  if (!res.ok) throw new Error(`detail ${res.status}`);
  return parseConcertDetailHtml(await res.text(), concertId);
}

// Enrich events with detail fields, staggered to stay under open.spotify.com's
// rate limit: a small pool, a short gap between each fetch, cached by concert id.
const DETAIL_GAP_MS = 250;
async function enrichConcertsHttp(events: any[]) {
  let next = 0;
  async function worker() {
    while (next < events.length) {
      const event = events[next++];
      const cached = concertDetailCache.get(event.id);
      if (cached) { Object.assign(event, cached); continue; }
      try {
        const detail = await fetchConcertDetail(event.url, event.id);
        concertDetailCache.set(event.id, detail);
        Object.assign(event, detail);
      } catch (detailError) {
        logAuth('concert_detail_http_error', { id: event.id, message: detailError instanceof Error ? detailError.message : 'Detail fetch failed' });
      }
      if (next < events.length) await new Promise(r => setTimeout(r, DETAIL_GAP_MS));
    }
  }
  const poolSize = Math.min(2, events.length);
  await Promise.all(Array.from({ length: poolSize }, () => worker()));
  return events;
}

// Scrape an artist's /concerts page for the list of shows (page reused by caller).
async function scrapeArtistConcerts(page: any, artist: any) {
  const artistUrl = `https://open.spotify.com/artist/${artist.id}/concerts`;
  await page.goto(artistUrl, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForSelector('a[data-testid="concert-row"], a[href^="/concert/"]', { timeout: 20000 }).catch(() => null);
  await page.waitForTimeout(1500);
  const rows = await page.evaluate((artistName: string) => {
    return Array.from(document.querySelectorAll('a[data-testid="concert-row"], a[href^="/concert/"]')).map((row) => {
      const link = row as HTMLAnchorElement;
      const time = row.querySelector('time') as HTMLTimeElement | null;
      const parts = ((row as HTMLElement).innerText || row.textContent || '').split('\n').map(part => part.trim()).filter(Boolean);
      const city = parts.find(part => !/^[A-Z][a-z]{2}$/.test(part) && !/^\d{1,2}$/.test(part) && part !== artistName && !/^\d{1,2}:\d{2}\s?(AM|PM)$/i.test(part)) || '';
      const href = link.href || link.getAttribute('href') || '';
      const id = href.split('/concert/')[1]?.split(/[?#]/)[0] || href;
      return {
        id,
        artist: artistName,
        name: artistName,
        date: time?.dateTime || '',
        city,
        lineup: [artistName],
        type: 'Spotify concert',
        url: href.startsWith('http') ? href : `https://open.spotify.com${href}`,
        source: 'spotify-page-scrape'
      };
    });
  }, artist.name);
  const image = artist.images?.[0]?.url || null;
  return rows.map((event: any) => ({ ...event, artistId: artist.id, artistUrl, image }));
}

// Scrape a single /concert/{id} detail page. Best-effort: every field nullable,
// never throws (returns empty fields on any failure).
async function scrapeConcertDetail(page: any, url: string) {
  const empty = { venue: null, country: null, dayLabel: null, genres: [] as string[], ticketVendor: null, onSale: false };
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(1200);
    return await page.evaluate(() => {
      const title = document.title || '';
      const venueFromTitle = (title.match(/\(([^)]+)\)/) || [])[1] || null;
      const text = (document.querySelector('main') as HTMLElement)?.innerText || document.body.innerText || '';
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      const locLine = lines.find(l => /^.+,\s*.+,\s*[A-Z]{2}$/.test(l)) || '';
      const locParts = locLine ? locLine.split(',').map(s => s.trim()) : [];
      const country = locParts.length === 3 ? locParts[2] : null;
      const venue = venueFromTitle || (locParts.length === 3 ? locParts[0] : null);
      const dayLine = lines.find(l => /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun),/.test(l)) || '';
      const dayLabel = dayLine ? dayLine.slice(0, 3) : null;
      const locIdx = locLine ? lines.indexOf(locLine) : -1;
      const genres: string[] = [];
      if (locIdx > 0) {
        for (let i = locIdx - 1; i >= 0 && genres.length < 6; i--) {
          const l = lines[i];
          if (/^[a-z0-9][a-z0-9 \-&/]+$/.test(l) && l.length <= 24) genres.unshift(l); else break;
        }
      }
      const findIdx = lines.findIndex(l => /^Find tickets$/i.test(l));
      const vendorCand = findIdx > 0 ? lines[findIdx - 1] : null;
      const ticketVendor = vendorCand && !/^On sale$/i.test(vendorCand) ? vendorCand : null;
      const onSale = lines.some(l => /^On sale$/i.test(l));
      return { venue, country, dayLabel, genres, ticketVendor, onSale };
    });
  } catch {
    return empty;
  }
}

// Concert detail rarely changes, so cache it for the process lifetime keyed by
// concert id. Repeat "Find concerts" runs then skip the network entirely.
const concertDetailCache = new Map<string, any>();
const DETAIL_CONCURRENCY = 5;

// Enrich events with detail-page fields concurrently using a small pool of pages.
// Cache hits skip the network; misses are scraped and cached. Per-event errors
// are logged and leave the event with its basic (list) fields.
async function enrichConcertsDetail(context: any, events: any[]) {
  let next = 0;
  async function worker() {
    const page = await context.newPage();
    try {
      while (next < events.length) {
        const event = events[next++];
        const cached = concertDetailCache.get(event.id);
        if (cached) { Object.assign(event, cached); continue; }
        try {
          const detail = await scrapeConcertDetail(page, event.url);
          concertDetailCache.set(event.id, detail);
          Object.assign(event, detail);
        } catch (detailError) {
          logAuth('concert_detail_error', { url: event.url, message: detailError instanceof Error ? detailError.message : 'Detail scrape failed' });
        }
      }
    } finally {
      await page.close();
    }
  }
  const poolSize = Math.min(DETAIL_CONCURRENCY, events.length);
  await Promise.all(Array.from({ length: poolSize }, () => worker()));
}

// Thin wrapper that owns its own browser — used by the test routes.
async function scrapeSpotifyConcertPage(artist: any) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ userAgent: SCRAPER_UA });
    const page = await context.newPage();
    const events = await scrapeArtistConcerts(page, artist);
    await page.close();
    await enrichConcertsDetail(context, events);
    return events;
  } finally {
    await browser.close();
  }
}

// Pick the image source closest to a target width (cards are small — a 320px
// thumbnail loads far faster than the 640px original).
function pickImage(sources: any[], target = 320): string | null {
  const list = (sources || []).filter((s: any) => s?.url);
  if (!list.length) return null;
  let best = list[0];
  for (const s of list) {
    if (Math.abs((s.width || 9999) - target) < Math.abs((best.width || 9999) - target)) best = s;
  }
  return best.url || null;
}

// Fetch name + image for many artists in one Spotify API call (up to 50 ids).
async function getArtistMeta(accessToken: string, artistIds: string[]) {
  const map = new Map<string, { name: string; image: string | null }>();
  for (let i = 0; i < artistIds.length; i += 50) {
    const ids = artistIds.slice(i, i + 50).join(',');
    try {
      const data = await spotify(`/artists?ids=${ids}`, accessToken);
      for (const a of data.artists || []) if (a?.id) map.set(a.id, { name: a.name || a.id, image: pickImage(a.images, 320) });
    } catch (error) {
      logAuth('artist_meta_error', { message: error instanceof Error ? error.message : 'Meta fetch failed' });
    }
  }
  return map;
}

// Browser fallback when the pathfinder fast path is unavailable.
async function getConcertsViaBrowser(accessToken: string, artistIds: string[]) {
  const { chromium } = await import('playwright');
  const events = [];
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ userAgent: SCRAPER_UA });
    const listPage = await context.newPage();
    for (const artistId of artistIds.slice(0, 25)) {
      const artist = await spotify(`/artists/${artistId}`, accessToken);
      try {
        events.push(...await scrapeArtistConcerts(listPage, artist));
      } catch (error) {
        logAuth('concert_scrape_error', { artistId, message: error instanceof Error ? error.message : 'Scrape failed' });
      }
    }
    await listPage.close();
    await enrichConcertsDetail(context, events);
  } finally {
    await browser.close();
  }
  return events;
}

// Run fn over items with at most `limit` in flight, preserving input order.
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

async function getSpotifyConcerts(accessToken: string, artistIds: string[]) {
  const ids = artistIds.slice(0, 400);
  let events: any[] = [];
  let source = 'spotify-pathfinder';
  let fastPathFailed = false;
  try {
    // Pathfinder gives the shows (and the artist name); images come from the lazy
    // detail enrich and the frontend's artist list — so NO per-chunk /v1/artists
    // calls here (those were the rate-limit source). Warm the token, then fan out.
    await getHarvest();
    const perArtist = await mapPool(ids, 8, id =>
      pathfinderConcerts(id, '').catch(error => {
        logAuth('pathfinder_error', { artistId: id, message: error instanceof Error ? error.message : 'pathfinder failed' });
        return [] as any[];
      })
    );
    events = perArtist.flat();
  } catch (error) {
    // Only a token-harvest failure means the fast path is actually broken.
    fastPathFailed = true;
    logAuth('fast_path_failed', { message: error instanceof Error ? error.message : 'fast path failed' });
  }
  // Browser fallback ONLY when the fast path itself broke — NOT when an artist
  // simply has zero upcoming shows (that would launch a browser per empty artist).
  if (fastPathFailed) {
    source = 'spotify-page-scrape';
    events = await getConcertsViaBrowser(accessToken, ids);
  }
  events.sort((a: any, b: any) => String(a.date || '').localeCompare(String(b.date || '')));
  return { events, source, message: events.length ? '' : 'No Spotify concerts were returned for the selected artists.' };
}

Bun.serve({
  port: PORT,
  idleTimeout: 120,
  async fetch(req) {
    const url = new URL(req.url);
    try {
      if (url.pathname === '/api/config') return json({
        clientId: SPOTIFY_CLIENT_ID,
        redirectUri: SPOTIFY_REDIRECT_URI,
        ready: Boolean(SPOTIFY_CLIENT_ID && SPOTIFY_CLIENT_SECRET && SPOTIFY_REDIRECT_URI),
        missing: ['SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET', 'SPOTIFY_REDIRECT_URI'].filter(key => !Bun.env[key])
      });
      if (url.pathname === '/api/test/spotify-scrape') {
        const ids = (url.searchParams.get('ids') || '0jq1z5MQSlFtvpbnLzeEul,7jLSEPYCYQ5ssWU3BICqrW,6L1oTvVHQOHmsmoVewQpuB').split(',').map(id => id.trim()).filter(Boolean);
        const results = [];
        for (const id of ids.slice(0, 5)) {
          const artist = { id, name: url.searchParams.get(`name_${id}`) || id };
          results.push({ artist, events: await scrapeSpotifyConcertPage(artist) });
        }
        return json({ results });
      }
      if (url.pathname === '/api/test/jazzbois' || url.pathname === '/jazzbois-test') {
        const artist = { id: '0jq1z5MQSlFtvpbnLzeEul', name: 'Jazzbois' };
        const events = await scrapeSpotifyConcertPage(artist);
        events.sort((a: any, b: any) => String(a.date || '').localeCompare(String(b.date || '')));
        if (url.pathname === '/api/test/jazzbois') return json({ artist, events, count: events.length });
        return new Response(`<!doctype html><html><head><title>Jazzbois concert test</title><style>body{font-family:Inter,Arial,sans-serif;background:#101010;color:#fff;margin:0;padding:32px}.card{max-width:920px;margin:auto;background:#181818;border:1px solid #333;border-radius:24px;padding:28px}h1{margin:0 0 8px}.ok{color:#1ed760;font-weight:700}.event{padding:16px 0;border-top:1px solid #303030}.date{color:#1ed760}.muted{color:#aaa}</style></head><body><main class="card"><p class="ok">Verified working</p><h1>Jazzbois concrete concert list</h1><p class="muted">${events.length} events found for Spotify artist ${artist.id}</p>${events.map((event: any) => `<div class="event"><div class="date">${new Date(event.date).toLocaleString()}</div><h2>${event.name}</h2><p>${event.city}${event.venue ? `, ${event.venue}` : ''}</p><a href="${event.url}" style="color:#1ed760">Tickets</a></div>`).join('')}</main></body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      }
      if (url.pathname === '/api/auth/login') {
        logAuth('login_start', { origin: url.origin, redirectUri: SPOTIFY_REDIRECT_URI, hasClientId: Boolean(SPOTIFY_CLIENT_ID), hasClientSecret: Boolean(SPOTIFY_CLIENT_SECRET) });
        if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET || !SPOTIFY_REDIRECT_URI) {
          logAuth('login_blocked_missing_config', { missing: ['SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET', 'SPOTIFY_REDIRECT_URI'].filter(key => !Bun.env[key]) });
          return json({ error: 'Spotify OAuth is not configured. Add the required Spotify variables to your local .env, then restart the server.' }, 503);
        }
        const params = new URLSearchParams({
          client_id: SPOTIFY_CLIENT_ID,
          response_type: 'code',
          redirect_uri: SPOTIFY_REDIRECT_URI,
          scope: 'user-follow-read user-library-read user-top-read',
          show_dialog: 'true'
        });
        return Response.redirect(`https://accounts.spotify.com/authorize?${params}`, 302);
      }
      if (url.pathname === '/api/auth/callback' || url.pathname === '/callback') {
        if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET || !SPOTIFY_REDIRECT_URI) {
          return json({ error: 'Spotify OAuth is not configured. Add the required Spotify variables to your local .env, then restart the server.' }, 503);
        }
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');
        const appUrl = url.origin;
        logAuth('callback_received', { origin: url.origin, hasCode: Boolean(code), error, redirectUri: SPOTIFY_REDIRECT_URI });
        if (error) {
          logAuth('callback_spotify_error', { error });
          return Response.redirect(`${appUrl}/callback?error=${encodeURIComponent(error)}`, 302);
        }
        if (!code) return serveStatic('/');
        const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: SPOTIFY_REDIRECT_URI });
        const basic = btoa(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`);
        const res = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' }, body });
        const data = await res.json();
        if (!res.ok) {
          logAuth('token_exchange_failed', { status: res.status, spotifyError: data.error, spotifyDescription: data.error_description });
          return json(data, res.status);
        }
        logAuth('token_exchange_ok', { status: res.status, expiresIn: data.expires_in, scope: data.scope });
        return Response.redirect(`${appUrl}/callback?access_token=${encodeURIComponent(data.access_token)}`, 302);
      }
      if (url.pathname === '/api/me') {
        const token = req.headers.get('authorization')?.replace('Bearer ', '');
        if (!token) return json({ authenticated: false }, 401);
        const user = await spotify('/me', token);
        logAuth('spotify_user_loaded', { id: user.id, email: user.email, product: user.product });
        return json({ authenticated: true, user });
      }
      if (url.pathname === '/api/token' && req.method === 'POST') {
        if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET || !SPOTIFY_REDIRECT_URI) return json({ error: 'Missing Spotify env vars' }, 500);
        const { code } = await req.json();
        const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: SPOTIFY_REDIRECT_URI });
        const basic = btoa(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`);
        const res = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' }, body });
        return json(await res.json(), res.status);
      }
      if (url.pathname === '/api/artists') {
        const token = req.headers.get('authorization')?.replace('Bearer ', '');
        if (!token) return json({ error: 'Missing bearer token' }, 401);
        const [followed, likedMap, topRank] = await Promise.all([getFollowedArtists(token), getLikedSongArtists(token), getTopArtists(token)]);
        const deduped = new Map();
        for (const artist of followed) deduped.set(artist.id || artist.name, { id: artist.id, name: artist.name, image: artist.images?.[0]?.url });
        for (const { artist } of likedMap.values()) {
          const key = artist.id || artist.name;
          if (!deduped.has(key)) deduped.set(key, { id: artist.id, name: artist.name, image: artist.images?.[0]?.url });
        }
        // Order by listening affinity: top-artists rank, then liked-track count, then name.
        const likedCount = (id: string) => likedMap.get(id)?.count || 0;
        const artists = [...deduped.values()].filter(a => a.id).sort((a, b) => {
          const ra = topRank.has(a.id) ? topRank.get(a.id)! : Infinity;
          const rb = topRank.has(b.id) ? topRank.get(b.id)! : Infinity;
          if (ra !== rb) return ra - rb;
          const la = likedCount(a.id), lb = likedCount(b.id);
          if (la !== lb) return lb - la;
          return a.name.localeCompare(b.name);
        });
        return json({ artists });
      }
      if (url.pathname === '/api/spotify-concerts' && req.method === 'POST') {
        const token = req.headers.get('authorization')?.replace('Bearer ', '');
        if (!token) return json({ error: 'Missing bearer token' }, 401);
        const { artistIds = [] } = await req.json();
        return json(await getSpotifyConcerts(token, artistIds));
      }
      if (url.pathname === '/api/concert-detail' && req.method === 'POST') {
        // Background enrichment: venue/country/genres/vendor/coords via curl-style
        // HTTP fetch of each concert page. No auth needed (public SSR data).
        const { concerts = [] } = await req.json();
        const events = (concerts as any[]).filter(c => c?.id && c?.url).slice(0, 100);
        await enrichConcertsHttp(events);
        const byId: Record<string, any> = {};
        for (const e of events) byId[e.id] = { venue: e.venue, country: e.country, lat: e.lat, lon: e.lon, dayLabel: e.dayLabel, genres: e.genres, ticketVendor: e.ticketVendor, ticketUrl: e.ticketUrl, onSale: e.onSale, image: e.image };
        return json({ details: byId });
      }
      return serveStatic(url.pathname);
    } catch (error) {
      logAuth('server_error', { path: url.pathname, message: error instanceof Error ? error.message : 'Server error' });
      return json({ error: error instanceof Error ? error.message : 'Server error' }, 500);
    }
  }
});
console.log(`App listening on http://localhost:${PORT}`);

// Pre-warm the pathfinder token at boot and keep it warm ahead of its TTL, so
// the first user request never pays the ~5s browser-harvest cost.
getHarvest().then(() => console.log('[harvest] pathfinder token pre-warmed')).catch(() => {});
setInterval(() => { getHarvest(true).catch(() => {}); }, HARVEST_TTL_MS - 5 * 60 * 1000);
