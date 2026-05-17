import { isAbsolute, normalize, relative, resolve } from "node:path";
import { createAuthHandlers, getAuthenticatedUserId } from "./src/auth.js";
import { initializeDatabase } from "./src/db.js";
import { createRouter } from "./src/router.js";
import { runMonthlySync } from "./src/run-sync.js";
import { createScheduler } from "./src/scheduler.js";
import {
  getDefaultFormat,
  PLAYLIST_NAME_FORMAT_OPTIONS,
  VALID_PLAYLIST_FREQUENCIES,
} from "./src/sync-helpers.js";

const HOST = process.env.HOST?.trim() || "127.0.0.1";
const PORT = Number(process.env.PORT ?? 3000);
const publicRoot = resolve(process.cwd(), "public");
const database = await initializeDatabase();
const auth = createAuthHandlers({ database });

function json(data, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");

  return new Response(JSON.stringify(data), {
    ...init,
    headers,
  });
}

function getPublicFilePath(pathname) {
  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  const normalizedPath = normalize(relativePath);
  const filePath = resolve(publicRoot, normalizedPath);
  const relativeToRoot = relative(publicRoot, filePath);

  if (relativeToRoot.startsWith("..") || isAbsolute(relativeToRoot)) {
    return null;
  }

  return filePath;
}

async function serveStatic(pathname) {
  const filePath = getPublicFilePath(pathname);

  if (!filePath) {
    return new Response("Not found", { status: 404 });
  }

  const file = Bun.file(filePath);

  if (!(await file.exists())) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(file);
}

const router = createRouter([
  {
    method: "GET",
    pathname: "/auth/login",
    handler: (request, url) => auth.handleLogin(),
  },
  {
    method: "GET",
    pathname: "/auth/callback",
    handler: (request, url) => auth.handleCallback(request, url),
  },
  {
    method: "POST",
    pathname: "/auth/logout",
    handler: () => auth.handleLogout(),
  },
  {
    method: "GET",
    pathname: "/api/me",
    handler: (request) => auth.handleMe(request),
  },
  {
    method: "POST",
    pathname: "/api/sync",
    async handler(request) {
      const userId = await getAuthenticatedUserId(request, auth.cookieSecret);

      if (!userId) {
        return json({ ok: false, error: "Not authenticated" }, { status: 401 });
      }

      try {
        const { config, result } = await runMonthlySync({
          database,
          userId,
        });

        return json({
          ok: true,
          threshold: {
            source: config.lastCheckedSource,
            value: config.lastChecked.toISOString(),
          },
          result: {
            newSongs: result.newSongs,
            added: result.added,
            skipped: result.skipped,
            lastChecked: result.lastChecked?.toISOString() ?? null,
          },
        });
      } catch (error) {
        return json(
          {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          },
          { status: 500 }
        );
      }
    },
  },
  {
    method: "GET",
    pathname: "/api/settings",
    async handler(request) {
      const userId = await getAuthenticatedUserId(request, auth.cookieSecret);

      if (!userId) {
        return json({ ok: false, error: "Not authenticated" }, { status: 401 });
      }

      const user = database.getUser(userId);

      if (!user) {
        return json({ ok: false, error: "User not found" }, { status: 404 });
      }

      return json({
        ok: true,
        settings: {
          autoSyncEnabled: user.autoSyncEnabled,
          playlistNameFormat: user.playlistNameFormat,
          playlistFrequency: user.playlistFrequency,
        },
        formatOptions: VALID_PLAYLIST_FREQUENCIES.map((frequency) => ({
          frequency,
          label: frequency === "monthly" ? "Monthly" : "Quarterly",
          options: PLAYLIST_NAME_FORMAT_OPTIONS.filter(
            (option) => option.frequency === frequency
          ),
        })),
      });
    },
  },
  {
    method: "POST",
    pathname: "/api/settings",
    async handler(request) {
      const userId = await getAuthenticatedUserId(request, auth.cookieSecret);

      if (!userId) {
        return json({ ok: false, error: "Not authenticated" }, { status: 401 });
      }

      const user = database.getUser(userId);

      if (!user) {
        return json({ ok: false, error: "User not found" }, { status: 404 });
      }

      const body = await request?.json();

      if (!body || Array.isArray(body)) {
        return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
      }

      const validators = {
        autoSyncEnabled: (v) =>
          typeof v === "boolean" || "autoSyncEnabled must be a boolean",
        playlistNameFormat: (v) =>
          (typeof v === "string" &&
            PLAYLIST_NAME_FORMAT_OPTIONS.some((o) => o.value === v)) ||
          "Invalid playlistNameFormat",
        playlistFrequency: (v) =>
          (typeof v === "string" && VALID_PLAYLIST_FREQUENCIES.includes(v)) ||
          "Invalid playlistFrequency",
      };

      const updates = {};

      for (const [key, validate] of Object.entries(validators)) {
        if (!Object.hasOwn(body, key)) continue; // only validate provided fields
        const result = validate(body[key]);
        if (result !== true) {
          return json({ ok: false, error: result }, { status: 400 });
        }
        updates[key] = body[key];
      }

      // if changing frequency but not format, update format to a sensible default for the new frequency
      if (
        updates.playlistFrequency &&
        !updates.playlistNameFormat &&
        user.playlistFrequency !== updates.playlistFrequency
      ) {
        updates.playlistNameFormat = getDefaultFormat(
          updates.playlistFrequency
        );
      }

      const updatedUser = database.updateSettings({ userId, ...updates });

      return json({
        ok: true,
        settings: {
          autoSyncEnabled: updatedUser.autoSyncEnabled,
          playlistNameFormat: updatedUser.playlistNameFormat,
          playlistFrequency: updatedUser.playlistFrequency,
        },
      });
    },
  },
]);

const scheduler = createScheduler({ database });
scheduler.start();

const server = Bun.serve({
  hostname: HOST,
  port: PORT,
  async fetch(request) {
    const response = await router.handle(request);

    if (response) {
      return response;
    }

    const url = new URL(request.url);

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405 });
    }

    return serveStatic(url.pathname);
  },
});

console.log(`SQLite database ready at ${database.databasePath}`);
console.log(`Server listening on http://${server.hostname}:${server.port}`);
