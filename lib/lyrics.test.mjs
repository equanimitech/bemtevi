// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findLyrics, getLyrics, pickCandidates, pickRecord, toCandidate } from './lyrics.mjs';

/** A synthetic /api/search answer, shaped like LRCLIB's. */
const RECORDS = [
  { id: 37485952, duration: 228, instrumental: false, plainLyrics: 'Primeira linha de teste', syncedLyrics: '[00:12.17]Primeira linha de teste' },
  { id: 37133480, duration: 254, instrumental: false, plainLyrics: 'Primeira linha de teste', syncedLyrics: '[00:20.00]Primeira linha de teste' },
  { id: 34711768, duration: 224, instrumental: false, plainLyrics: 'Primeira linha de teste\nSegunda linha de teste', syncedLyrics: '[00:12.17]Primeira linha de teste' },
  { id: 20816425, duration: 223, instrumental: false, plainLyrics: 'Primeira linha de teste', syncedLyrics: null },
  { id: 1, duration: 223.2, instrumental: true, plainLyrics: null, syncedLyrics: null },
];

/**
 * A fetch that answers like LRCLIB, and remembers what it was asked.
 * @param {number} status @param {unknown} body
 */
const stubFetch = (status, body) => {
  /** @type {{ url: string, headers: any }[]} */
  const calls = [];
  const impl = /** @type {typeof fetch} */ (/** @type {unknown} */ (async (/** @type {string} */ url, /** @type {any} */ init) => {
    calls.push({ url, headers: init.headers });
    return { ok: status < 400, status, headers: new Headers(), json: async () => body };
  }));
  return { impl, calls };
};

/**
 * A fetch that gives each answer in turn: [status, body, headers?].
 * @param {[number, unknown, Record<string, string>?][]} answers
 */
const sequenceFetch = (answers) => {
  let calls = 0;
  const impl = /** @type {typeof fetch} */ (/** @type {unknown} */ (async () => {
    const [status, body, headers] = answers[Math.min(calls++, answers.length - 1)];
    return { ok: status < 400, status, headers: new Headers(headers), json: async () => body };
  }));
  return { impl, calls: () => calls };
};

/** Stands in for the backoff timer: records each wait, waits for none. */
const stubSleep = () => {
  /** @type {number[]} */
  const waits = [];
  return { sleep: async (/** @type {number} */ ms) => { waits.push(ms); }, waits };
};

test('pickRecord keeps the record closest to the audio length, never an instrumental', () => {
  assert.equal(pickRecord(RECORDS, 223.24)?.id, 20816425);
  assert.equal(pickRecord(RECORDS, 225)?.id, 34711768);
  assert.equal(pickRecord(RECORDS, null)?.id, 37485952, 'without a length: the first with timed lines');
  assert.equal(pickRecord([RECORDS[4]], 223), null);
  assert.equal(pickRecord([], 223), null);
});

test('pickCandidates ranks by closeness to the audio, drops repeats of the same words and timing, keeps six', () => {
  /** @param {number} id @param {number} duration @param {string | null} lrc */
  const rec = (id, duration, lrc) => ({ id, albumName: `A${id}`, duration, instrumental: false, plainLyrics: 'Primeira linha de teste', syncedLyrics: lrc });
  const records = [
    rec(1, 254, '[00:20.00]Primeira linha de teste'),
    rec(2, 223, '[00:12.17]Primeira linha de teste'),
    rec(3, 224, '[00:12.17] Primeira linha de teste'), // the same upload, a space after the tag
    rec(4, 222, '[00:10.34]Primeira linha de teste'),
    rec(5, 187, null),
    rec(6, 240, null), // same plain text as 5, no timing: one of them goes
    rec(7, 229, '[00:09.05]Primeira linha de teste'),
    rec(8, 236, '[00:11.00]Primeira linha de teste'),
    rec(9, 348, '[00:30.00]Primeira linha de teste'),
    rec(10, 323, '[00:40.00]Primeira linha de teste'),
  ];
  assert.deepEqual(pickCandidates(records, 223.24).map((r) => r.id), [2, 4, 7, 8, 6, 1]);
  assert.deepEqual(pickCandidates(records, null, 3).map((r) => r.id), [1, 2, 4], 'without a length: timed tracks first');
  assert.deepEqual(toCandidate(records[4]), { id: 5, album: 'A5', duration: 187, synced: false, lyrics: 'Primeira linha de teste', syncedLyrics: null });
});

