import { timingSafeEqual } from "node:crypto";

const SPOTIFY_AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SCOPES = [
  "user-library-read",
  "playlist-read-private",
  "playlist-modify-private",
  "playlist-modify-public",
];

const SESSION_COOKIE_NAME = "session";
const STATE_COOKIE_NAME = "oauth_state";
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const encoder = new TextEncoder();

function parseCookies(request) {
  const header = request.headers.get("cookie") || "";
  const cookies = {};

  for (const part of header.split(";")) {
    const eq = part.indexOf("=");

    if (eq === -1) {
      continue;
    }

    cookies[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }

  return cookies;
}

async function hmacSign(message, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(message)
  );

  return Buffer.from(signature).toString("hex");
}

function formatCookie(name, value, attributes) {
  return `${name}=${value}; ${attributes}`;
}

export async function createSessionCookieHeader(userId, cookieSecret) {
  const expiry = Date.now() + SESSION_MAX_AGE_SECONDS * 1000;
  const payload = `${userId}:${expiry}`;
  const signature = await hmacSign(payload, cookieSecret);

  return formatCookie(
    SESSION_COOKIE_NAME,
    `${payload}:${signature}`,
    `HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}`
  );
}

export async function verifySessionCookie(cookieValue, cookieSecret) {
  if (!cookieValue) {
    return null;
  }

  const lastColon = cookieValue.lastIndexOf(":");

  if (lastColon === -1) {
    return null;
  }

  const payload = cookieValue.slice(0, lastColon);
  const signature = cookieValue.slice(lastColon + 1);
  const secondColon = payload.lastIndexOf(":");

  if (secondColon === -1) {
    return null;
  }

  const userId = payload.slice(0, secondColon);
  const expiryStr = payload.slice(secondColon + 1);
  const expiry = Number(expiryStr);

  if (!userId || !expiry || Number.isNaN(expiry)) {
    return null;
  }

  if (Date.now() > expiry) {
    return null;
  }

  const expectedSignature = await hmacSign(payload, cookieSecret);

  // using timingSafeEqual to prevent against timing attacks when comparing signatures
  const bufA = Buffer.from(signature);
  const bufB = Buffer.from(expectedSignature);

  if (bufA.length !== bufB.length || !timingSafeEqual(bufA, bufB)) {
    return null;
  }

  return userId;
}

export async function getAuthenticatedUserId(request, cookieSecret) {
  const cookies = parseCookies(request);

  return verifySessionCookie(cookies[SESSION_COOKIE_NAME], cookieSecret);
}

export function createAuthHandlers({ database, env = process.env }) {
  const clientId = env.CLIENT_ID?.trim();
  const clientSecret = env.CLIENT_SECRET?.trim();
  const cookieSecret = env.COOKIE_SECRET?.trim();
  const redirectUri = env.SPOTIFY_REDIRECT_URI?.trim();

  if (!clientId || !clientSecret || !cookieSecret || !redirectUri) {
    throw new Error(
      "Missing required environment variable (CLIENT_ID, CLIENT_SECRET, COOKIE_SECRET, or SPOTIFY_REDIRECT_URI)"
    );
  }

  return {
    cookieSecret,

    async handleLogin() {
      const state = crypto.randomUUID();
      const authorizeUrl = new URL(SPOTIFY_AUTHORIZE_URL);
      authorizeUrl.searchParams.set("client_id", clientId);
      authorizeUrl.searchParams.set("response_type", "code");
      authorizeUrl.searchParams.set("redirect_uri", redirectUri);
      authorizeUrl.searchParams.set("scope", SCOPES.join(" "));
      authorizeUrl.searchParams.set("state", state);

      return new Response(null, {
        status: 302,
        headers: [
          ["Location", authorizeUrl.toString()],
          [
            "Set-Cookie",
            formatCookie(
              STATE_COOKIE_NAME,
              state,
              "HttpOnly; SameSite=Lax; Path=/; Max-Age=600"
            ),
          ],
        ],
      });
    },

    async handleCallback(request, url) {
      const error = url.searchParams.get("error");

      if (error) {
        return new Response(`Authorization denied: ${error}`, { status: 403 });
      }

      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const cookies = parseCookies(request);
      const storedState = cookies[STATE_COOKIE_NAME];

      if (!state || !storedState || state !== storedState) {
        return new Response("Invalid OAuth state", { status: 403 });
      }

      if (!code) {
        return new Response("Missing authorization code", { status: 400 });
      }

      const tokenResponse = await fetch(SPOTIFY_TOKEN_URL, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
        }),
      });

      const tokenBody = await tokenResponse.json().catch(() => null);

      if (
        !tokenResponse.ok ||
        !tokenBody?.access_token ||
        !tokenBody?.refresh_token
      ) {
        return new Response("Token exchange failed", { status: 502 });
      }

      const profileResponse = await fetch("https://api.spotify.com/v1/me", {
        headers: { Authorization: `Bearer ${tokenBody.access_token}` },
      });

      const profile = await profileResponse.json().catch(() => null);

      if (!profileResponse.ok || !profile?.id) {
        return new Response("Failed to fetch user profile", { status: 502 });
      }

      const existingUser = database.getUser(profile.id);

      await database.upsertUser({
        id: profile.id,
        displayName: profile.display_name ?? profile.id,
        refreshToken: tokenBody.refresh_token,
        lastChecked: existingUser?.lastChecked ?? null,
        playlistNameFormat: existingUser?.playlistNameFormat,
        playlistFrequency: existingUser?.playlistFrequency,
      });

      const sessionCookie = await createSessionCookieHeader(
        profile.id,
        cookieSecret
      );

      return new Response(null, {
        status: 302,
        headers: [
          ["Location", "/dashboard.html"],
          ["Set-Cookie", sessionCookie],
          [
            "Set-Cookie",
            formatCookie(
              STATE_COOKIE_NAME,
              "",
              "HttpOnly; SameSite=Lax; Path=/; Max-Age=0"
            ),
          ],
        ],
      });
    },

    async handleLogout() {
      return new Response(null, {
        status: 302,
        headers: {
          Location: "/",
          "Set-Cookie": formatCookie(
            SESSION_COOKIE_NAME,
            "",
            "HttpOnly; SameSite=Lax; Path=/; Max-Age=0"
          ),
        },
      });
    },

    async handleMe(request) {
      const userId = await getAuthenticatedUserId(request, cookieSecret);

      if (!userId) {
        return Response.json({ authenticated: false });
      }

      const user = database.getUser(userId);

      if (!user) {
        return Response.json({ authenticated: false });
      }

      return Response.json({
        authenticated: true,
        user: {
          id: user.id,
          displayName: user.displayName,
        },
      });
    },
  };
}
