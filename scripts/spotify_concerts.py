from pathlib import Path
p=Path('backend/server.ts')
s=p.read_text()
start=s.index('async function getArtistReleases')
end=s.index('\n\nBun.serve')
new=r'''function stripHtml(value: string) {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function getSpotifyConcerts(accessToken: string, artistIds: string[]) {
  const events = [];
  for (const artistId of artistIds.slice(0, 25)) {
    const artist = await spotify(`/artists/${artistId}`, accessToken);
    const concertsUrl = `https://open.spotify.com/artist/${artistId}/concerts`;
    let hasUpcoming = false;
    let title = `${artist.name} tour dates on Spotify`;
    try {
      const res = await fetch(concertsUrl, { headers: { 'user-agent': 'Mozilla/5.0 Spotify Show Finder QA' } });
      const html = await res.text();
      const titleMatch = html.match(/<title>(.*?)<\/title>/i);
      if (titleMatch?.[1]) title = stripHtml(titleMatch[1]);
      hasUpcoming = !html.includes('The artist has no upcoming events') && !html.includes('has no upcoming events near');
    } catch (error) {
      logAuth('spotify_concert_page_fetch_failed', { artistId, message: error instanceof Error ? error.message : 'Fetch failed' });
    }
    events.push({
      id: `spotify-concerts-${artistId}`,
      artist: artist.name,
      name: hasUpcoming ? `${artist.name} has Spotify tour dates` : `${artist.name} concerts on Spotify`,
      date: hasUpcoming ? 'Spotify tour page' : 'No dates detected',
      type: hasUpcoming ? 'concerts' : 'spotify concert page',
      url: concertsUrl,
      source: 'spotify',
      hasUpcoming
    });
  }
  return { events, source: 'spotify-concert-pages' };
}'''
s=s[:start]+new+s[end:]
s=s.replace("      if (url.pathname === '/api/spotify-releases' && req.method === 'POST') {\n        const token = req.headers.get('authorization')?.replace('Bearer ', '');\n        if (!token) return json({ error: 'Missing bearer token' }, 401);\n        const { artistIds = [] } = await req.json();\n        return json(await getArtistReleases(token, artistIds));\n      }", "      if (url.pathname === '/api/spotify-concerts' && req.method === 'POST') {\n        const token = req.headers.get('authorization')?.replace('Bearer ', '');\n        if (!token) return json({ error: 'Missing bearer token' }, 401);\n        const { artistIds = [] } = await req.json();\n        return json(await getSpotifyConcerts(token, artistIds));\n      }")
p.write_text(s)

p=Path('src/main.jsx')
s=p.read_text()
s=s.replace("setLoading('Loading Spotify artist releases');", "setLoading('Checking Spotify concert pages');")
s=s.replace("`${API}/spotify-releases`", "`${API}/spotify-concerts`")
s=s.replace("<p>This now uses Spotify Web API only. Spotify does not expose live concert listings in the public Web API, so Ticketmaster was removed.</p><button onClick={loadArtists}>Refresh artists</button><button onClick={findConcerts} disabled={!selected.length}>Find on Spotify</button>", "<p>This checks Spotify's own artist concert pages. Spotify has no official public concerts API, so we use Spotify's public concert URLs.</p><button onClick={loadArtists}>Refresh artists</button><button onClick={findConcerts} disabled={!selected.length}>Find Spotify concerts</button>")
p.write_text(s)
