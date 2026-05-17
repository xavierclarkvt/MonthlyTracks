import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  decryptRefreshToken,
  encryptRefreshToken,
  initializeDatabase,
} from "../src/db.js";

const cleanupPaths = [];

async function createTempDatabasePath() {
  const directory = await mkdtemp(join(tmpdir(), "spotify-monthly-saves-"));
  cleanupPaths.push(directory);

  return join(directory, "spotify-monthly-saves.db");
}

afterEach(async () => {
  await Promise.all(
    cleanupPaths
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe("refresh token encryption", () => {
  test("round-trips encrypted refresh tokens", async () => {
    const encrypted = await encryptRefreshToken(
      "refresh-token-123",
      "secret-value"
    );

    expect(encrypted).not.toBe("refresh-token-123");
    expect(await decryptRefreshToken(encrypted, "secret-value")).toBe(
      "refresh-token-123"
    );
  });
});

describe("initializeDatabase", () => {
  test("creates the phase 2 schema", async () => {
    const database = await initializeDatabase({
      databasePath: await createTempDatabasePath(),
      env: { COOKIE_SECRET: "secret-value" },
    });

    expect(
      database.db
        .query(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?"
        )
        .get("users")
    ).toEqual({ name: "users" });
    expect(
      database.db
        .query(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?"
        )
        .get("sync_history")
    ).toEqual({ name: "sync_history" });

    database.close();
  });

  test("stores encrypted refresh tokens for users", async () => {
    const database = await initializeDatabase({
      databasePath: await createTempDatabasePath(),
      env: { COOKIE_SECRET: "secret-value" },
    });

    await database.upsertUser({
      id: "spotify-user-1",
      displayName: "Test User",
      refreshToken: "refresh-token-123",
      lastChecked: new Date("2026-05-01T00:00:00Z"),
      playlistNameFormat: "%Y-%m",
    });

    const storedUser = database.getUser("spotify-user-1");
    const hydratedUser =
      await database.getUserWithRefreshToken("spotify-user-1");

    expect(storedUser.encryptedRefreshToken).not.toBe("refresh-token-123");
    expect(storedUser.lastChecked?.toISOString()).toBe(
      "2026-05-01T00:00:00.000Z"
    );
    expect(hydratedUser.refreshToken).toBe("refresh-token-123");
    expect(hydratedUser.playlistNameFormat).toBe("%Y-%m");

    database.close();
  });
});
