import { resolveRuntimeConfig } from "./src/sync-helpers.js";
import { SpotifyApiClient } from "./src/spotify-client.js";
import { MonthlyPlaylistsSync } from "./src/monthly-sync.js";

async function main() {
  const config = await resolveRuntimeConfig(process.env, process.cwd());
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

  console.log(
    `Using ${config.lastCheckedSource} threshold: ${config.lastChecked.toISOString()}`,
  );

  const result = await sync.updateMonthlyPlaylists();

  if (result.newSongs === 0) {
    return;
  }

  console.log(
    `Processed ${result.newSongs} new song(s); ${result.added} added, ${result.skipped} already present.`,
  );

  if (!config.dryRun) {
    console.log(`State saved to ${config.statePath}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});