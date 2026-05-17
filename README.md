# spotify monthly saves

Manual Bun CLI plus a lightweight Bun web server: both entrypoints read your liked songs, find only the songs newer than a saved threshold, create or reuse month playlists, skip duplicates already in those playlists, and add tracks in chronological month order.

## Runtime

- Bun 1.2+
- No runtime dependencies beyond Bun's built-ins
- Spotify app credentials and a user refresh token

## Environment variables

Required:

- `CLIENT_ID`
- `CLIENT_SECRET`
- `SPOTIFY_REFRESH_TOKEN`

Optional:

- `PLAYLIST_NAME_FORMAT`: playlist naming pattern. Default: `%b '%y` which yields names like `May '26`.
- `SPOTIFY_REDIRECT_URI`: required for the browser OAuth flow. Default: `http://127.0.0.1:3000/auth/callback`.
- `COOKIE_SECRET`: required for encrypted refresh-token storage in SQLite.

Bun loads `.env` automatically, so copying `.env.example` to `.env` is enough for local runs.

## Spotify app setup

1. Create an app in the Spotify developer dashboard.
2. Add a redirect URI that matches `SPOTIFY_REDIRECT_URI`. The default in this repo is `http://127.0.0.1:3000/auth/callback`.
3. Copy the app's client ID and client secret into `.env`.

## One-time refresh token bootstrap

The main sync script does not run a browser OAuth flow. Instead, use the helper once to mint a refresh token and then keep that refresh token in `.env`.

1. Set `CLIENT_ID`, `CLIENT_SECRET`, and optionally `SPOTIFY_REDIRECT_URI`.
2. Run:

```sh
bun run bootstrap-token
```

3. Open the printed Spotify authorization URL.
4. Approve the requested scopes.
5. Copy the full redirected URL from the browser address bar.
6. Exchange it for a refresh token:

```sh
bun run bootstrap-token --callback-url "http://127.0.0.1:3000/callback?code=..."
```

7. Copy the printed value into `SPOTIFY_REFRESH_TOKEN` in `.env`.

The requested scopes are:

- `user-library-read`
- `playlist-read-private`
- `playlist-modify-private`
- `playlist-modify-public`

## Run the web UI

```sh
bun run start
```

Then open `http://127.0.0.1:3000` and click `Sync Now`.

The browser sign-in flow uses `SPOTIFY_REDIRECT_URI`, and the callback route in this app is `/auth/callback`.

The current pre-OAuth sync path still uses `.env` Spotify credentials, but its checkpoint now lives in SQLite instead of a JSON state file.

On startup, the server also creates `data/spotify-monthly-saves.db` and ensures the `users` and `sync_history` tables exist for the multi-user phases.

Before Phase 3 OAuth exists, the sync route uses the Spotify account behind `SPOTIFY_REFRESH_TOKEN` as the row key in `users`, stores the encrypted refresh token there, and persists `last_checked` in SQLite. Re-running uses that value to minimize Spotify API calls.

Threshold precedence is:

1. `LAST_CHECKED`
2. `users.last_checked`
3. Start of the current UTC month

## Behavior notes

- Saved tracks are fetched iteratively in pages of 50 until the threshold is crossed.
- Playlists are fetched with pagination.
- Playlist tracks are fetched with pagination before duplicate checks.
- `429 Retry-After` responses are retried automatically.
- `401` responses trigger one access-token refresh and retry.
- Tracks are added in chronological order within each month playlist.

## Tests

```sh
bun test
```

Current automated coverage is intentionally lightweight and focuses on pure logic:

- playlist naming
- new-song filtering
- chronological month grouping
- default threshold calculation
- SQLite schema initialization and refresh-token encryption helpers

## Manual verification checklist

1. Run `bun run sync` with a test or real Spotify account and confirm it creates the expected month playlist and adds only unsynced liked songs.
2. Run it again immediately and confirm it prints `No new songs` or only reports duplicates, with no new inserts.
3. Test with liked songs spanning at least two months and confirm they land in the correct playlist names.
4. Validate pagination with more than 50 liked songs and more than 100 tracks in a target playlist.
5. Inspect the `users.last_checked` value in SQLite and confirm threshold behavior matches `LAST_CHECKED` or the persisted timestamp you expect.
6. Run `bun run start`, load `http://127.0.0.1:3000`, and confirm clicking `Sync Now` shows the latest songs found, added, and skipped counts.

## Non-goals in this migration

- GitHub Actions automation was not migrated in this change.
- No external OAuth client library was added.
- No browser app or callback server is included.
