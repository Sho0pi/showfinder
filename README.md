# Spotify Show Finder

A Bun + React app that connects to Spotify, pulls artists from followed artists and liked songs, then finds upcoming shows through Ticketmaster. If you don't add a Ticketmaster key, the app still works with demo show results.

## Local setup

```bash
cd spotify-concert-finder
cp .env.example .env
bun install
```

Edit `.env` and add:

```bash
SPOTIFY_CLIENT_ID=...
SPOTIFY_CLIENT_SECRET=...
SPOTIFY_REDIRECT_URI=http://127.0.0.1:45678/callback
```

Then run the app on one port:

```bash
bun run build
bun run start
```

Open `http://127.0.0.1:45678`.

## Spotify Developer Dashboard

In your Spotify app settings, add this exact redirect URI:

```text
http://127.0.0.1:45678/callback
```

It has to match your `.env` exactly, including `127.0.0.1` vs `localhost`, the port, `http`, and `/callback`.

You don't need to paste Spotify access tokens into the dashboard or the app. This app needs the Spotify Client ID and Client Secret, then it gets user tokens through OAuth.

If your Spotify app is in development mode, add your Spotify account email under the app's user access list in the Spotify dashboard.

The app requests these scopes:

```text
user-follow-read user-library-read
```

## Development mode

```bash
bun run dev
```

For fewer Spotify redirect headaches, use the single-port flow above while testing OAuth.

## API routes

`/api/config` checks whether env vars are loaded.
`/api/auth/login` starts Spotify login.
`/callback` handles Spotify's OAuth return.
`/api/me` validates the current user token.
`/api/artists` loads Spotify artists.
`/api/concerts` returns Ticketmaster or demo events.
