const authBar = document.querySelector("#auth-bar");
const loggedOut = document.querySelector("#logged-out");
const loggedIn = document.querySelector("#logged-in");
const userName = document.querySelector("#user-name");
const syncActions = document.querySelector("#sync-actions");
const syncButton = document.querySelector("#sync-button");
const statusPill = document.querySelector("#status-pill");
const songsFound = document.querySelector("#songs-found");
const songsAdded = document.querySelector("#songs-added");
const songsSkipped = document.querySelector("#songs-skipped");
const threshold = document.querySelector("#threshold");
const message = document.querySelector("#message");
const settingsPanel = document.querySelector("#settings-panel");
const autoSyncToggle = document.querySelector("#auto-sync-toggle");

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

function setAutoSyncState(enabled) {
  autoSyncToggle.setAttribute("aria-checked", String(enabled));
  autoSyncToggle.dataset.on = String(enabled);
}

async function loadSettings() {
  try {
    const response = await fetch("/api/settings");
    const data = await response.json();

    if (data.ok) {
      setAutoSyncState(data.settings.autoSyncEnabled);
    }
  } catch {
    // Settings failed to load — leave toggle in default off state.
  }
}

async function toggleAutoSync() {
  const currentlyEnabled =
    autoSyncToggle.getAttribute("aria-checked") === "true";
  const newValue = !currentlyEnabled;

  // Optimistically update UI
  setAutoSyncState(newValue);
  autoSyncToggle.disabled = true;

  try {
    const response = await fetch("/api/settings/auto-sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: newValue }),
    });
    const data = await response.json();

    if (!response.ok || !data.ok) {
      // Revert on failure
      setAutoSyncState(currentlyEnabled);
    }
  } catch {
    setAutoSyncState(currentlyEnabled);
  } finally {
    autoSyncToggle.disabled = false;
  }
}

async function checkAuth() {
  try {
    const response = await fetch("/api/me");
    const data = await response.json();

    authBar.hidden = false;

    if (data.authenticated) {
      loggedIn.hidden = false;
      userName.textContent = data.user.displayName;
      syncActions.hidden = false;
      settingsPanel.hidden = false;
      setMessage('Press "Sync Now" to start.');
      loadSettings();
    } else {
      loggedOut.hidden = false;
    }
  } catch {
    authBar.hidden = false;
    loggedOut.hidden = false;
  }
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

    if (response.status === 401) {
      window.location.href = "/auth/login";
      return;
    }

    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "Sync failed");
    }

    setCounts(payload.result);
    threshold.textContent = `${payload.threshold.source}: ${payload.threshold.value}`;

    if (payload.result.newSongs === 0) {
      setMessage("No new songs were found.");
    } else {
      setMessage(
        `Processed ${payload.result.newSongs} new song(s); ${payload.result.added} added and ${payload.result.skipped} skipped.`
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

autoSyncToggle.addEventListener("click", () => {
  void toggleAutoSync();
});

checkAuth();
