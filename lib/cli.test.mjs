// @ts-check
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = join(dirname(fileURLToPath(import.meta.url)), 'cli.mjs');

/** @type {string} */
let dir;

/**
 * Run the CLI against the temp data dir and parse its JSON output.
 * @param {...string} args
 * @returns {any}
 */
const run = (...args) =>
  JSON.parse(
    execFileSync(process.execPath, [CLI, ...args], {
      env: { ...process.env, BEMTEVI_DIR: dir, BEMTEVI_LRCLIB_URL: 'http://127.0.0.1:9' },
      encoding: 'utf8',
    }),
  );

/**
 * Run the CLI with stdin input and parse its JSON output.
 * @param {string} stdinData
 * @param {...string} args
 * @returns {any}
 */
const runWithStdin = (stdinData, ...args) =>
  JSON.parse(
    execFileSync(process.execPath, [CLI, ...args], {
      env: { ...process.env, BEMTEVI_DIR: dir, BEMTEVI_LRCLIB_URL: 'http://127.0.0.1:9' },
      encoding: 'utf8',
      input: stdinData,
    }),
  );

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bemtevi-cli-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// --- Songs ---

/**
 * A singing project and two fake audio files standing in for WhatsApp downloads.
 * @returns {{ p: any, guia: string, base: string }}
 */
const singing = () => {
  const p = run('project-create', '--topic', 'Aulas de canto', '--language', 'pt-BR');
  const dl = join(dir, 'dl');
  mkdirSync(dl, { recursive: true });
  const guia = join(dl, 'cancao azuz - com voz.mpeg');
  const base = join(dl, 'cancao azul - sem voz.mpeg');
  writeFileSync(guia, 'fake guia');
  writeFileSync(base, 'fake base');
  return { p, guia, base };
};

/** @param {string} guia @param {string} base */
const blueSong = (guia, base) => JSON.stringify({
  title: 'Cancao Azul',
  artist: 'Artista Um',
  originalKey: 'C',
  spotify: 'https://open.spotify.com/track/abc',
  sections: [{ name: 'Refrão', start: '0:42', end: '1:05' }],
  notes: 'Respirar antes do refrão.',
  versions: [{ kind: 'guia', file: guia, key: 'Bb' }, { kind: 'base', file: base, key: 'Bb' }],
});

