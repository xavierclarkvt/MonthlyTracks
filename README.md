```text
 __  __             _   _     _        _______             _
|  \/  |           | | | |   | |      |__   __|           | |
| \  / | ___  _ __ | |_| |__ | |  _   _  | |_ __ __ _  ___| | _____
| |\/| |/ _ \| '_ \| __| '_ \| | | | | | | | '__/ _` |/ __| |/ / __|
| |  | | (_) | | | | |_| | | | |_| |_| | | | | | (_| | (__|   <\__ \
|_|  |_|\___/|_| |_|\__|_| |_|\__|\__, | |_|_|  \__,_|\___|_|\_\___/
                                   __/ |
                                  |___/
```

# MonthlyTracks

MonthlyTracks is a Bun web app that connects to Spotify, reads your Liked Songs, and sorts them into monthly or quarterly playlists. It is meant for people who want an easy way to revisit what they were saving during a specific month, season, or quarter.

The app uses Bun's built-in HTTP server and SQLite support. There are no runtime dependencies beyond Bun.

## Runtime

- Bun 1.2+
- SQLite via `bun:sqlite`

## Features

- Spotify OAuth login flow
- Automatic background sync every 5 minutes for connected users
- Manual test sync from the dashboard
- Monthly or quarterly playlist grouping
- Custom playlist naming formats
- SQLite-backed user storage and sync history
- Encrypted refresh-token storage using `COOKIE_SECRET`
- Account deletion from the dashboard

## Environment variables

Required:

- `CLIENT_ID`
- `CLIENT_SECRET`
- `COOKIE_SECRET`
- `SPOTIFY_REDIRECT_URI`

`COOKIE_SECRET` is used for signed session cookies and for encrypting stored Spotify refresh tokens in SQLite.

## Spotify app setup

1. Create an app in the Spotify developer dashboard.
2. Add a redirect URI that exactly matches `SPOTIFY_REDIRECT_URI`.
3. Copy `.env.example` to `.env` and fill in your Spotify client credentials.

The default callback route in this app is `/auth/callback`.

## Running the app

```sh
bun run start
```

Then open `http://127.0.0.1:3000`.

From there:

1. Sign in with Spotify.
2. You will be redirected to the dashboard.
3. MonthlyTracks will continue checking for new liked songs every 5 minutes.
4. You can also run a manual `Test Sync` from the dashboard to verify what would be picked up immediately.

On startup, the server creates `data/spotify-monthly-saves.db` if needed and ensures the `users` and `sync_history` tables exist.

## How syncing works

- New users default to syncing songs saved since the start of the current UTC month.
- Returning users resume from their stored `last_checked` timestamp in SQLite.
- Songs can be grouped into monthly or quarterly playlists.
- Changing playlist cadence or naming format resets the stored sync checkpoint so future playlists are created using the new settings.

## Tests

```sh
bun test
```

Current automated coverage focuses on the core sync and persistence logic:

- playlist name formatting, including quarter and season tokens
- new-song filtering
- chronological playlist grouping
- default sync threshold calculation
- SQLite schema initialization
- refresh-token encryption and decryption
- sync checkpoint persistence and sync history recording
