import { SpotifyApiClient } from "./spotify-client.js";
import { MonthlyPlaylistsSync } from "./monthly-sync.js";
import {
  DEFAULT_PLAYLIST_NAME_FORMAT,
  getDefaultLastChecked,
} from "./sync-helpers.js";

function getRequiredEnv(env, key) {
  const value = env[key]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable ${key}`);
  }

  return value;
}

function resolveLastChecked(storedUser) {
  if (storedUser?.lastChecked) {
    return {
      lastChecked: storedUser.lastChecked,
      lastCheckedSource: "users.last_checked",
    };
  }

  return {
    lastChecked: getDefaultLastChecked(),
    lastCheckedSource: "default current-month start",
  };
}

export async function runMonthlySync({
  env = process.env,
  database,
  clientClass = SpotifyApiClient,
  monthlySyncClass = MonthlyPlaylistsSync,
} = {}) {
  const clientId = getRequiredEnv(env, "CLIENT_ID");
  const clientSecret = getRequiredEnv(env, "CLIENT_SECRET");
  const refreshToken = getRequiredEnv(env, "SPOTIFY_REFRESH_TOKEN");

  const client = new clientClass({
    clientId,
    clientSecret,
    refreshToken,
  });
  const currentUser = await client.getCurrentUser();
  const storedUser = database.getUser(currentUser.id);
  const playlistNameFormat =
    env.PLAYLIST_NAME_FORMAT?.trim() ||
    storedUser?.playlistNameFormat ||
    DEFAULT_PLAYLIST_NAME_FORMAT;
  const { lastChecked, lastCheckedSource } = resolveLastChecked(storedUser);

  await database.upsertUser({
    id: currentUser.id,
    displayName: currentUser.display_name ?? currentUser.id,
    refreshToken: client.refreshToken,
    lastChecked: storedUser?.lastChecked ?? null,
    playlistNameFormat,
  });

  const sync = new monthlySyncClass({
    client,
    currentUser,
    lastChecked,
    nameFormat: playlistNameFormat,
  });
  const result = await sync.updateMonthlyPlaylists();

  await database.upsertUser({
    id: currentUser.id,
    displayName: currentUser.display_name ?? currentUser.id,
    refreshToken: client.refreshToken,
    lastChecked: result.lastChecked ?? storedUser?.lastChecked ?? null,
    playlistNameFormat,
  });

  return {
    config: {
      clientId,
      clientSecret,
      refreshToken: client.refreshToken,
      playlistNameFormat,
      lastChecked,
      lastCheckedSource,
    },
    result,
  };
}