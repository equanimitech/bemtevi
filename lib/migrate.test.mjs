// @ts-check
// Copying songs out of oliba (before its 0.20), always between temp dirs.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIB = dirname(fileURLToPath(import.meta.url));

/** @type {string} */
let root;
const oliba = () => join(root, 'oliba');
const bemtevi = () => join(root, 'bemtevi');
const env = () => ({ ...process.env, OLIBA_DIR: oliba(), BEMTEVI_DIR: bemtevi() });
/** @param {...string} args */
const cli = (...args) => JSON.parse(execFileSync(process.execPath, [join(LIB, 'cli.mjs'), ...args], { env: env(), encoding: 'utf8' }));

/** @param {string} slug @param {string} title @param {string} status */
const song = (slug, title, status) => ({
  id: `id-${slug}`, type: 'song', slug, title, artist: 'Artista Um', spotify: null, originalKey: null, sections: [],
  lyrics: null, syncedLyrics: null, lrclibId: null, lyricsDuration: null, cifra: null, notes: null,
  versions: [{ kind: 'guia', file: 'guia.mpeg', key: null, duration: null, source: '/tmp/dl/x.mpeg' }],
  status, createdAt: '2026-09-30T10:00:00.000Z',
});

/** An oliba store: a singing project with two songs and their folders, and a project with none. */
const olibaStore = () => {
  const projects = {
    sing: { id: 'sing', topic: 'Aulas de canto', slug: 'aulas-de-canto', language: 'pt-BR', createdAt: '2026-09-01T10:00:00.000Z', nodes: [], resources: [song('azul', 'Cancao Azul', 'active'), song('mar', 'Onda', 'retired')] },
    law: { id: 'law', topic: 'Direito', nodes: [], resources: [] },
  };
  mkdirSync(oliba(), { recursive: true });
  writeFileSync(join(oliba(), 'projects.json'), JSON.stringify(projects));
  for (const slug of ['azul', 'mar']) {
    mkdirSync(join(oliba(), 'songs', 'aulas-de-canto', slug), { recursive: true });
    writeFileSync(join(oliba(), 'songs', 'aulas-de-canto', slug, 'guia.mpeg'), `fake ${slug}`);
    writeFileSync(join(oliba(), 'songs', 'aulas-de-canto', slug, 'index.html'), '<oliba-player>old page</oliba-player>');
  }
};

beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'bemtevi-migrate-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

test('migrate copies songbooks and their audio from oliba, renders bemtevi pages, and leaves oliba as it was', () => {
  olibaStore();
  const before = readFileSync(join(oliba(), 'projects.json'), 'utf8');
  assert.deepEqual(cli('migrate').copied, ['sing']);
  const book = cli('project-get', 'sing');
  assert.equal(book.topic, 'Aulas de canto');
  assert.equal(book.language, 'pt-BR');
  assert.equal('nodes' in book, false, 'only what a songbook needs');
  assert.deepEqual(book.resources.map((/** @type {any} */ s) => [s.slug, s.status]), [['azul', 'active'], ['mar', 'stored']]);
  assert.equal(readFileSync(join(bemtevi(), 'songs', 'aulas-de-canto', 'azul', 'guia.mpeg'), 'utf8'), 'fake azul');
  assert.match(readFileSync(join(bemtevi(), 'songs', 'aulas-de-canto', 'azul', 'index.html'), 'utf8'), /<bemtevi-player[\s\S]*src="guia\.mpeg"/);
  assert.ok(existsSync(join(bemtevi(), 'songs', 'aulas-de-canto', 'index.html')), 'the repertoire');
  assert.equal(readFileSync(join(oliba(), 'projects.json'), 'utf8'), before, 'oliba untouched');
  assert.equal(readFileSync(join(oliba(), 'songs', 'aulas-de-canto', 'azul', 'guia.mpeg'), 'utf8'), 'fake azul', 'originals stay');
  assert.equal(cli('project-list').length, 1, 'a project without songs is not copied');
});

test('migrate runs once: a second run copies nothing and never overwrites bemtevi', () => {
  olibaStore();
  cli('migrate');
  cli('song-set', 'azul', '--notes', 'kept in bemtevi');
  writeFileSync(join(bemtevi(), 'songs', 'aulas-de-canto', 'azul', 'guia.mpeg'), 'edited');
  assert.deepEqual(cli('migrate').copied, []);
  assert.equal(cli('song-get', 'azul').song.notes, 'kept in bemtevi');
  assert.equal(readFileSync(join(bemtevi(), 'songs', 'aulas-de-canto', 'azul', 'guia.mpeg'), 'utf8'), 'edited');
});

test('migrate without an oliba store does nothing', () => {
  assert.deepEqual(cli('migrate').copied, []);
  assert.equal(existsSync(join(bemtevi(), 'projects.json')), false);
});

test('SessionStart copies from oliba once and says so once', () => {
  olibaStore();
  const hook = () => execFileSync(process.execPath, [join(LIB, 'session-start.mjs')], { env: env(), encoding: 'utf8' });
  assert.match(hook(), /copied from oliba/);
  assert.ok(existsSync(join(bemtevi(), 'songs', 'aulas-de-canto', 'mar', 'index.html')));
  assert.doesNotMatch(hook(), /copied from oliba/);
});
