from pathlib import Path
p=Path('src/main.jsx')
s=p.read_text()
s=s.replace("const setupFields = ['SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET', 'SPOTIFY_REDIRECT_URI', 'TICKETMASTER_API_KEY'];\n", "")
s=s.replace("  const [selected, setSelected] = useState([]);\n  const [events, setEvents] = useState([]);\n  const [filters, setFilters] = useState({ city: '', country: '', radius: '100', startDate: '', endDate: '', continent: '' });\n  const [mocked, setMocked] = useState(false);\n", "  const [selected, setSelected] = useState([]);\n  const [events, setEvents] = useState([]);\n")
s=s.replace("    try { const data = await fetch(`${API}/artists`, { headers: { authorization: `Bearer ${token}` } }).then(readJson); setArtists(data.artists || []); setSelected((data.artists || []).slice(0, 20).map(a => a.name)); }", "    try { const data = await fetch(`${API}/artists`, { headers: { authorization: `Bearer ${token}` } }).then(readJson); setArtists(data.artists || []); setSelected((data.artists || []).slice(0, 20).map(a => a.id)); }")
s=s.replace("  async function findConcerts() {\n    setLoading('Finding concerts'); setError('');\n    try { const data = await fetch(`${API}/concerts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ artists: selected, filters }) }).then(readJson); setEvents(data.events || []); setMocked(Boolean(data.mocked)); }\n    catch (e) { setError(e.message); } finally { setLoading(''); }\n  }\n\n  const continents = useMemo(() => [...new Set(events.map(e => e.continent).filter(Boolean))], [events]);", "  async function findConcerts() {\n    setLoading('Loading Spotify artist releases'); setError('');\n    try { const data = await fetch(`${API}/spotify-releases`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ artistIds: selected }) }).then(readJson); setEvents(data.events || []); }\n    catch (e) { setError(e.message); } finally { setLoading(''); }\n  }\n\n  useEffect(() => {\n    if (auth.authenticated && token && !artists.length && !loading) loadArtists();\n  }, [auth.authenticated, token]);")
old="""    <section className=\"hero\"><div><p className=\"eyebrow\">Connected as {auth.user?.display_name || auth.user?.id}</p><h1>Your concert radar</h1><p>Choose artists, set location filters, and find shows.</p></div><button className=\"ghost\" onClick={() => { localStorage.removeItem('spotify_access_token'); setToken(''); }}>Sign out</button></section>
    {error && <div className=\"notice error\">{error}</div>}{loading && <div className=\"notice\">{loading}...</div>}
    <section className=\"grid\"><aside className=\"card\"><h2>Filters</h2>{Object.keys(filters).map(k => <label key={k}>{k}<input value={filters[k]} onChange={e => setFilters(f => ({ ...f, [k]: e.target.value }))} placeholder={k === 'continent' && continents[0] ? continents.join(', ') : ''} /></label>)}<button onClick={loadArtists}>Load Spotify artists</button><button onClick={findConcerts} disabled={!selected.length}>Find concerts</button>{mocked && <p>Using mock events because TICKETMASTER_API_KEY is not set.</p>}</aside><section className=\"card\"><h2>Artists</h2><div className=\"chips\">{artists.map(a => <button key={a.id || a.name} className={`chip ${selected.includes(a.name) ? 'on' : ''}`} onClick={() => setSelected(s => s.includes(a.name) ? s.filter(x => x !== a.name) : [...s, a.name])}>{a.name}</button>)}</div></section></section>
    <section className=\"results eventGrid\">{events.map(e => <a className=\"event\" href={e.url} target=\"_blank\" rel=\"noreferrer\" key={e.id}><span>{e.date}</span><h3>{e.name}</h3><p>{e.venue}, {e.city}, {e.country}</p></a>)}</section>"""
new="""    <section className=\"hero\"><div><p className=\"eyebrow\">Connected as {auth.user?.display_name || auth.user?.id}</p><h1>Your Spotify radar</h1><p>Your artists load automatically. Pick the ones you care about, then pull their latest Spotify releases.</p></div><button className=\"ghost\" onClick={() => { localStorage.removeItem('spotify_access_token'); setToken(''); }}>Sign out</button></section>
    {error && <div className=\"notice error\">{error}</div>}{loading && <div className=\"notice\">{loading}...</div>}
    <section className=\"grid\"><aside className=\"card\"><h2>Actions</h2><p>This now uses Spotify Web API only. Spotify does not expose live concert listings in the public Web API, so Ticketmaster was removed.</p><button onClick={loadArtists}>Refresh artists</button><button onClick={findConcerts} disabled={!selected.length}>Find on Spotify</button></aside><section className=\"card\"><h2>Artists</h2><div className=\"chips\">{artists.map(a => <button key={a.id || a.name} className={`chip ${selected.includes(a.id) ? 'on' : ''}`} onClick={() => setSelected(s => s.includes(a.id) ? s.filter(x => x !== a.id) : [...s, a.id])}>{a.name}</button>)}</div></section></section>
    <section className=\"results eventGrid\">{events.map(e => <a className=\"event\" href={e.url} target=\"_blank\" rel=\"noreferrer\" key={e.id}><span>{e.date}</span><h3>{e.name}</h3><p>{e.artist} · {e.type}</p></a>)}</section>"""
s=s.replace(old,new)
p.write_text(s)

p=Path('backend/server.ts')
s=p.read_text()
s=s.replace("const TICKETMASTER_API_KEY = Bun.env.TICKETMASTER_API_KEY || '';\n", "")
start=s.index("async function findEvents")
end=s.index("\n\nfunction continentForCountry")
s=s[:start]+"""async function getArtistReleases(accessToken: string, artistIds: string[]) {
  const events = [];
  for (const artistId of artistIds.slice(0, 25)) {
    const artist = await spotify(`/artists/${artistId}`, accessToken);
    const albums = await spotify(`/artists/${artistId}/albums?include_groups=album,single&market=from_token&limit=4`, accessToken);
    for (const album of albums.items || []) {
      events.push({
        id: album.id,
        artist: artist.name,
        name: album.name,
        date: album.release_date,
        type: album.album_type,
        url: album.external_urls?.spotify || artist.external_urls?.spotify,
        source: 'spotify'
      });
    }
  }
  return { events };
}"""+s[end:]
start=s.index("function continentForCountry")
end=s.index("\n\nBun.serve")
s=s[:start]+s[end:]
s=s.replace("        return json({ artists: [...deduped.values()].sort((a, b) => a.name.localeCompare(b.name)) });", "        return json({ artists: [...deduped.values()].filter(a => a.id).sort((a, b) => a.name.localeCompare(b.name)) });")
s=s.replace("      if (url.pathname === '/api/concerts' && req.method === 'POST') {\n        const { artists = [], filters = {} } = await req.json();\n        return json(await findEvents(artists, filters));\n      }", "      if (url.pathname === '/api/spotify-releases' && req.method === 'POST') {\n        const token = req.headers.get('authorization')?.replace('Bearer ', '');\n        if (!token) return json({ error: 'Missing bearer token' }, 401);\n        const { artistIds = [] } = await req.json();\n        return json(await getArtistReleases(token, artistIds));\n      }")
p.write_text(s)
