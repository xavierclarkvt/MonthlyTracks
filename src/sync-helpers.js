export const DEFAULT_PLAYLIST_NAME_FORMAT = "%b '%y";

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

export function formatPlaylistName(
  date,
  format = DEFAULT_PLAYLIST_NAME_FORMAT
) {
  return format.replace(/%[%YymbB]/g, (token) => {
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

export function groupSongsByPlaylistName(
  songs,
  format = DEFAULT_PLAYLIST_NAME_FORMAT
) {
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
