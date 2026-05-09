const syncButton = document.querySelector("#sync-button");
const statusPill = document.querySelector("#status-pill");
const songsFound = document.querySelector("#songs-found");
const songsAdded = document.querySelector("#songs-added");
const songsSkipped = document.querySelector("#songs-skipped");
const threshold = document.querySelector("#threshold");
const message = document.querySelector("#message");

function setStatus(label, state) {
  statusPill.textContent = label;
  statusPill.dataset.state = state;
}

function setCounts(result) {
  songsFound.textContent = String(result.newSongs);
  songsAdded.textContent = String(result.added);
  songsSkipped.textContent = String(result.skipped);
}

function setMessage(text) {
  message.textContent = text;
}

async function runSync() {
  syncButton.disabled = true;
  setStatus("Running", "running");
  setMessage("Sync in progress...");

  try {
    const response = await fetch("/api/sync", {
      method: "POST",
    });
    const payload = await response.json();

    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "Sync failed");
    }

    setCounts(payload.result);
    threshold.textContent = `${payload.threshold.source}: ${payload.threshold.value}`;

    if (payload.result.newSongs === 0) {
      setMessage("No new songs were found.");
    } else {
      setMessage(
        `Processed ${payload.result.newSongs} new song(s); ${payload.result.added} added and ${payload.result.skipped} skipped.`,
      );
    }

    setStatus("Completed", "success");
  } catch (error) {
    setStatus("Failed", "error");
    setMessage(error instanceof Error ? error.message : String(error));
  } finally {
    syncButton.disabled = false;
  }
}

syncButton.addEventListener("click", () => {
  void runSync();
});