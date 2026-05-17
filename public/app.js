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
const playlistNameFormatSelect = document.querySelector(
  "#playlist-name-format"
);
const playlistFrequencyInputs = document.querySelectorAll(
  'input[name="playlist-frequency"]'
);

let formatOptions = [];
let currentSettings = {
  autoSyncEnabled: false,
  playlistNameFormat: "",
  playlistFrequency: "monthly",
};

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

function setPlaylistFrequencyState(playlistFrequency) {
  for (const input of playlistFrequencyInputs) {
    input.checked = input.value === playlistFrequency;
  }
}

function getOptionsForFrequency(playlistFrequency) {
  return (
    formatOptions.find((group) => group.frequency === playlistFrequency)
      ?.options ?? []
  );
}

function renderPlaylistNameOptions(playlistFrequency, selectedValue) {
  const options = getOptionsForFrequency(playlistFrequency);
  const resolvedValue = options.some((option) => option.value === selectedValue)
    ? selectedValue
    : (options[0]?.value ?? "");

  playlistNameFormatSelect.replaceChildren();

  for (const group of formatOptions) {
    if (group.frequency !== playlistFrequency) {
      continue;
    }

    const optgroup = document.createElement("optgroup");
    optgroup.label = group.label;

    for (const option of group.options) {
      const optionElement = document.createElement("option");
      optionElement.value = option.value;
      optionElement.textContent = option.label;
      optgroup.append(optionElement);
    }

    playlistNameFormatSelect.append(optgroup);
  }

  playlistNameFormatSelect.value = resolvedValue;
  return resolvedValue;
}

async function loadSettings() {
  try {
    const response = await fetch("/api/settings");
    const data = await response.json();

    if (data.ok) {
      formatOptions = data.formatOptions ?? [];
      currentSettings = {
        autoSyncEnabled: data.settings.autoSyncEnabled,
        playlistNameFormat: data.settings.playlistNameFormat,
        playlistFrequency: data.settings.playlistFrequency,
      };

      setAutoSyncState(currentSettings.autoSyncEnabled);
      setPlaylistFrequencyState(currentSettings.playlistFrequency);
      currentSettings.playlistNameFormat = renderPlaylistNameOptions(
        currentSettings.playlistFrequency,
        currentSettings.playlistNameFormat
      );
    }
  } catch {
    // Settings failed to load — leave toggle in default off state.
  }
}

function setSettingsControlsDisabled(disabled) {
  autoSyncToggle.disabled = disabled;
  playlistNameFormatSelect.disabled = disabled;

  for (const input of playlistFrequencyInputs) {
    input.disabled = disabled;
  }
}

function applySettings(settings) {
  currentSettings = {
    autoSyncEnabled: settings.autoSyncEnabled,
    playlistNameFormat: settings.playlistNameFormat,
    playlistFrequency: settings.playlistFrequency,
  };

  setAutoSyncState(currentSettings.autoSyncEnabled);
  setPlaylistFrequencyState(currentSettings.playlistFrequency);
  currentSettings.playlistNameFormat = renderPlaylistNameOptions(
    currentSettings.playlistFrequency,
    currentSettings.playlistNameFormat
  );
}

async function saveSettings(field, value) {
  const updates =
    typeof field === "string" && field.length > 0 ? { [field]: value } : field;
  const previousSettings = { ...currentSettings };

  if (updates.autoSyncEnabled !== undefined) {
    setAutoSyncState(updates.autoSyncEnabled);
  }

  if (updates.playlistFrequency !== undefined) {
    setPlaylistFrequencyState(updates.playlistFrequency);
  }

  if (
    updates.playlistFrequency !== undefined ||
    updates.playlistNameFormat !== undefined
  ) {
    renderPlaylistNameOptions(
      updates.playlistFrequency ?? currentSettings.playlistFrequency,
      updates.playlistNameFormat ?? currentSettings.playlistNameFormat
    );
  }

  setSettingsControlsDisabled(true);

  try {
    const response = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    const data = await response.json();

    if (!response.ok || !data.ok || !data.settings) {
      applySettings(previousSettings);
      return;
    }

    applySettings(data.settings);
  } catch {
    applySettings(previousSettings);
  } finally {
    setSettingsControlsDisabled(false);
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
  const nextValue = autoSyncToggle.getAttribute("aria-checked") !== "true";
  void saveSettings("autoSyncEnabled", nextValue);
});

playlistNameFormatSelect.addEventListener("change", () => {
  void saveSettings("playlistNameFormat", playlistNameFormatSelect.value);
});

for (const input of playlistFrequencyInputs) {
  input.addEventListener("change", () => {
    if (!input.checked) {
      return;
    }

    const options = getOptionsForFrequency(input.value);
    const nextPlaylistNameFormat = options[0]?.value ?? "";

    void saveSettings({
      playlistFrequency: input.value,
      playlistNameFormat: nextPlaylistNameFormat,
    });
  });
}

checkAuth();
