import { authPromise } from "/shared.js";

const syncButton = document.getElementById("sync-button");
const songsFound = document.getElementById("songs-found");
const songsAdded = document.getElementById("songs-added");
const songsSkipped = document.getElementById("songs-skipped");
const resultMeta = document.getElementById("result-meta");
const resultMessage = document.getElementById("result-message");
const autoSyncToggle = document.getElementById("auto-sync-toggle");
const playlistNameFormatSelect = document.getElementById(
  "playlist-name-format"
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

// ─── Settings helpers ─────────────────────────────────────────────────────
function setAutoSyncState(enabled) {
  autoSyncToggle.setAttribute("aria-checked", String(enabled));
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

function setSettingsDisabled(disabled) {
  autoSyncToggle.disabled = disabled;
  playlistNameFormatSelect.disabled = disabled;
  for (const input of playlistFrequencyInputs) input.disabled = disabled;
}

async function loadSettings() {
  try {
    const response = await fetch("/api/settings");
    const data = await response.json();
    if (data.ok) {
      formatOptions = data.formatOptions ?? [];
      applySettings({
        autoSyncEnabled: data.settings.autoSyncEnabled,
        playlistNameFormat: data.settings.playlistNameFormat,
        playlistFrequency: data.settings.playlistFrequency,
      });
    }
  } catch {
    // leave defaults
  }
}

function applySettings(settings) {
  currentSettings = { ...settings };
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

  setSettingsDisabled(true);

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
    setSettingsDisabled(false);
  }
}

// ─── Sync ─────────────────────────────────────────────────────────────────

async function runSync() {
  syncButton.disabled = true;
  syncButton.textContent = "Running…";

  try {
    const response = await fetch("/api/sync", { method: "POST" });
    const payload = await response.json();

    if (response.status === 401) {
      window.location.replace("/");
      return;
    }

    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "Sync failed");
    }

    songsFound.textContent = String(payload.result.newSongs);
    songsAdded.textContent = String(payload.result.added);
    songsSkipped.textContent = String(payload.result.skipped);

    resultMessage.textContent =
      payload.result.newSongs === 0
        ? "No new songs were found."
        : `Processed ${payload.result.newSongs} new song(s); ${payload.result.added} added and ${payload.result.skipped} skipped.`;

    resultMeta.classList.add("visible");
  } catch (error) {
    resultMessage.textContent =
      error instanceof Error ? error.message : String(error);
    resultMeta.classList.add("visible");
  } finally {
    syncButton.disabled = false;
    syncButton.textContent = "Test Sync";
  }
}

// ─── Event listeners ──────────────────────────────────────────────────────
syncButton.addEventListener("click", () => void runSync());

autoSyncToggle.addEventListener("click", () => {
  const nextValue = autoSyncToggle.getAttribute("aria-checked") !== "true";
  void saveSettings("autoSyncEnabled", nextValue);
});

playlistNameFormatSelect.addEventListener("change", () => {
  void saveSettings("playlistNameFormat", playlistNameFormatSelect.value);
});

for (const input of playlistFrequencyInputs) {
  input.addEventListener("change", () => {
    if (!input.checked) return;
    const options = getOptionsForFrequency(input.value);
    void saveSettings({
      playlistFrequency: input.value,
      playlistNameFormat: options[0]?.value ?? "",
    });
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────
authPromise.then((data) => {
  if (!data.authenticated) return; // shared.js handles the redirect
  void loadSettings();
});
