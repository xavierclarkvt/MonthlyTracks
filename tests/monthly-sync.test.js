import { describe, expect, test } from "bun:test";
import {
  filterNewSongs,
  formatPlaylistName,
  getDefaultLastChecked,
  groupSongsByPlaylistName,
} from "../src/sync-helpers.js";

describe("formatPlaylistName", () => {
  test("formats a short month and year by default", () => {
    const date = new Date("2026-05-07T10:00:00Z");

    expect(formatPlaylistName(date)).toBe("May '26");
  });

  test("supports numeric month formats", () => {
    const date = new Date("2026-01-15T10:00:00Z");

    expect(formatPlaylistName(date, "%Y-%m")).toBe("2026-01");
  });

  test("supports quarter tokens", () => {
    const date = new Date("2026-05-07T10:00:00Z");

    expect(formatPlaylistName(date, "Q%Q %Y")).toBe("Q2 2026");
  });

  test("supports season tokens", () => {
    const date = new Date("2026-11-07T10:00:00Z");

    expect(formatPlaylistName(date, "%S %Y")).toBe("Fall 2026");
  });
});

describe("filterNewSongs", () => {
  test("keeps only songs newer than the threshold", () => {
    const lastChecked = new Date("2026-05-01T00:00:00Z");
    const songs = [
      { id: "old", addedAt: new Date("2026-04-30T23:59:59Z") },
      { id: "same", addedAt: new Date("2026-05-01T00:00:00Z") },
      { id: "new", addedAt: new Date("2026-05-01T00:00:01Z") },
    ];

    expect(filterNewSongs(songs, lastChecked).map((song) => song.id)).toEqual([
      "new",
    ]);
  });
});

describe("groupSongsByPlaylistName", () => {
  test("groups songs in chronological month order", () => {
    const songs = [
      {
        id: "2",
        addedAt: new Date("2026-06-02T00:00:00Z"),
      },
      {
        id: "1",
        addedAt: new Date("2026-05-03T00:00:00Z"),
      },
      {
        id: "3",
        addedAt: new Date("2026-06-05T00:00:00Z"),
      },
    ];

    const groups = groupSongsByPlaylistName(songs, "%Y-%m");

    expect(groups.map((group) => group.name)).toEqual(["2026-05", "2026-06"]);
    expect(groups[0].songs.map((song) => song.id)).toEqual(["1"]);
    expect(groups[1].songs.map((song) => song.id)).toEqual(["2", "3"]);
  });

  test("groups quarterly formats into the same playlist for three months", () => {
    const songs = [
      {
        id: "1",
        addedAt: new Date("2026-01-03T00:00:00Z"),
      },
      {
        id: "2",
        addedAt: new Date("2026-03-18T00:00:00Z"),
      },
      {
        id: "3",
        addedAt: new Date("2026-04-02T00:00:00Z"),
      },
    ];

    const groups = groupSongsByPlaylistName(songs, "%S %Y");

    expect(groups.map((group) => group.name)).toEqual([
      "Winter 2026",
      "Spring 2026",
    ]);
    expect(groups[0].songs.map((song) => song.id)).toEqual(["1", "2"]);
    expect(groups[1].songs.map((song) => song.id)).toEqual(["3"]);
  });
});

describe("getDefaultLastChecked", () => {
  test("defaults to the start of the current UTC month", () => {
    const now = new Date("2026-05-07T21:30:00Z");

    expect(getDefaultLastChecked(now).toISOString()).toBe(
      "2026-05-01T00:00:00.000Z"
    );
  });
});
