from pathlib import Path
p = Path('src/main.jsx')
s = p.read_text()
start = s.index('function LoginScreen')
end = s.index('\n\nfunction App()')
new = '''function LoginScreen({ auth }) {
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
}'''
p.write_text(s[:start] + new + s[end:])
