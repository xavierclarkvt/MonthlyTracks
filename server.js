import { isAbsolute, normalize, relative, resolve } from "node:path";
import { createRouter } from "./src/router.js";
import { runMonthlySync } from "./src/run-sync.js";

const HOST = process.env.HOST?.trim() || "127.0.0.1";
const PORT = Number(process.env.PORT ?? 3000);
const publicRoot = resolve(process.cwd(), "public");

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

  if (
    relativeToRoot.startsWith("..") ||
    isAbsolute(relativeToRoot)
  ) {
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
    method: "POST",
    pathname: "/api/sync",
    async handler() {
      try {
        const { config, result } = await runMonthlySync();

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
            dryRun: config.dryRun,
            statePath: config.statePath,
          },
        });
      } catch (error) {
        return json(
          {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          },
          { status: 500 },
        );
      }
    },
  },
]);

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

console.log(`Server listening on http://${server.hostname}:${server.port}`);