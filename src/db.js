import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Database } from "bun:sqlite";

export const DEFAULT_DATABASE_FILE = "data/spotify-monthly-saves.db";

const encoder = new TextEncoder();
const ENCRYPTION_VERSION = "v1";
const ENCRYPTION_CONTEXT = "spotify-monthly-saves:refresh-token";

// Derive a stable AES-GCM key from COOKIE_SECRET so stored refresh tokens can be decrypted later.
async function deriveEncryptionKey(cookieSecret) {
  const keyMaterial = encoder.encode(`${ENCRYPTION_CONTEXT}:${cookieSecret}`);
  const digest = await crypto.subtle.digest("SHA-256", keyMaterial);

  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
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
    encoder.encode(refreshToken)
  );

  return [
    ENCRYPTION_VERSION,
    Buffer.from(iv).toString("base64"),
    Buffer.from(new Uint8Array(ciphertext)).toString("base64"),
  ].join(".");
}

export async function decryptRefreshToken(encryptedRefreshToken, cookieSecret) {
  const [version, ivValue, ciphertextValue] = encryptedRefreshToken.split(".");

  if (version !== ENCRYPTION_VERSION || !ivValue || !ciphertextValue) {
    throw new Error("Invalid encrypted refresh token payload");
  }

  const key = await deriveEncryptionKey(cookieSecret);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(Buffer.from(ivValue, "base64")) },
    key,
    new Uint8Array(Buffer.from(ciphertextValue, "base64"))
  );

  return Buffer.from(plaintext).toString("utf8");
}

export class SpotifyMonthlySavesDatabase {
  constructor({ db, databasePath, env = process.env }) {
    this.db = db;
    this.databasePath = databasePath;
    this.env = env;
  }

  close() {
    this.db.close();
  }

  getUser(userId) {
    const row = this.db
      .query(
        `
          SELECT
            id,
            display_name,
            encrypted_refresh_token,
            last_checked,
            playlist_name_format,
            playlist_frequency,
            created_at,
            updated_at
          FROM users
          WHERE id = ?
        `
      )
      .get(userId);

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      displayName: row.display_name,
      encryptedRefreshToken: row.encrypted_refresh_token,
      lastChecked: row.last_checked ? new Date(row.last_checked) : null,
      playlistNameFormat: row.playlist_name_format,
      playlistFrequency: row.playlist_frequency,
      createdAt: row.created_at ? new Date(row.created_at) : null,
      updatedAt: row.updated_at ? new Date(row.updated_at) : null,
    };
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
        this.env.COOKIE_SECRET.trim() // will error if COOKIE_SECRET is missing or empty, which is expected
      ),
    };
  }

  async upsertUser({
    id,
    displayName,
    refreshToken,
    lastChecked = null,
    playlistNameFormat = "'%y %b",
    playlistFrequency = "monthly",
  }) {
    const encryptedRefreshToken = await encryptRefreshToken(
      refreshToken,
      this.env.COOKIE_SECRET.trim() // will error if COOKIE_SECRET is missing or empty, which is expected
    );

    this.db
      .query(
        `
        INSERT INTO users (
          id,
          display_name,
          encrypted_refresh_token,
          last_checked,
          playlist_name_format,
          playlist_frequency
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          display_name = excluded.display_name,
          encrypted_refresh_token = excluded.encrypted_refresh_token,
          last_checked = excluded.last_checked,
          playlist_name_format = excluded.playlist_name_format,
          playlist_frequency = excluded.playlist_frequency,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      `
      )
      .run(
        id,
        displayName,
        encryptedRefreshToken,
        lastChecked instanceof Date
          ? lastChecked.toISOString()
          : (lastChecked ?? null),
        playlistNameFormat,
        playlistFrequency
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
    const result = this.db
      .query(
        `
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
      `
      )
      .run(
        userId,
        startedAt instanceof Date
          ? startedAt.toISOString()
          : (startedAt ?? null),
        finishedAt instanceof Date
          ? finishedAt.toISOString()
          : (finishedAt ?? null),
        newSongsFound,
        songsAdded,
        songsSkipped,
        playlistsAffected,
        status,
        errorMessage
      );

    return Number(result.lastInsertRowid);
  }

  updateSettings({ userId, playlistNameFormat, playlistFrequency }) {
    const fields = {
      playlist_name_format: playlistNameFormat,
      playlist_frequency: playlistFrequency,
      // reset the last_checked to make new playlist create correctly after playlist name / frequency change
      last_checked:
        playlistNameFormat !== undefined || playlistFrequency !== undefined
          ? null
          : undefined,
    };

    const entries = Object.entries(fields).filter(([, v]) => v !== undefined);

    if (entries.length === 0) {
      return this.getUser(userId);
    }

    this.db
      .query(
        `UPDATE users SET 
          ${entries.map(([col]) => `${col} = ?`).join(", ")},
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ?`
      )
      .run(...entries.map(([, v]) => v), userId);

    return this.getUser(userId);
  }

  getUsersDueForSync() {
    const rows = this.db
      .query(
        `
        SELECT id
        FROM users
        WHERE (
            last_checked IS NULL
            OR last_checked < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 minutes')
          )
        ORDER BY last_checked ASC
      `
      )
      .all();

    return rows.map((row) => row.id);
  }

  getTotalSongsAdded(userId) {
    const row = this.db
      .query(
        `SELECT COALESCE(SUM(songs_added), 0) AS total FROM sync_history WHERE user_id = ?`
      )
      .get(userId);

    return Number(row.total);
  }

  deleteUser(userId) {
    this.db.query("DELETE FROM users WHERE id = ?").run(userId);
  }
}

export async function initializeDatabase({
  cwd = process.cwd(),
  env = process.env,
  databasePath = resolve(cwd, DEFAULT_DATABASE_FILE),
  DatabaseImpl = Database,
} = {}) {
  await mkdir(dirname(databasePath), { recursive: true });

  const db = new DatabaseImpl(databasePath);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA journal_mode = WAL;");

  // scuffed migrations system
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      encrypted_refresh_token TEXT NOT NULL,
      last_checked TEXT,
      playlist_name_format TEXT NOT NULL DEFAULT '"%B %Y"',
      playlist_frequency TEXT NOT NULL DEFAULT 'monthly' CHECK (playlist_frequency IN ('monthly', 'quarterly')),
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

  return new SpotifyMonthlySavesDatabase({
    db,
    databasePath,
    env,
  });
}
