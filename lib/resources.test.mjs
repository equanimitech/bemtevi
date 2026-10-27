// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TYPES, pitchClass, semitones, seconds, parseLrc, validateSong, renderRepertoire, migrateSongs, songStatus } from './resources.mjs';

test('the repertoire lists active songs, then stored ones folded away, each newest first, ties by title, no dates', () => {
  /** @param {string} title @param {string} createdAt @param {string} [status] */
  const song = (title, createdAt, status = 'active') => /** @type {any} */ ({ id: title, title, artist: 'x', slug: title.toLowerCase(), status, createdAt });
  const html = renderRepertoire({ topic: 'Canto' }, [
    song('Brisa Clara', '2026-08-01T10:00:00.000Z'),
    song('Onda', '2026-09-20T10:00:00.000Z'),
    song('Garota', '2026-09-20T10:00:00.000Z'),
    song('Cancao Azul', '2026-09-30T10:00:00.000Z', 'stored'),
    song('Samba', '2026-07-01T10:00:00.000Z', 'stored'),
  ], 'pt-BR');
  const order = [...html.matchAll(/<li><a href="[^"]+">([^<]+)<\/a>/g)].map((m) => m[1]);
  assert.deepEqual(order, ['Garota', 'Onda', 'Brisa Clara', 'Cancao Azul', 'Samba']);
  assert.match(html, /<h2>Ativas<\/h2>\n<ul class="songs">[\s\S]*<\/ul>\n<details class="stored">\n<summary>Guardadas<\/summary>\n<ul class="songs">\n {2}<li><a href="cancao azul\/index\.html">/);
  assert.doesNotMatch(html, /<details[^>]* open/, 'stored songs start folded');
  assert.doesNotMatch(html, /\d{4}-\d{2}-\d{2}/, 'order only, no dates');
});

test('keys read as letters or pt solfège', () => {
  assert.equal(pitchClass('Bb'), 10);
  assert.equal(pitchClass('si bemol'), 10);
  assert.equal(pitchClass('Si♭'), 10);
  assert.equal(pitchClass('F#m'), 6);
  assert.equal(pitchClass('Dó'), 0);
  assert.equal(pitchClass('lá menor'), 9);
  assert.equal(pitchClass('B'), 11);
  assert.equal(pitchClass('H'), null);
  assert.equal(pitchClass('bemol'), null);
});

test('semitones take the short way round, derived from the two keys', () => {
  assert.equal(semitones('C', 'Bb'), -2);
  assert.equal(semitones('C', 'D'), 2);
  assert.equal(semitones('C', 'F#'), -6);
  assert.equal(semitones('Bb', 'si bemol'), 0);
  assert.equal(semitones(null, 'Bb'), null);
});

test('section times read as seconds or m:ss', () => {
  assert.equal(seconds(42), 42);
  assert.equal(seconds('0:42'), 42);
  assert.equal(seconds('1:05.5'), 65.5);
  assert.ok(Number.isNaN(seconds('soon')));
});

test('LRC parses into timed lines and drops metadata tags', () => {
  assert.deepEqual(parseLrc('[ar:Artista Um]\n[00:12.17]Primeira linha de teste\n[00:14.48]Segunda linha de teste\n[00:20.00]'), [
    { t: 12.17, text: 'Primeira linha de teste' },
    { t: 14.48, text: 'Segunda linha de teste' },
    { t: 20, text: '' },
  ]);
  assert.deepEqual(parseLrc(null), []);
});

test('the song type validates its required fields and shapes, in one line', () => {
  assert.deepEqual(TYPES.song.required, ['title', 'artist']);
  assert.equal(TYPES.song.review, 'none', 'a song is kept, not recalled: nothing goes to FSRS');
  assert.equal(validateSong({ title: 'Cancao Azul', artist: 'Artista Um' }), null);
  assert.equal(validateSong({ title: 'Cancao Azul' }), 'a song needs "artist"');
  assert.match(validateSong({ title: 'x', artist: 'y', status: 'due' }) ?? '', /status/);
  assert.match(validateSong({ title: 'x', artist: 'y', originalKey: 'H' }) ?? '', /key "H"/);
  assert.match(validateSong({ title: 'x', artist: 'y', spotify: 'spotify:track:1' }) ?? '', /https/);
  assert.match(validateSong({ title: 'x', artist: 'y', sections: [{ name: 'Refrão', start: '1:05', end: '0:42' }] }) ?? '', /start < end/);
  assert.match(validateSong({ title: 'x', artist: 'y', versions: [{ kind: 'karaoke', file: 'a.m4a' }] }) ?? '', /kind/);
  assert.match(validateSong({ title: 'x', artist: 'y', versions: [{ kind: 'guia', file: 'a.m4a', key: 'Z' }] }) ?? '', /key "Z"/);
  assert.equal(validateSong({ status: 'stored' }, { patch: true }), null, 'a patch skips required');
  assert.match(validateSong({ status: 'working' }, { patch: true }) ?? '', /one of: active, stored/, 'old names are mapped by the CLI, never stored');
  assert.match(validateSong({ title: ' ' }, { patch: true }) ?? '', /can't be empty/);
});

test('song tags are validated like project tags', () => {
  assert.equal(validateSong({ tags: ['voz', 'festa'] }, { patch: true }), null);
  assert.match(validateSong({ tags: 'voz' }, { patch: true }) ?? '', /list/);
  assert.match(validateSong({ tags: ['a,b'] }, { patch: true }) ?? '', /no comma/);
  assert.match(validateSong({ tags: ['x'.repeat(41)] }, { patch: true }) ?? '', /1–40/);
  assert.match(validateSong({ tags: [' '] }, { patch: true }) ?? '', /1–40/);
  assert.match(validateSong({ tags: Array.from({ length: 21 }, (_, i) => `t${i}`) }, { patch: true }) ?? '', /up to 20/);
});

test('the repertoire is read only: tags are quiet labels, with no filter, switch or chips', () => {
  /** @param {string} title @param {string[]} tags @param {string} [status] */
  const song = (title, tags, status = 'active') => /** @type {any} */ ({ id: `id-${title}`, title, artist: 'x', slug: title.toLowerCase(), status, tags, createdAt: '2026-09-01' });
  const html = renderRepertoire({ topic: 'Canto' }, [song('Onda', ['Voz', 'bossa']), song('Samba', [], 'stored')], 'fr');
  assert.match(html, /<li><a href="onda\/index\.html">Onda<\/a> <span class="gloss">x<\/span> <span class="tags">Voz · bossa<\/span><\/li>/);
  assert.match(html, /<li><a href="samba\/index\.html">Samba<\/a> <span class="gloss">x<\/span><\/li>/, 'no tags, no label');
  assert.match(html, /<h2>En cours<\/h2>[\s\S]*<summary>Rangées<\/summary>/);
  assert.doesNotMatch(html, /<button|<input|class="filter"|data-song|hidden/);
});

test('old song statuses read as the two new ones; the rest of the project is untouched', () => {
  assert.deepEqual(['working', 'repertoire', 'retired', 'active', 'stored', 'due'].map(songStatus), ['active', 'stored', 'stored', 'active', 'stored', 'due']);
  const lesson = { type: 'note', status: 'working' };
  const project = { id: 'p', resources: [{ type: 'song', id: 'a', status: 'working' }, { type: 'song', id: 'b', status: 'retired' }, lesson] };
  const next = migrateSongs(project);
  assert.deepEqual(next.resources.map((/** @type {any} */ r) => r.status), ['active', 'stored', 'working'], 'only songs map');
  assert.equal(project.resources[0].status, 'working', 'the input is not changed');
  const current = { id: 'q', resources: [{ type: 'song', id: 'c', status: 'active' }] };
  assert.equal(migrateSongs(current), current, 'nothing old, same object');
  assert.equal(migrateSongs({ id: 'r' }).id, 'r', 'a project with no resources');
});