test('findLyrics searches by track and artist, names itself, and maps the record onto the song', async () => {
  const { impl, calls } = stubFetch(200, RECORDS);
  const res = await findLyrics({ title: 'Cancao Azul', artist: 'Artista Um', duration: 224.4 }, impl);
  assert.equal(calls[0].url, 'https://lrclib.net/api/search?track_name=Cancao+Azul&artist_name=Artista+Um');
  assert.match(calls[0].headers['User-Agent'], /^bemtevi v\d+\.\d+\.\d+ \(https:\/\/github\.com\/equanimitech\/bemtevi\)$/);
  assert.equal(res.status, 'found');
  if (res.status !== 'found') return;
  assert.deepEqual(res.found, { lyrics: 'Primeira linha de teste\nSegunda linha de teste', syncedLyrics: '[00:12.17]Primeira linha de teste', lrclibId: 34711768, lyricsDuration: 224 });
  assert.deepEqual(res.candidates.map((c) => [c.id, c.synced]), [[34711768, true], [20816425, false], [37133480, true]],
    '37485952 has the same timed words as 34711768: one track');
});

test('getLyrics fetches one record by id; a 404 is no match', async () => {
  const { impl, calls } = stubFetch(200, { ...RECORDS[1], albumName: 'Album Tres' });
  const res = await getLyrics(37133480, impl);
  assert.equal(calls[0].url, 'https://lrclib.net/api/get/37133480');
  assert.deepEqual(res, {
    status: 'found',
    found: { lyrics: 'Primeira linha de teste', syncedLyrics: '[00:20.00]Primeira linha de teste', lrclibId: 37133480, lyricsDuration: 254 },
    candidates: [{ id: 37133480, album: 'Album Tres', duration: 254, synced: true, lyrics: 'Primeira linha de teste', syncedLyrics: '[00:20.00]Primeira linha de teste' }],
  });
  assert.deepEqual(await getLyrics(1, stubFetch(404, { message: 'not found' }).impl), { status: 'not-found' });
  assert.deepEqual(await getLyrics(1, stubFetch(200, RECORDS[4]).impl), { status: 'not-found' }, 'an instrumental has no lyrics');
  assert.deepEqual(await getLyrics(1, stubFetch(500, '').impl), { status: 'failed', reason: 'LRCLIB answered 500' });
});

test('findLyrics reports no match, an error status and no network, without throwing', async () => {
  assert.deepEqual(await findLyrics({ title: 'x', artist: 'y' }, stubFetch(200, []).impl), { status: 'not-found' });
  assert.deepEqual(await findLyrics({ title: 'x', artist: 'y' }, stubFetch(429, '').impl, stubSleep().sleep), { status: 'failed', reason: 'LRCLIB answered 429', busy: true });
  const offline = /** @type {typeof fetch} */ (/** @type {unknown} */ (async () => { throw new Error('fetch failed'); }));
  assert.deepEqual(await findLyrics({ title: 'x', artist: 'y' }, offline), { status: 'failed', reason: 'fetch failed' });
});

test('a busy LRCLIB is retried with backoff, honoring Retry-After', async () => {
  const fetch = sequenceFetch([[503, { message: 'The server is busy, please retry in a moment' }], [429, '', { 'Retry-After': '2' }], [200, RECORDS]]);
  const { sleep, waits } = stubSleep();
  const res = await findLyrics({ title: 'Cancao Azul', artist: 'Artista Um', duration: 224.4 }, fetch.impl, sleep);
  assert.equal(res.status, 'found');
  assert.equal(fetch.calls(), 3);
  assert.deepEqual(waits, [1000, 2000]);
});

test('LRCLIB still busy after three retries fails as busy', async () => {
  const fetch = sequenceFetch([[503, { message: 'The server is busy, please retry in a moment' }]]);
  const { sleep, waits } = stubSleep();
  assert.deepEqual(await getLyrics(1, fetch.impl, sleep), { status: 'failed', reason: 'LRCLIB answered 503', busy: true });
  assert.equal(fetch.calls(), 4, 'one request, three retries');
  assert.deepEqual(waits, [1000, 3000, 8000]);
});
