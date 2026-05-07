const SCOPES = [
  "user-library-read",
  "playlist-read-private",
  "playlist-modify-private",
  "playlist-modify-public",
];

function encodeBasicAuth(clientId, clientSecret) {
  return Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64");
}

function getRequiredEnv(key) {
  const value = process.env[key]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable ${key}`);
  }

  return value;
}

function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];

    if (current === "--code") {
      args.code = argv[index + 1];
      index += 1;
      continue;
    }

    if (current === "--callback-url") {
      args.callbackUrl = argv[index + 1];
      index += 1;
    }
  }

  return args;
}

function buildAuthorizationUrl(clientId, redirectUri) {
  const url = new URL("https://accounts.spotify.com/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("show_dialog", "true");
  return url;
}

function getAuthorizationCode(args) {
  if (args.code) {
    return args.code;
  }

  if (!args.callbackUrl) {
    return null;
  }

  const callbackUrl = new URL(args.callbackUrl);
  return callbackUrl.searchParams.get("code");
}

async function exchangeCodeForRefreshToken({
  clientId,
  clientSecret,
  redirectUri,
  code,
}) {
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${encodeBasicAuth(clientId, clientSecret)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      `Spotify authorization-code exchange failed: ${JSON.stringify(body)}`,
    );
  }

  if (!body?.refresh_token) {
    throw new Error(
      "Spotify did not return a refresh token. Remove app consent in Spotify settings and retry with show_dialog enabled.",
    );
  }

  return body.refresh_token;
}

async function main() {
  const clientId = getRequiredEnv("CLIENT_ID");
  const clientSecret = getRequiredEnv("CLIENT_SECRET");
  const redirectUri =
    process.env.SPOTIFY_REDIRECT_URI?.trim() ||
    "http://127.0.0.1:3000/callback";
  const args = parseArgs(process.argv.slice(2));
  const code = getAuthorizationCode(args);

  if (!code) {
    const url = buildAuthorizationUrl(clientId, redirectUri);
    console.log("Open this URL, approve access, and copy the full redirected URL:");
    console.log(url.toString());
    console.log("");
    console.log("Then run one of:");
    console.log("bun run bootstrap-token --callback-url \"PASTE_REDIRECTED_URL_HERE\"");
    console.log("bun run bootstrap-token --code YOUR_AUTHORIZATION_CODE");
    return;
  }

  const refreshToken = await exchangeCodeForRefreshToken({
    clientId,
    clientSecret,
    redirectUri,
    code,
  });

  console.log("SPOTIFY_REFRESH_TOKEN=");
  console.log(refreshToken);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});