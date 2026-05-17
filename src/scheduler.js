import { runMonthlySync } from "./run-sync.js";

export function createScheduler({
  database,
  intervalMs = 5 * 60 * 1000, // default to 5 minutes
  syncConcurrency = 5,
} = {}) {
  let timer = null;
  let running = false;

  async function tick() {
    if (running) {
      return;
    }

    running = true;

    try {
      const userIds = database.getUsersDueForSync();

      for (let index = 0; index < userIds.length; index += syncConcurrency) {
        const batchUserIds = userIds.slice(index, index + syncConcurrency);
        const results = await Promise.allSettled(
          batchUserIds.map((userId) => runMonthlySync({ database, userId }))
        );

        for (const [i, result] of results.entries()) {
          if (result.status === "fulfilled") {
            console.log(
              `[scheduler] auto-sync completed for user ${batchUserIds[i]}`
            );
          } else {
            const error = result.reason;
            console.error(
              `[scheduler] auto-sync failed for user ${batchUserIds[i]}:`,
              error instanceof Error ? error.message : String(error)
            );
          }
        }
      }
    } finally {
      running = false;
    }
  }

  return {
    start() {
      if (timer) {
        return;
      }

      timer = setInterval(() => void tick(), intervalMs);
      console.log(
        `[scheduler] started — checking for due syncs every ${Math.round(intervalMs / 60000)} minute(s)`
      );
    },

    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
        console.log("[scheduler] stopped");
      }
    },

    /** Run a single tick immediately (useful for testing). */
    tick,
  };
}
