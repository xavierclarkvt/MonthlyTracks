import { resolveRuntimeConfig } from "./sync-helpers.js";
import { SpotifyApiClient } from "./spotify-client.js";
import { MonthlyPlaylistsSync } from "./monthly-sync.js";

export async function runMonthlySync({
  env = process.env,
  cwd = process.cwd(),
} = {}) {
  const config = await resolveRuntimeConfig(env, cwd);
  const client = new SpotifyApiClient({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    refreshToken: config.refreshToken,
  });

  const sync = new MonthlyPlaylistsSync({
    client,
    lastChecked: config.lastChecked,
    nameFormat: config.playlistNameFormat,
    statePath: config.statePath,
    dryRun: config.dryRun,
  });

  const result = await sync.updateMonthlyPlaylists();

  return {
    config,
    result,
  };
}