import { describe, expect, test } from "bun:test";
import { runMonthlySync } from "../src/run-sync.js";

class FakeSpotifyClient {
  constructor(options) {
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.refreshToken = options.refreshToken;
  }
}

class FakeMonthlySync {
  static lastOptions = null;

  constructor(options) {
    FakeMonthlySync.lastOptions = options;
  }

  async updateMonthlyPlaylists() {
    return {
      newSongs: 3,
      added: 2,
      skipped: 1,
      lastChecked: new Date("2026-05-06T12:00:00Z"),
    };
  }
}

function createFakeDatabase(storedUser = null) {
  const upsertCalls = [];
  const syncHistoryCalls = [];

  return {
    upsertCalls,
    syncHistoryCalls,
    getUser(userId) {
      expect(userId).toBe("spotify-user-1");
      return storedUser;
    },
    async getUserWithRefreshToken(userId) {
      expect(userId).toBe("spotify-user-1");

      if (!storedUser) {
        return null;
      }

      return { ...storedUser, refreshToken: "refresh-token-123" };
    },
    async upsertUser(payload) {
      upsertCalls.push(payload);

      return {
        id: payload.id,
        displayName: payload.displayName,
        lastChecked: payload.lastChecked,
        playlistNameFormat: payload.playlistNameFormat,
      };
    },
    insertSyncHistory(payload) {
      syncHistoryCalls.push(payload);
      return 1;
    },
  };
}

describe("runMonthlySync", () => {
  test("uses users.last_checked from SQLite and persists the new checkpoint", async () => {
    const database = createFakeDatabase({
      id: "spotify-user-1",
      displayName: "Phase 2 User",
      lastChecked: new Date("2026-05-02T00:00:00Z"),
      playlistNameFormat: "%Y-%m",
    });

    const { config, result } = await runMonthlySync({
      env: {
        CLIENT_ID: "client-id",
        CLIENT_SECRET: "client-secret",
        COOKIE_SECRET: "cookie-secret",
      },
      database,
      userId: "spotify-user-1",
      clientClass: FakeSpotifyClient,
      monthlySyncClass: FakeMonthlySync,
    });

    expect(config.lastChecked.toISOString()).toBe("2026-05-02T00:00:00.000Z");
    expect(config.lastCheckedSource).toBe("users.last_checked");
    expect(config.playlistNameFormat).toBe("%Y-%m");
    expect(FakeMonthlySync.lastOptions.currentUser.id).toBe("spotify-user-1");
    expect(FakeMonthlySync.lastOptions.lastChecked.toISOString()).toBe(
      "2026-05-02T00:00:00.000Z"
    );
    expect(database.upsertCalls).toHaveLength(1);
    expect(database.upsertCalls[0].lastChecked?.toISOString()).toBe(
      "2026-05-06T12:00:00.000Z"
    );
    expect(result.lastChecked?.toISOString()).toBe("2026-05-06T12:00:00.000Z");

    expect(database.syncHistoryCalls).toHaveLength(1);
    expect(database.syncHistoryCalls[0].status).toBe("completed");
    expect(database.syncHistoryCalls[0].newSongsFound).toBe(3);
    expect(database.syncHistoryCalls[0].songsAdded).toBe(2);
    expect(database.syncHistoryCalls[0].songsSkipped).toBe(1);
  });

  test("falls back to default current-month start when user has no last_checked", async () => {
    const database = createFakeDatabase({
      id: "spotify-user-1",
      displayName: "New User",
      lastChecked: null,
      playlistNameFormat: "%b '%y",
    });

    const { config } = await runMonthlySync({
      env: {
        CLIENT_ID: "client-id",
        CLIENT_SECRET: "client-secret",
        COOKIE_SECRET: "cookie-secret",
      },
      database,
      userId: "spotify-user-1",
      clientClass: FakeSpotifyClient,
      monthlySyncClass: FakeMonthlySync,
    });

    expect(config.lastCheckedSource).toBe("default current-month start");
  });

  test("throws when user is not found in the database", async () => {
    const database = createFakeDatabase(null);

    await expect(
      runMonthlySync({
        env: {
          CLIENT_ID: "client-id",
          CLIENT_SECRET: "client-secret",
          COOKIE_SECRET: "cookie-secret",
        },
        database,
        userId: "spotify-user-1",
        clientClass: FakeSpotifyClient,
        monthlySyncClass: FakeMonthlySync,
      })
    ).rejects.toThrow("User not found");
  });

  test("records failed sync history when sync throws", async () => {
    class FailingSync {
      constructor() {}
      async updateMonthlyPlaylists() {
        throw new Error("Spotify API rate limited");
      }
    }

    const database = createFakeDatabase({
      id: "spotify-user-1",
      displayName: "Test User",
      lastChecked: new Date("2026-05-01T00:00:00Z"),
      playlistNameFormat: "%b '%y",
    });

    await expect(
      runMonthlySync({
        env: {
          CLIENT_ID: "client-id",
          CLIENT_SECRET: "client-secret",
          COOKIE_SECRET: "cookie-secret",
        },
        database,
        userId: "spotify-user-1",
        clientClass: FakeSpotifyClient,
        monthlySyncClass: FailingSync,
      })
    ).rejects.toThrow("Spotify API rate limited");

    expect(database.syncHistoryCalls).toHaveLength(1);
    expect(database.syncHistoryCalls[0].status).toBe("failed");
    expect(database.syncHistoryCalls[0].errorMessage).toBe(
      "Spotify API rate limited"
    );
  });
});
