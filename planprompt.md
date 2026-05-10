# Plan: Convert Spotify Monthly Saves to Multi-User Web App

Replace the single-user CLI tool with a multi-user Bun web app (`Bun.serve()` + `bun:sqlite`) and vanilla HTML/JS frontend. Users authenticate via Spotify OAuth, then trigger syncs from the browser. Six phases, each producing a working system you can stop at.

**Architecture**: Bun HTTP server → SQLite database → vanilla HTML/JS/CSS frontend. Zero external dependencies.

---

## Phase 1: Bun HTTP Server + Web-Triggered Sync (Single-User)

**Goal**: Running web server that can trigger the existing sync logic via browser.

**Changes:**

- New `server.js` — `Bun.serve()` entrypoint with static file serving and route dispatch
- New `src/router.js` — simple method+pathname → handler dispatch (no framework)
- New `public/index.html`, `public/app.js`, `public/styles.css` — landing page with a working "Sync Now" button
- Route: `POST /api/sync` — imports and calls the existing sync logic using `.env` credentials (same as `main.js`), returns JSON results
- Keep `main.js` — CLI `bun run sync` still works alongside the web UI
- Update `package.json` scripts: add `"start": "bun run server.js"` (keep existing `"sync"` script)

**Frontend behavior:**

- "Sync Now" button triggers `POST /api/sync`
- Shows loading state during sync
- Displays results: songs found, added, skipped

**Functional at this point**: Web server at localhost:3000 with a working sync button — same functionality as the CLI, now accessible from a browser.

---

## Phase 2: SQLite Database + Multi-User Schema

**Goal**: Database foundation. No more JSON state file.

**Changes:**

- New `src/db.js` — opens `data/spotify-monthly-saves.db` via `bun:sqlite`, auto-creates tables
- Schema: `users` table (id, display_name, encrypted refresh_token, last_checked, playlist_name_format) + `sync_history` table (timestamps, counts, status)
- Encrypt refresh tokens at rest via AES-256-GCM (Web Crypto API, no deps)

**Functional at this point**: Server starts and initializes database. Tables ready for Phase 3.

---

## Phase 3: Spotify OAuth Web Flow + Sessions

**Goal**: Users can log in via Spotify. Multi-user identity established.

**Changes:**

- New `src/auth.js` — OAuth handlers + HMAC-signed cookie creation/verification
- Routes: `GET /auth/login` → Spotify authorize redirect, `GET /auth/callback` → exchange code + set cookie, `POST /auth/logout`, `GET /api/me`
- Delete `src/bootstrap-refresh-token.js` (replaced by web OAuth)
- Frontend: "Connect with Spotify" button works; after login, shows user's display name + logout link

**Session approach**: Stateless signed cookie — `userId:expiry:HMAC-SHA256(userId:expiry, COOKIE_SECRET)`. SameSite=Lax, HttpOnly, 30-day expiry. No sessions table needed.

**Functional at this point**: Anyone with a Spotify account can log in, see their name, log out. Identity persists across page reloads.

---

## Phase 4: Per-User Web-Triggered Sync

**Goal**: Core feature — logged-in users trigger sync from the browser.

**Changes:**

- Refactor `src/spotify-client.js` — `SpotifyClient` accepts `(refreshToken)` as a constructor arg; `clientId` and `clientSecret` stay in `.env` (same for all users)
- Refactor `src/monthly-sync.js` — `sync()` accepts params `{spotifyClient, lastChecked, playlistNameFormat}`, returns structured results `{newSongsFound, songsAdded, songsSkipped, playlistsAffected}` instead of logging
- Modify `src/sync-helpers.js` — remove `resolveRuntimeConfig()` state-file logic; keep all pure functions (filter, group, format, sort)
- Refactor `POST /api/sync` route — reads user's refresh token from DB instead of `.env`, stores results in `sync_history`, updates `last_checked` in DB
- Delete `main.js` — CLI replaced by web UI; single-user `.env` path no longer needed
- Frontend: update sync button to require login (redirect to login if unauthenticated)

**Key reuse**: All existing Spotify API logic (pagination, retry, dedup, batching) stays intact — only the data source changes from env vars to function parameters.

**Functional at this point**: Full working multi-user app. Any logged-in user can sync their liked songs into monthly playlists.

---

## Phase 5: Sync History Dashboard

**Goal**: Visibility into past sync runs.

**Changes:**

- Route: `GET /api/history` — returns last 20 syncs for the authenticated user
- Frontend: "Recent Syncs" table (date, songs found, songs added, playlists, status), auto-refreshes after sync

**Functional at this point**: Users have a complete dashboard with sync history.

---

## Phase 6: Automatic Background Sync

**Goal**: Opt-in daily auto-sync.

**Changes:**

- New `src/scheduler.js` — hourly `setInterval()` checks for users due for sync (auto_sync_enabled + last_checked > 24h ago)
- Add `auto_sync_enabled` column to users table
- Routes: `POST /api/settings/auto-sync` toggle, `GET /api/settings`
- Frontend: "Enable automatic daily sync" toggle in settings area
- Syncs run sequentially per user to avoid Spotify rate limits

**Functional at this point**: Fully hands-off operation after initial setup.

---

## Relevant Files

| File                             | Action                                       | Phases        |
| -------------------------------- | -------------------------------------------- | ------------- |
| `server.js`                      | **Create**                                   | 1             |
| `src/router.js`                  | **Create**, then extend                      | 1, 3, 4, 5, 6 |
| `src/db.js`                      | **Create**, then extend                      | 2, 4, 5, 6    |
| `src/auth.js`                    | **Create**                                   | 3             |
| `src/scheduler.js`               | **Create**                                   | 6             |
| `public/index.html`              | **Create**, evolve each phase                | 1–6           |
| `public/app.js`                  | **Create**, evolve each phase                | 1–6           |
| `public/styles.css`              | **Create**                                   | 1             |
| `src/spotify-client.js`          | **Refactor** (per-user creds)                | 4             |
| `src/monthly-sync.js`            | **Refactor** (parameterized, return results) | 4             |
| `src/sync-helpers.js`            | **Modify** (remove state-file logic)         | 4             |
| `main.js`                        | **Delete**                                   | 4             |
| `src/bootstrap-refresh-token.js` | **Delete**                                   | 3             |

## Decisions

- **Zero external deps**: `Bun.serve()`, `bun:sqlite`, Web Crypto API cover all needs
- **Spotify OAuth = identity**: no separate signup — Spotify user ID is the DB primary key
- **Stateless sessions**: HMAC-signed cookies, no sessions table
- **Refresh token encryption at rest**: AES-256-GCM derived from `COOKIE_SECRET` — required for a public-facing service
- **Sequential auto-sync**: one user at a time to respect Spotify rate limits

## Verification (per phase)

1. `bun run server.js` → browser shows landing page at localhost:3000; clicking "Sync Now" runs the sync and displays results
2. Server start creates SQLite DB + tables; unit tests for db helpers
3. Full OAuth round-trip: click login → Spotify → callback → see name → refresh page → still logged in → logout
4. Click "Sync Now" → songs sync to Spotify playlists → results shown; two users sync independently; existing `sync-helpers` tests pass
5. History table populates after syncs; shows correct counts and statuses
6. Toggle auto-sync on → new sync_history entry appears within the hour; toggle off → stops
