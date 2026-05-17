import { isAbsolute, normalize, relative, resolve } from "node:path";
import { createAuthHandlers, getAuthenticatedUserId } from "./src/auth.js";
import { initializeDatabase } from "./src/db.js";
import { createRouter } from "./src/router.js";
import { runMonthlySync } from "./src/run-sync.js";
import { createScheduler } from "./src/scheduler.js";

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
        settings: { autoSyncEnabled: user.autoSyncEnabled },
      });
    },
  },
  {
    method: "POST",
    pathname: "/api/settings/auto-sync",
    async handler(request) {
      const userId = await getAuthenticatedUserId(request, auth.cookieSecret);

      if (!userId) {
        return json({ ok: false, error: "Not authenticated" }, { status: 401 });
      }

      const body = await request.json();
      const enabled = Boolean(body.enabled);

      database.updateAutoSync(userId, enabled);

      return json({ ok: true, autoSyncEnabled: enabled });
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