test('song-add files the song as a typed resource, its page next to copies of its audio', () => {
  const { p, guia, base } = singing();
  const res = runWithStdin(blueSong(guia, base), 'song-add', p.id, '--no-open');
  const folder = join(dir, 'songs', 'aulas-de-canto', 'cancao-azul');
  assert.equal(res.file, join(folder, 'index.html'));
  assert.equal(readFileSync(join(folder, 'guia.mpeg'), 'utf8'), 'fake guia');
  assert.equal(readFileSync(join(folder, 'base.mpeg'), 'utf8'), 'fake base');
  assert.ok(existsSync(guia) && existsSync(base), 'the downloads stay where they were');
  const [song] = run('project-get', p.id).resources;
  assert.equal(song.type, 'song');
  assert.deepEqual(song.sections, [{ name: 'Refrão', start: 42, end: 65 }]);
  assert.deepEqual(song.versions.map((/** @type {any} */ v) => [v.kind, v.file, v.key, v.source]), [['guia', 'guia.mpeg', 'Bb', guia], ['base', 'base.mpeg', 'Bb', base]]);
  assert.equal(song.status, 'active', 'a new song is active');

  const html = readFileSync(res.file, 'utf8');
  assert.match(html, /<html lang="pt-BR">/);
  assert.match(html, /<main data-type="song">/);
  assert.doesNotMatch(html, /<button type="button" data-status|class="manage"|footer class="actions"|bemtevi-actions/, 'the page is for practice, not editing');
  assert.match(html, /<bemtevi-player[\s\S]*<audio controls preload="metadata" src="guia\.mpeg">[\s\S]*src="base\.mpeg"/);
  assert.match(html, /customElements\.define\('bemtevi-player'/, 'the player is inlined');
  assert.doesNotMatch(html, /bemteviMatches/, 'no quiz script on a song page');
  assert.match(html, /Tom original: C/);
  assert.match(html, /Guia · Bb \(−2 st\)/, 'the key lives on the version, the shift is derived');
  assert.match(html, /data-start="42" data-end="65">Refrão/);
  assert.match(html, /href="https:\/\/open\.spotify\.com\/track\/abc"/);
  assert.match(html, /Respirar antes do refrão\./);
  const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
  assert.doesNotMatch(main, /\d{4}-\d{2}-\d{2}|\d+\s*(vezes|times|x)\b/i, 'no dates or counts on the page');
});

test('song-add fails in one line on a missing field or a missing file, and saves nothing', () => {
  const { p, guia } = singing();
  assert.throws(() => runWithStdin('{"title":"Cancao Azul"}', 'song-add', p.id, '--no-open'), /a song needs "artist"/);
  assert.throws(() => runWithStdin(JSON.stringify({ title: 't', artist: 'a', versions: [{ kind: 'guia', file: `${guia}.nope` }] }), 'song-add', p.id, '--no-open'), /no audio file at/);
  assert.throws(() => runWithStdin('{"title":"t","artist":"a"}', 'song-add', 'nope', '--no-open'), /no project/);
  assert.deepEqual(run('project-get', p.id).resources, []);
});

test('the repertoire shows active songs, then stored ones folded away, and the home index links it', () => {
  const { p, guia, base } = singing();
  const { song, index } = runWithStdin(blueSong(guia, base), 'song-add', p.id, '--no-open');
  runWithStdin('{"title":"Brisa Clara","artist":"Artista Dois"}', 'song-add', p.id, '--no-open');
  run('song-set', song.id, '--status', 'stored');
  const html = readFileSync(index, 'utf8');
  assert.match(html, /<h2>Ativas<\/h2>\n<ul class="songs">\n {2}<li><a href="brisa-clara\/index\.html">Brisa Clara<\/a>/);
  assert.match(html, /<details class="stored">\n<summary>Guardadas<\/summary>\n<ul class="songs">\n {2}<li><a href="cancao-azul\/index\.html">Cancao Azul<\/a>/);
  assert.doesNotMatch(html, /<script/, 'the repertoire needs no script');
  run('song-set', song.id, '--status', 'active');
  assert.doesNotMatch(readFileSync(index, 'utf8'), /Guardadas/, 'empty groups are left out');
  const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
  assert.doesNotMatch(main, /\d{4}-\d{2}-\d{2}|\d+\s*(songs?|músicas?|%)/i, 'no dates or counts');
  const home = readFileSync(join(dir, 'index.html'), 'utf8');
  assert.match(home, /href="songs\/aulas-de-canto\/index\.html">Aulas de canto<\/a>/);
  assert.equal(run('songs').index, index);
});

test('song-set changes fields by flag or JSON patch; an empty value clears; versions are refused', () => {
  const { p, guia, base } = singing();
  const { song } = runWithStdin(blueSong(guia, base), 'song-add', p.id, '--no-open');
  const cifra = 'Am7        D7\nPrimeira linha de teste';
  run('song-set', song.id, '--cifra', cifra);
  const { song: patched } = runWithStdin('{"sections":[{"name":"Ponte","start":90,"end":"1:45"}],"notes":""}', 'song-set', song.id);
  assert.equal(patched.cifra, cifra);
  assert.deepEqual(patched.sections, [{ name: 'Ponte', start: 90, end: 105 }]);
  assert.equal(patched.notes, null);
  assert.match(readFileSync(run('song-get', song.id).file, 'utf8'), /<pre>Am7 {8}D7\nPrimeira linha de teste<\/pre>/);
  assert.throws(() => runWithStdin('{"versions":[]}', 'song-set', song.id), /can't change versions/);
  assert.throws(() => run('song-set', song.id, '--status', 'due'), /one of: active, stored/);
  assert.throws(() => run('song-set', 'nope', '--status', 'active'), /no song/);
});

test('song notes turn URLs into links and keep line breaks', () => {
  const { p, guia, base } = singing();
  const { song } = runWithStdin(blueSong(guia, base), 'song-add', p.id, '--no-open');
  run('song-set', song.id, '--notes', 'Ver https://example.com/a?b=1&c=2\nRespirar');
  const html = readFileSync(run('song-get', song.id).file, 'utf8');
  assert.match(html, /<a href="https:\/\/example\.com\/a\?b=1&amp;c=2">https:\/\/example\.com\/a\?b=1&amp;c=2<\/a><br>Respirar/);
});

test('song-version adds a recording in a new key, or re-keys one the song has', () => {
  const { p, guia, base } = singing();
  const { song } = runWithStdin(blueSong(guia, base), 'song-add', p.id, '--no-open');
  const { version } = run('song-version', song.id, '--kind', 'guia', '--file', guia, '--key', 'A');
  assert.equal(version.file, 'guia-2.mpeg', 'a second guide gets its own file');
  run('song-version', song.id, '--file', 'base.mpeg', '--key', 'si bemol');
  const got = run('song-get', song.id);
  assert.deepEqual(got.song.versions.map((/** @type {any} */ v) => `${v.file}:${v.key}`), ['guia.mpeg:Bb', 'base.mpeg:si bemol', 'guia-2.mpeg:A']);
  assert.match(readFileSync(got.file, 'utf8'), /Guia · A \(−3 st\)/);
  assert.throws(() => run('song-version', song.id, '--kind', 'karaoke', '--file', guia), /kind/);
});

test('inbox lists new audio from Downloads, grouped and with roles, until a song claims it', () => {
  const { p, guia, base } = singing();
  /** @param {...string} args */
  const inbox = (...args) => JSON.parse(execFileSync(process.execPath, [CLI, 'inbox', ...args], {
    env: { ...process.env, BEMTEVI_DIR: dir, BEMTEVI_DOWNLOADS_DIR: join(dir, 'dl') },
    encoding: 'utf8',
  }));
  const before = inbox();
  assert.equal(before.dir, join(dir, 'dl'));
  assert.deepEqual(before.groups.map((/** @type {any} */ g) => g.files.map((/** @type {any} */ f) => [f.path, f.role])), [[[base, 'base'], [guia, 'guia']]]);
  runWithStdin(blueSong(guia, base), 'song-add', p.id, '--no-open');
  assert.deepEqual(inbox().groups, [], 'claimed by the song');
  assert.ok(existsSync(guia), 'and still in Downloads');
});

test('song-add without a network says so in one line, and the song still saves', () => {
  const { p } = singing();
  const res = runWithStdin('{"title":"Cancao Azul","artist":"Artista Um"}', 'song-add', p.id, '--no-open');
  assert.equal(res.lyrics, 'failed');
  assert.match(res.note, /^Couldn't reach LRCLIB \(.+\); the song is saved, run song-lyrics \S+ later\.$/);
  assert.equal(run('project-get', p.id).resources.length, 1);
  const pasted = runWithStdin('{"title":"Brisa Clara","artist":"Artista Dois","lyrics":"Uma linha colada"}', 'song-add', p.id, '--no-open');
  assert.equal(pasted.lyrics, undefined, 'pasted lyrics are not fetched over');
});

test('song-add and song-lyrics store LRCLIB lyrics and show them beside the player', async () => {
  const { p, guia, base } = singing();
  const lrc = '[00:12.17]Primeira linha de teste\n[00:14.48]Segunda linha de teste';
  /** @type {string[]} */
  const asked = [];
  const other = { id: 37133480, albumName: 'Album Tres', duration: 254, instrumental: false, plainLyrics: 'Primeira linha de teste', syncedLyrics: '[00:20.00]Primeira linha de teste' };
  let records = [
    { id: 34711768, albumName: 'Album Um', duration: 224, instrumental: false, plainLyrics: 'Primeira linha de teste\n\nSegunda linha de teste', syncedLyrics: lrc },
    { id: 36087110, albumName: 'Album Dois', duration: 223, instrumental: false, plainLyrics: 'Primeira linha de teste', syncedLyrics: `${lrc.replace(/\]/g, '] ')}` },
    other,
  ];
  const server = createServer((req, res) => {
    asked.push(req.url ?? '');
    res.setHeader('content-type', 'application/json');
    if (req.url?.startsWith('/api/get/')) {
      const hit = req.url === `/api/get/${other.id}` ? other : null;
      res.statusCode = hit ? 200 : 404;
      res.end(JSON.stringify(hit ?? { message: 'Failed to find specified track' }));
      return;
    }
    res.end(JSON.stringify(records));
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(null)));
  const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
  /** @param {string} input @param {...string} args */
  const runAsync = async (input, ...args) => {
    const child = promisify(execFile)(process.execPath, [CLI, ...args], { env: { ...process.env, BEMTEVI_DIR: dir, BEMTEVI_LRCLIB_URL: `http://127.0.0.1:${port}` }, encoding: 'utf8' });
    child.child.stdin?.end(input);
    return JSON.parse((await child).stdout);
  };
  try {
    const res = await runAsync(blueSong(guia, base), 'song-add', p.id, '--no-open');
    assert.equal(asked[0], '/api/search?track_name=Cancao+Azul&artist_name=Artista+Um');
    assert.equal(res.lyrics, 'found');
    assert.equal(res.song.lrclibId, 34711768);
    assert.equal(res.song.syncedLyrics, lrc);
    assert.deepEqual(res.song.lyricsCandidates.map((/** @type {any} */ c) => c.id), [34711768, 37133480], 'Album Dois is the same timed text: one track');
    const html = readFileSync(res.file, 'utf8');
    assert.match(html, /<section class="lyrics">\n<h2>Letra<\/h2>\n<div class="lrc" data-track="34711768">\n<p data-t="12\.17">Primeira linha de teste<\/p>\n<p data-t="14\.48" class="gap">Segunda linha de teste<\/p>/, 'a stanza break from the plain text');
    assert.match(html, /<div class="lrc" data-track="37133480" hidden>/, 'every track is in the page, for switching offline');
    assert.match(html, /<select class="track" data-song="[^"]+" data-default="34711768">\n<option value="34711768" selected>Album Um · 3:44 · sincronizada<\/option>\n<option value="37133480">Album Tres · 4:14 · sincronizada<\/option>\n<\/select>/);
    assert.match(html, /<bemtevi-player[\s\S]*<p class="lyric-bar" hidden>[\s\S]*<input class="follow" type="checkbox" checked> Acompanhar a letra[\s\S]*class="nudge" data-step="-0\.5"[\s\S]*<\/bemtevi-player>/, 'the lyric controls ride in the sticky player');
    assert.doesNotMatch(html.slice(0, html.indexOf('</main>')), /<figure data-sync/, 'fake audio has no length: no version is trusted with the timing');

    const list = run('song-lyrics', res.song.id, '--list');
    assert.deepEqual(list.candidates, [
      { id: 34711768, album: 'Album Um', duration: 224, synced: true, kept: true },
      { id: 37133480, album: 'Album Tres', duration: 254, synced: true, kept: false },
    ]);

    const picked = await runAsync('', 'song-lyrics', res.song.id, '--pick', '37133480');
    assert.equal(asked.at(-1), '/api/get/37133480');
    assert.equal(picked.lyrics, 'picked');
    assert.equal(picked.song.lrclibId, 37133480);
    assert.equal(picked.song.syncedLyrics, '[00:20.00]Primeira linha de teste');
    assert.deepEqual(picked.song.lyricsCandidates.map((/** @type {any} */ c) => c.id), [37133480, 34711768]);
    const pickedHtml = readFileSync(picked.file, 'utf8');
    assert.match(pickedHtml, /<div class="lrc" data-track="37133480">/, 'the pick shows first');
    assert.match(pickedHtml, /data-default="37133480"/);
    await assert.rejects(runAsync('', 'song-lyrics', res.song.id, '--pick', '999'), /LRCLIB has no lyrics with id 999/);
    await assert.rejects(runAsync('', 'song-lyrics', res.song.id, '--pick', 'abc'), /--pick needs an LRCLIB id/);

    records = [];
    const again = await runAsync('', 'song-lyrics', res.song.id);
    assert.equal(again.lyrics, 'not-found');
    assert.match(again.note, /LRCLIB has no lyrics for "Cancao Azul"/);
    assert.equal(again.song.lrclibId, 37133480, 'a miss keeps what the song had');

    const pasted = run('song-set', res.song.id, '--lyrics', 'Primeira linha de teste');
    assert.equal(pasted.song.syncedLyrics, null, 'pasted lyrics drop the LRCLIB timing');
    assert.deepEqual(pasted.song.lyricsCandidates, [], 'and the tracks to choose from');
    const pastedHtml = readFileSync(pasted.file, 'utf8');
    assert.doesNotMatch(pastedHtml.slice(0, pastedHtml.indexOf('</main>')), /select class="track"|class="lyric-bar"/);
    assert.match(readFileSync(pasted.file, 'utf8'), /<pre>Primeira linha de teste<\/pre>/);
  } finally {
    server.close();
  }
});

/** A store file, parsed. @param {string} name @returns {any} */
const readJson = (name) => JSON.parse(readFileSync(join(dir, name), 'utf8'));
// --- Song tags and status ---

test('song-set takes tags by flag or JSON patch; the song page shows them as quiet labels', () => {
  const { p, guia, base } = singing();
  const { song } = runWithStdin(blueSong(guia, base), 'song-add', p.id, '--no-open');
  assert.deepEqual(song.tags, []);
  assert.deepEqual(run('song-set', song.id, '--tags', ' voz, Voz ,festa').song.tags, ['voz', 'festa']);
  assert.deepEqual(runWithStdin('{"tags":["bossa","samba"]}', 'song-set', song.id).song.tags, ['bossa', 'samba']);
  assert.throws(() => runWithStdin('{"tags":["a,b"]}', 'song-set', song.id), /no comma/);
  const html = readFileSync(run('song-get', song.id).file, 'utf8');
  assert.match(html, /<p class="mission">Artista Um[^\n]* <span class="tags">bossa · samba<\/span><\/p>/);
  assert.match(readFileSync(run('songs').index, 'utf8'), /<span class="tags">bossa · samba<\/span><\/li>/);
});

test('song-set and song-add take the old status names of songs copied from oliba, storing the new ones', () => {
  const { p, guia, base } = singing();
  const { song } = runWithStdin(blueSong(guia, base), 'song-add', p.id, '--no-open');
  assert.equal(run('song-set', song.id, '--status', 'retired').song.status, 'stored');
  assert.equal(run('song-set', song.id, '--status', 'working').song.status, 'active');
  assert.equal(runWithStdin('{"status":"repertoire"}', 'song-set', song.id).song.status, 'stored');
  assert.equal(runWithStdin('{"title":"Brisa Clara","artist":"Artista Dois","status":"working"}', 'song-add', p.id, '--no-open').song.status, 'active');
});

/** A store written by oliba 0.15: 6 songs working, 22 retired. */
const oldStore = () => {
  const p = run('project-create', '--topic', 'Canto', '--language', 'pt-BR');
  const projects = readJson('projects.json');
  projects[p.id].slug = 'canto';
  projects[p.id].resources = Array.from({ length: 28 }, (_, i) => ({
    id: `song-${i}`, type: 'song', slug: `s${i}`, title: `Canção ${i}`, artist: 'x', spotify: null, originalKey: null,
    sections: [], lyrics: null, syncedLyrics: null, lrclibId: null, lyricsDuration: null, cifra: null, notes: null,
    versions: [], status: i < 6 ? 'working' : 'retired', createdAt: `2026-09-${String(i + 1).padStart(2, '0')}T10:00:00.000Z`,
  }));
  writeFileSync(join(dir, 'projects.json'), JSON.stringify(projects));
  return p;
};

test('a 0.15 store reads as the new statuses, and index rebuilds every page from it', () => {
  const p = oldStore();
  const statuses = run('songs').songs.map((/** @type {any} */ s) => s.status);
  assert.equal(statuses.filter((/** @type {string} */ s) => s === 'active').length, 6);
  assert.equal(statuses.filter((/** @type {string} */ s) => s === 'stored').length, 22);
  assert.equal(readJson('projects.json')[p.id].resources[0].status, 'working', 'reading migrates; the store is rewritten only when something else changes');
  const { file, files } = run('index');
  assert.equal(file, join(dir, 'index.html'));
  assert.equal(files.length, 28 + 1 + 1, '28 song pages, the repertoire, the home index');
  const rep = readFileSync(join(dir, 'songs', 'canto', 'index.html'), 'utf8');
  assert.equal((rep.slice(0, rep.indexOf('<details class')).match(/<li>/g) ?? []).length, 6, 'six active songs up front');
  assert.equal((rep.slice(rep.indexOf('<details class')).match(/<li>/g) ?? []).length, 22, 'the rest folded away');
  assert.ok(existsSync(join(dir, 'songs', 'canto', 's27', 'index.html')));
});

test('SessionStart rebuilds every page once per plugin version', () => {
  oldStore();
  const hook = () => execFileSync(process.execPath, [join(dirname(CLI), 'session-start.mjs')], { env: { ...process.env, BEMTEVI_DIR: dir, OLIBA_DIR: join(dir, 'no-oliba') }, encoding: 'utf8' });
  const page = join(dir, 'songs', 'canto', 's0', 'index.html');
  hook();
  assert.match(readFileSync(page, 'utf8'), /Canção 0/);
  const { version } = JSON.parse(readFileSync(join(dirname(CLI), '..', '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.equal(readFileSync(join(dir, '.pages-version'), 'utf8'), version);
  rmSync(page);
  hook();
  assert.equal(existsSync(page), false, 'same version: nothing rebuilt');
  writeFileSync(join(dir, '.pages-version'), '0.0.1');
  hook();
  assert.ok(existsSync(page), 'an upgrade rebuilds');
});
