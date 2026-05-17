export const VALID_PLAYLIST_FREQUENCIES = ["monthly", "quarterly"];
export const PLAYLIST_NAME_FORMAT_OPTIONS = [
  { frequency: "monthly", label: "Jan '26", value: "%b '%y" },
  { frequency: "monthly", label: "'26 Jan", value: "'%y %b" },
  { frequency: "monthly", label: "Jan 2026", value: "%b %Y" },
  { frequency: "monthly", label: "2026 Jan", value: "%Y %b" },
  { frequency: "monthly", label: "2026-01", value: "%Y-%m" },
  { frequency: "monthly", label: "January 2026", value: "%B %Y" },
  { frequency: "monthly", label: "2026 January", value: "%Y %B" },
  { frequency: "monthly", label: "'26_01", value: "'%y_%m" },
  { frequency: "quarterly", label: "Q1 2026", value: "Q%Q %Y" },
  { frequency: "quarterly", label: "2026 Q1", value: "%Y Q%Q" },
  { frequency: "quarterly", label: "Q1 '26", value: "Q%Q '%y" },
  { frequency: "quarterly", label: "'26 Q1", value: "'%y Q%Q" },
  { frequency: "quarterly", label: "Winter 2026", value: "%S %Y" },
  { frequency: "quarterly", label: "2026 Winter", value: "%Y %S" },
  { frequency: "quarterly", label: "Winter '26", value: "%S '%y" },
  { frequency: "quarterly", label: "'26 Winter", value: "'%y %S" },
];

export function getDefaultFormat(frequency = "monthly") {
  return PLAYLIST_NAME_FORMAT_OPTIONS.find((o) => o.frequency === frequency)
    .value;
}

const SHORT_MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const LONG_MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const SEASON_NAMES = ["Winter", "Spring", "Summer", "Fall"];

export function parseIsoTimestamp(value, label = "timestamp") {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ${label}: ${value}`);
  }

  return parsed;
}

export function getDefaultLastChecked(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function formatPlaylistName(date, format = getDefaultFormat()) {
  return format.replace(/%[%YymbBQS]/g, (token) => {
    const quarter = Math.floor(date.getUTCMonth() / 3) + 1;

    switch (token) {
      case "%%":
        return "%";
      case "%Y":
        return String(date.getUTCFullYear());
      case "%y":
        return String(date.getUTCFullYear()).slice(-2);
      case "%m":
        return String(date.getUTCMonth() + 1).padStart(2, "0");
      case "%b":
        return SHORT_MONTH_NAMES[date.getUTCMonth()];
      case "%B":
        return LONG_MONTH_NAMES[date.getUTCMonth()];
      case "%Q":
        return String(quarter);
      case "%S":
        return SEASON_NAMES[quarter - 1];
      default:
        return token;
    }
  });
}

export function normalizeSavedTrack(item) {
  if (!item?.track?.id || !item.track.uri || !item.added_at) {
    return null;
  }

  return {
    addedAt: parseIsoTimestamp(item.added_at, "saved track timestamp"),
    id: item.track.id,
    name: item.track.name ?? item.track.id,
    uri: item.track.uri,
  };
}

export function filterNewSongs(songs, lastChecked) {
  return songs.filter((song) => song.addedAt > lastChecked);
}

export function sortSongsChronologically(songs) {
  return [...songs].sort((left, right) => {
    const dateDiff = left.addedAt.getTime() - right.addedAt.getTime();

    if (dateDiff !== 0) {
      return dateDiff;
    }

    return left.id.localeCompare(right.id);
  });
}

export function groupSongsByPlaylistName(songs, format) {
  const groups = [];

  for (const song of sortSongsChronologically(songs)) {
    const playlistName = formatPlaylistName(song.addedAt, format);
    const previousGroup = groups.at(-1);

    if (!previousGroup || previousGroup.name !== playlistName) {
      groups.push({ name: playlistName, songs: [song] });
      continue;
    }

    previousGroup.songs.push(song);
  }

  return groups;
}

export function getNewestSongTimestamp(songs) {
  return songs.reduce(
    (latest, song) =>
      song.addedAt.getTime() > latest.getTime() ? song.addedAt : latest,
    songs[0].addedAt
  );
}
