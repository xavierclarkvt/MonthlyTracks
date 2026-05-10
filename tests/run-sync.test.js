import { describe, expect, test } from "bun:test";
import { runMonthlySync } from "../src/run-sync.js";

class FakeSpotifyClient {
  constructor(options) {
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.refreshToken = options.refreshToken;
  }

  async getCurrentUser() {
    return {
      id: "spotify-user-1",
      display_name: "Phase 2 User",
    };
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

  return {
    upsertCalls,
    getUser(userId) {
      expect(userId).toBe("spotify-user-1");
      return storedUser;
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
  };
}

describe("runMonthlySync", () => {
  test("uses users.last_checked from SQLite and persists the new checkpoint", async () => {
    const database = createFakeDatabase({
      id: "spotify-user-1",
      lastChecked: new Date("2026-05-02T00:00:00Z"),
      playlistNameFormat: "%Y-%m",
    });

    const { config, result } = await runMonthlySync({
      env: {
        CLIENT_ID: "client-id",
        CLIENT_SECRET: "client-secret",
        SPOTIFY_REFRESH_TOKEN: "refresh-token-123",
        COOKIE_SECRET: "cookie-secret",
      },
      database,
      clientClass: FakeSpotifyClient,
      monthlySyncClass: FakeMonthlySync,
    });

    expect(config.lastChecked.toISOString()).toBe("2026-05-02T00:00:00.000Z");
    expect(config.lastCheckedSource).toBe("users.last_checked");
    expect(config.playlistNameFormat).toBe("%Y-%m");
    expect(FakeMonthlySync.lastOptions.currentUser.id).toBe("spotify-user-1");
    expect(FakeMonthlySync.lastOptions.lastChecked.toISOString()).toBe(
      "2026-05-02T00:00:00.000Z",
    );
    expect(database.upsertCalls).toHaveLength(2);
    expect(database.upsertCalls[1].lastChecked?.toISOString()).toBe(
      "2026-05-06T12:00:00.000Z",
    );
    expect(result.lastChecked?.toISOString()).toBe("2026-05-06T12:00:00.000Z");
  });

  test("falls back to default current-month start when no stored user exists", async () => {
    const database = createFakeDatabase(null);

    const { config } = await runMonthlySync({
      env: {
        CLIENT_ID: "client-id",
        CLIENT_SECRET: "client-secret",
        SPOTIFY_REFRESH_TOKEN: "refresh-token-123",
        COOKIE_SECRET: "cookie-secret",
      },
      database,
      clientClass: FakeSpotifyClient,
      monthlySyncClass: FakeMonthlySync,
    });

    expect(config.lastCheckedSource).toBe("default current-month start");
  });
});