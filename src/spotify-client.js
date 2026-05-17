import { normalizeSavedTrack } from "./sync-helpers.js";

const ACCOUNTS_BASE_URL = "https://accounts.spotify.com";
const API_BASE_URL = "https://api.spotify.com/v1";

function encodeBasicAuth(clientId, clientSecret) {
  return Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64");
}

function toErrorMessage(body) {
  if (typeof body === "string") {
    return body;
  }

  if (body?.error_description) {
    return body.error_description;
  }

  if (body?.error?.message) {
    return body.error.message;
  }

  if (body?.error) {
    return typeof body.error === "string"
      ? body.error
      : JSON.stringify(body.error);
  }

  return JSON.stringify(body);
}

async function parseResponseBody(response) {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class SpotifyApiClient {
  constructor({ clientId, clientSecret, refreshToken, fetchImpl = fetch }) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.refreshToken = refreshToken;
    this.fetchImpl = fetchImpl;
    this.accessToken = null;
    this.accessTokenExpiresAt = 0;
  }

  async getAccessToken(forceRefresh = false) {
    const now = Date.now();

    if (
      !forceRefresh &&
      this.accessToken &&
      now < this.accessTokenExpiresAt - 30000
    ) {
      return this.accessToken;
    }

    const response = await this.fetchImpl(`${ACCOUNTS_BASE_URL}/api/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${encodeBasicAuth(this.clientId, this.clientSecret)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: this.refreshToken,
      }),
    });

    const body = await parseResponseBody(response);

    if (!response.ok || !body?.access_token) {
      throw new Error(`Spotify token refresh failed: ${toErrorMessage(body)}`);
    }

    this.accessToken = body.access_token;
    this.accessTokenExpiresAt = now + Number(body.expires_in ?? 3600) * 1000;

    if (body.refresh_token) {
      this.refreshToken = body.refresh_token;
    }

    return this.accessToken;
  }

  async request(path, options = {}, attempt = 0) {
    const token = await this.getAccessToken(attempt > 0);
    const requestUrl = path.startsWith("http")
      ? path
      : `${API_BASE_URL}${path}`;
    const response = await this.fetchImpl(requestUrl, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    });

    if (response.status === 401 && attempt < 1) {
      return this.request(path, options, attempt + 1);
    }

    if (response.status === 429 && attempt < 5) {
      const retryAfterSeconds = Number(
        response.headers.get("retry-after") ?? 1
      );
      await wait(retryAfterSeconds * 1000);
      return this.request(path, options, attempt + 1);
    }

    const body = await parseResponseBody(response);

    if (!response.ok) {
      throw new Error(
        `Spotify API request failed (${response.status}): ${toErrorMessage(body)}`
      );
    }

    return body;
  }

  async getCurrentUser() {
    return this.request("/me");
  }

  async getSavedTracksSince(lastChecked) {
    const songs = [];
    let offset = 0;

    while (true) {
      const page = await this.request(`/me/tracks?limit=50&offset=${offset}`);
      const items = Array.isArray(page?.items) ? page.items : [];

      if (items.length === 0) {
        break;
      }

      const normalized = items.map(normalizeSavedTrack).filter(Boolean);
      songs.push(...normalized);

      const oldestSong = normalized.at(-1);

      if (!page.next || !oldestSong || oldestSong.addedAt <= lastChecked) {
        break;
      }

      offset += items.length;
    }

    return songs;
  }

  async getAllPlaylists() {
    const playlists = [];
    let next = "/me/playlists?limit=50";

    while (next) {
      const page = await this.request(next);
      playlists.push(...(page?.items ?? []).filter(Boolean));
      next = page?.next ?? null;
    }

    return playlists;
  }

  async getAllPlaylistTracks(playlistId) {
    const items = [];
    let next = `/playlists/${playlistId}/tracks?limit=100&fields=items(track(id,name,uri)),next,total`;

    while (next) {
      const page = await this.request(next);
      items.push(...(page?.items ?? []));
      next = page?.next ?? null;
    }

    return items;
  }

  async createPlaylist(userId, name) {
    return this.request(`/users/${userId}/playlists`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name,
      }),
    });
  }

  async addItemsToPlaylist(playlistId, uris) {
    return this.request(`/playlists/${playlistId}/tracks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ uris }),
    });
  }
}
