import { SpotifyApiClient } from "./spotify-client.js";
import {
  getDefaultFormat,
  getDefaultLastChecked,
  filterNewSongs,
  getNewestSongTimestamp,
  groupSongsByPlaylistName,
} from "./sync-helpers.js";

function chunk(items, size) {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

class Playlist {
  constructor(client, playlist) {
    this.client = client;
    this.id = playlist.id;
    this.name = playlist.name;
    this.songIds = null;
  }

  async ensureSongIdsLoaded() {
    if (this.songIds) {
      return;
    }

    const tracks = await this.client.getAllPlaylistTracks(this.id);
    this.songIds = new Set(
      tracks.map((item) => item?.track?.id).filter(Boolean)
    );
  }

  async addSongs(songs, { log = console.log } = {}) {
    await this.ensureSongIdsLoaded();

    const songsToAdd = [];
    let skipped = 0;

    for (const song of songs) {
      if (this.songIds.has(song.id)) {
        log(`${song.name} already in ${this.name}`);
        skipped += 1;
        continue;
      }

      songsToAdd.push(song);
    }

    if (songsToAdd.length === 0) {
      return { added: 0, skipped };
    }

    for (const batch of chunk(songsToAdd, 100)) {
      await this.client.addItemsToPlaylist(
        this.id,
        batch.map((song) => song.uri)
      );

      for (const song of batch) {
        this.songIds.add(song.id);
        log(`${song.name} added to ${this.name}`);
      }
    }

    return { added: songsToAdd.length, skipped };
  }
}

class MonthlyPlaylistsSync {
  constructor({ client, currentUser = null, lastChecked, nameFormat }) {
    this.client = client;
    this.currentUser = currentUser;
    this.lastChecked = lastChecked;
    this.nameFormat = nameFormat;
  }

  async getPlaylistsByName() {
    const playlists = await this.client.getAllPlaylists();
    const playlistMap = new Map();

    for (const playlist of playlists) {
      playlistMap.set(playlist.name, new Playlist(this.client, playlist));
    }

    return playlistMap;
  }

  async createPlaylist(userId, name) {
    const playlist = await this.client.createPlaylist(userId, name);
    console.log(`${name} was created`);
    return new Playlist(this.client, playlist);
  }

  async updateMonthlyPlaylists() {
    const savedSongs = await this.client.getSavedTracksSince(this.lastChecked);
    const newSongs = filterNewSongs(savedSongs, this.lastChecked);

    if (newSongs.length === 0) {
      console.log("No new songs");
      return { newSongs: 0, added: 0, skipped: 0 };
    }

    const user = this.currentUser ?? (await this.client.getCurrentUser());
    this.currentUser = user;
    const playlistsByName = await this.getPlaylistsByName();
    let added = 0;
    let skipped = 0;

    for (const group of groupSongsByPlaylistName(newSongs, this.nameFormat)) {
      let playlist = playlistsByName.get(group.name);

      if (!playlist) {
        playlist = await this.createPlaylist(user.id, group.name);
        playlistsByName.set(group.name, playlist);
      }

      const result = await playlist.addSongs(group.songs);
      added += result.added;
      skipped += result.skipped;
    }

    this.lastChecked = getNewestSongTimestamp(newSongs);

    return {
      newSongs: newSongs.length,
      added,
      skipped,
      lastChecked: this.lastChecked,
    };
  }
}

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
  userId,
  clientClass = SpotifyApiClient,
  monthlySyncClass = MonthlyPlaylistsSync,
} = {}) {
  const clientId = getRequiredEnv(env, "CLIENT_ID");
  const clientSecret = getRequiredEnv(env, "CLIENT_SECRET");

  const userWithToken = await database.getUserWithRefreshToken(userId);

  if (!userWithToken) {
    throw new Error("User not found");
  }

  const { lastChecked, lastCheckedSource } = resolveLastChecked(userWithToken);
  const playlistNameFormat =
    userWithToken.playlistNameFormat ||
    getDefaultFormat(userWithToken.playlistFrequency);

  const client = new clientClass({
    clientId,
    clientSecret,
    refreshToken: userWithToken.refreshToken,
  });

  const sync = new monthlySyncClass({
    client,
    currentUser: {
      id: userWithToken.id,
      display_name: userWithToken.displayName,
    },
    lastChecked,
    nameFormat: playlistNameFormat,
  });

  const startedAt = new Date();

  try {
    const result = await sync.updateMonthlyPlaylists();

    await database.upsertUser({
      id: userWithToken.id,
      displayName: userWithToken.displayName,
      refreshToken: client.refreshToken,
      lastChecked: result.lastChecked ?? userWithToken.lastChecked ?? null,
      playlistNameFormat,
      playlistFrequency: userWithToken.playlistFrequency,
    });

    database.insertSyncHistory({
      userId: userWithToken.id,
      startedAt,
      finishedAt: new Date(),
      newSongsFound: result.newSongs,
      songsAdded: result.added,
      songsSkipped: result.skipped,
      playlistsAffected: 0,
      status: "completed",
    });

    return {
      config: {
        playlistNameFormat,
        playlistFrequency: userWithToken.playlistFrequency,
        lastChecked,
        lastCheckedSource,
      },
      result,
    };
  } catch (error) {
    database.insertSyncHistory({
      userId: userWithToken.id,
      startedAt,
      finishedAt: new Date(),
      status: "failed",
      errorMessage: error instanceof Error ? error.message : String(error),
    });

    throw error;
  }
}
