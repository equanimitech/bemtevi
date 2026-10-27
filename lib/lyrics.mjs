// @ts-check
/**
 * Lyrics from LRCLIB (https://lrclib.net): a free, open lyrics API with no key.
 * Fetched for the learner's own study and stored locally on the song.
 * API shape checked against https://lrclib.net/docs on 2026-09-30:
 * GET /api/search?track_name=&artist_name= → up to 20 records of
 * { id, trackName, artistName, albumName, duration, instrumental, plainLyrics, syncedLyrics };
 * GET /api/get/{id} → one such record, 404 when there is none.
 */
import { readFileSync } from 'node:fs';

/** Base URL (override: BEMTEVI_LRCLIB_URL, for tests). */
export const lrclibUrl = () => process.env.BEMTEVI_LRCLIB_URL ?? 'https://lrclib.net';

const VERSION = JSON.parse(readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8')).version;
/** LRCLIB asks clients to name themselves. */
const USER_AGENT = `bemtevi v${VERSION} (https://github.com/equanimitech/bemtevi)`;

/**
 * @typedef {{ id: number, albumName?: string | null, duration: number, instrumental?: boolean, plainLyrics: string | null, syncedLyrics: string | null }} LrclibRecord
 * @typedef {{ lyrics: string, syncedLyrics: string | null, lrclibId: number, lyricsDuration: number }} SongLyrics
 * @typedef {{ id: number, album: string | null, duration: number, synced: boolean, lyrics: string, syncedLyrics: string | null }} LyricsCandidate
 */

/** How many lyric tracks a song keeps to choose from. */
export const CANDIDATES = 6;

/**
 * Two records with the same words and timing are one track: LRCLIB holds the
 * same upload under many albums, sometimes with a space after the time tag.
 * @param {LrclibRecord} r
 */
const lyricsKey = (r) => (r.syncedLyrics?.trim() ? r.syncedLyrics : r.plainLyrics ?? '')
  .replace(/\]\s+/g, ']').replace(/\s+/g, ' ').trim();

/**
 * The lyric tracks worth choosing from, best first: with the teacher's audio
 * length, closest length first (a recording within ±3 s is likely the one
 * they sing over); without it, timed tracks first. Duplicates and records
 * with no plain lyrics are dropped.
 * @param {LrclibRecord[]} records
 * @param {number | null} duration seconds of the song's audio
 * @param {number} [n]
 * @returns {LrclibRecord[]}
 */
export const pickCandidates = (records, duration, n = CANDIDATES) => {
  const usable = records.filter((r) => !r.instrumental && r.plainLyrics?.trim());
  const ranked = duration
    ? [...usable].sort((a, b) => Math.abs(a.duration - duration) - Math.abs(b.duration - duration))
    : [...usable].sort((a, b) => Number(!a.syncedLyrics) - Number(!b.syncedLyrics));
  const seen = new Set();
  return ranked.filter((r) => !seen.has(lyricsKey(r)) && seen.add(lyricsKey(r))).slice(0, n);
};

/**
 * The record to keep: the best of `pickCandidates`.
 * @param {LrclibRecord[]} records @param {number | null} duration
 * @returns {LrclibRecord | null}
 */
export const pickRecord = (records, duration) => pickCandidates(records, duration, 1)[0] ?? null;

/** @param {LrclibRecord} r @returns {LyricsCandidate} */
export const toCandidate = (r) => ({
  id: r.id,
  album: r.albumName?.trim() || null,
  duration: r.duration,
  synced: Boolean(r.syncedLyrics?.trim()),
  lyrics: /** @type {string} */ (r.plainLyrics).trim(),
  syncedLyrics: r.syncedLyrics?.trim() || null,
});

/** @param {LrclibRecord} r @returns {SongLyrics} */
export const toSongLyrics = (r) => ({
  lyrics: /** @type {string} */ (r.plainLyrics).trim(),
  syncedLyrics: r.syncedLyrics?.trim() || null,
  lrclibId: r.id,
  lyricsDuration: r.duration,
});

