import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { DEFAULT_PLAYLIST_NAME_FORMAT } from "./sync-helpers.js";

export const DEFAULT_DATABASE_FILE = "data/spotify-monthly-saves.db";

const encoder = new TextEncoder();
const ENCRYPTION_VERSION = "v1";
const ENCRYPTION_CONTEXT = "spotify-monthly-saves:refresh-token";
const defaultPlaylistNameFormatSql = DEFAULT_PLAYLIST_NAME_FORMAT.replaceAll("'", "''");

function toBase64Url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");

  return new Uint8Array(Buffer.from(padded, "base64"));
}

function getRequiredCookieSecret(env) {
  const value = env.COOKIE_SECRET?.trim();

  if (!value) {
    throw new Error("Missing required environment variable COOKIE_SECRET");
  }

  return value;
}

async function deriveEncryptionKey(cookieSecret) {
  const keyMaterial = encoder.encode(`${ENCRYPTION_CONTEXT}:${cookieSecret}`);
  const digest = await crypto.subtle.digest("SHA-256", keyMaterial);

  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

function normalizeUserRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    displayName: row.display_name,
    encryptedRefreshToken: row.encrypted_refresh_token,
    lastChecked: row.last_checked ? new Date(row.last_checked) : null,
    playlistNameFormat: row.playlist_name_format,
    createdAt: row.created_at ? new Date(row.created_at) : null,
    updatedAt: row.updated_at ? new Date(row.updated_at) : null,
  };
}

function toTimestampValue(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return value;
}

export async function encryptRefreshToken(refreshToken, cookieSecret) {
  if (!refreshToken?.trim()) {
    throw new Error("Refresh token is required");
  }

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveEncryptionKey(cookieSecret);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(refreshToken),
  );

  return [
    ENCRYPTION_VERSION,
    toBase64Url(iv),
    toBase64Url(new Uint8Array(ciphertext)),
  ].join(".");
}

export async function decryptRefreshToken(encryptedRefreshToken, cookieSecret) {
  const [version, ivValue, ciphertextValue] = encryptedRefreshToken.split(".");

  if (version !== ENCRYPTION_VERSION || !ivValue || !ciphertextValue) {
    throw new Error("Invalid encrypted refresh token payload");
  }

  const key = await deriveEncryptionKey(cookieSecret);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64Url(ivValue) },
    key,
    fromBase64Url(ciphertextValue),
  );

  return Buffer.from(plaintext).toString("utf8");
}

export function resolveDatabasePath({ cwd = process.cwd(), env = process.env } = {}) {
  return resolve(cwd, DEFAULT_DATABASE_FILE);
}

function applySchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      encrypted_refresh_token TEXT NOT NULL,
      last_checked TEXT,
      playlist_name_format TEXT NOT NULL DEFAULT '${defaultPlaylistNameFormatSql}',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS sync_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      new_songs_found INTEGER NOT NULL DEFAULT 0,
      songs_added INTEGER NOT NULL DEFAULT 0,
      songs_skipped INTEGER NOT NULL DEFAULT 0,
      playlists_affected INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      error_message TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS sync_history_user_id_started_at_idx
    ON sync_history (user_id, started_at DESC);
  `);
}

export class SpotifyMonthlySavesDatabase {
  constructor({ db, databasePath, env = process.env }) {
    this.db = db;
    this.databasePath = databasePath;
    this.env = env;
    this.statements = {
      upsertUser: this.db.query(`
        INSERT INTO users (
          id,
          display_name,
          encrypted_refresh_token,
          last_checked,
          playlist_name_format
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          display_name = excluded.display_name,
          encrypted_refresh_token = excluded.encrypted_refresh_token,
          last_checked = excluded.last_checked,
          playlist_name_format = excluded.playlist_name_format,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      `),
      selectUserById: this.db.query(`
        SELECT
          id,
          display_name,
          encrypted_refresh_token,
          last_checked,
          playlist_name_format,
          created_at,
          updated_at
        FROM users
        WHERE id = ?
      `),
      insertSyncHistory: this.db.query(`
        INSERT INTO sync_history (
          user_id,
          started_at,
          finished_at,
          new_songs_found,
          songs_added,
          songs_skipped,
          playlists_affected,
          status,
          error_message
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
    };
  }

  close() {
    this.db.close();
  }

  getUser(userId) {
    return normalizeUserRow(this.statements.selectUserById.get(userId));
  }

  async getUserWithRefreshToken(userId) {
    const user = this.getUser(userId);

    if (!user) {
      return null;
    }

    return {
      ...user,
      refreshToken: await decryptRefreshToken(
        user.encryptedRefreshToken,
        getRequiredCookieSecret(this.env),
      ),
    };
  }

  async upsertUser({
    id,
    displayName,
    refreshToken,
    lastChecked = null,
    playlistNameFormat = DEFAULT_PLAYLIST_NAME_FORMAT,
  }) {
    const encryptedRefreshToken = await encryptRefreshToken(
      refreshToken,
      getRequiredCookieSecret(this.env),
    );

    this.statements.upsertUser.run(
      id,
      displayName,
      encryptedRefreshToken,
      toTimestampValue(lastChecked),
      playlistNameFormat,
    );

    return this.getUser(id);
  }

  insertSyncHistory({
    userId,
    startedAt = new Date(),
    finishedAt = null,
    newSongsFound = 0,
    songsAdded = 0,
    songsSkipped = 0,
    playlistsAffected = 0,
    status,
    errorMessage = null,
  }) {
    const result = this.statements.insertSyncHistory.run(
      userId,
      toTimestampValue(startedAt),
      toTimestampValue(finishedAt),
      newSongsFound,
      songsAdded,
      songsSkipped,
      playlistsAffected,
      status,
      errorMessage,
    );

    return Number(result.lastInsertRowid);
  }
}

export async function initializeDatabase({
  cwd = process.cwd(),
  env = process.env,
  databasePath = resolveDatabasePath({ cwd, env }),
  DatabaseImpl = Database,
} = {}) {
  await mkdir(dirname(databasePath), { recursive: true });

  const db = new DatabaseImpl(databasePath);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA journal_mode = WAL;");
  applySchema(db);

  return new SpotifyMonthlySavesDatabase({
    db,
    databasePath,
    env,
  });
}