/** Waits before each retry while LRCLIB is busy (503) or throttling us (429). */
const BACKOFF_MS = [1000, 3000, 8000];
const BUSY = new Set([429, 503]);
/** Longest Retry-After we sit through: past it, the learner is left staring. */
const MAX_WAIT_MS = 30_000;

/** @param {number} ms */
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A Retry-After header (seconds or an HTTP date) in ms; null when absent or unreadable.
 * @param {string | null} value
 */
const retryAfterMs = (value) => {
  if (!value?.trim()) return null;
  const ms = /^\d+$/.test(value.trim()) ? Number(value) * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(ms) ? Math.min(Math.max(ms, 0), MAX_WAIT_MS) : null;
};

/**
 * GET an LRCLIB path as JSON, one request at a time. 404 is `null`; busy
 * answers are retried with backoff; anything else unexpected throws.
 * @param {string} path @param {typeof fetch} fetchImpl @param {(ms: number) => Promise<unknown>} sleep
 */
const getJson = async (path, fetchImpl, sleep) => {
  for (let attempt = 0; ; attempt++) {
    const res = await fetchImpl(`${lrclibUrl()}${path}`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 404) return null;
    if (BUSY.has(res.status) && attempt < BACKOFF_MS.length) {
      await sleep(retryAfterMs(res.headers.get('retry-after')) ?? BACKOFF_MS[attempt]);
      continue;
    }
    if (!res.ok) throw Object.assign(new Error(`LRCLIB answered ${res.status}`), { busy: BUSY.has(res.status) });
    return res.json();
  }
};

/** @param {unknown} err @returns {LyricsResult} */
const failed = (err) => {
  const { message, busy } = /** @type {Error & { busy?: boolean }} */ (err);
  return busy ? { status: 'failed', reason: message, busy } : { status: 'failed', reason: message };
};

/**
 * @typedef {{ status: 'found', found: SongLyrics, candidates: LyricsCandidate[] } | { status: 'not-found' } | { status: 'failed', reason: string, busy?: true }} LyricsResult
 */

/**
 * Search LRCLIB for a song: the best record, and the tracks to choose from.
 * Never throws: no network or no match comes back as a status the caller
 * reports in one line.
 * @param {{ title: string, artist: string, duration?: number | null }} song
 * @param {typeof fetch} [fetchImpl]
 * @param {(ms: number) => Promise<unknown>} [sleep]
 * @returns {Promise<LyricsResult>}
 */
export async function findLyrics({ title, artist, duration = null }, fetchImpl = fetch, sleep = wait) {
  const query = new URLSearchParams({ track_name: title, artist_name: artist });
  try {
    const records = await getJson(`/api/search?${query}`, fetchImpl, sleep);
    const candidates = pickCandidates(Array.isArray(records) ? records : [], duration);
    return candidates.length
      ? { status: 'found', found: toSongLyrics(candidates[0]), candidates: candidates.map(toCandidate) }
      : { status: 'not-found' };
  } catch (err) {
    return failed(err);
  }
}

/**
 * One LRCLIB record by id: the learner's pick among the candidates (or one
 * they found on lrclib.net). Never throws, like `findLyrics`.
 * @param {number} id
 * @param {typeof fetch} [fetchImpl]
 * @param {(ms: number) => Promise<unknown>} [sleep]
 * @returns {Promise<LyricsResult>}
 */
export async function getLyrics(id, fetchImpl = fetch, sleep = wait) {
  try {
    const record = await getJson(`/api/get/${id}`, fetchImpl, sleep);
    return record && !record.instrumental && record.plainLyrics?.trim()
      ? { status: 'found', found: toSongLyrics(record), candidates: [toCandidate(record)] }
      : { status: 'not-found' };
  } catch (err) {
    return failed(err);
  }
}
