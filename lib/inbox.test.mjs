// @ts-check
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseAudioName, editDistance, scanInbox } from './inbox.mjs';

/** @type {string} */
let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'bemtevi-inbox-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

test('a file name gives the song title and the recording role', () => {
  assert.deepEqual(parseAudioName('cancao azul - sem voz.mpeg'), { title: 'cancao azul', role: 'base' });
  assert.deepEqual(parseAudioName('cancao azuz - com voz.mpeg'), { title: 'cancao azuz', role: 'guia' });
  assert.deepEqual(parseAudioName('Brisa Clara (Playback).m4a'), { title: 'Brisa Clara', role: 'base' });
  assert.deepEqual(parseAudioName('Brisa Clara - GUIA (1).m4a'), { title: 'Brisa Clara', role: 'guia' });
  assert.deepEqual(parseAudioName('Noite Longa_karaoke.mp3'), { title: 'Noite Longa', role: 'base' });
  assert.deepEqual(parseAudioName('Onda no vocals.wav'), { title: 'Onda', role: 'base' });
  assert.deepEqual(parseAudioName('Onda with vocals.wav'), { title: 'Onda', role: 'guia' });
  assert.deepEqual(parseAudioName('Onda instrumental.opus'), { title: 'Onda', role: 'base' });
  assert.deepEqual(parseAudioName('Samba de um tom só.m4a'), { title: 'Samba de um tom só', role: null });
});

test('edit distance counts a typo as one', () => {
  assert.equal(editDistance('cancao azul', 'cancao azuz'), 1);
  assert.equal(editDistance('', 'abc'), 3);
  assert.equal(editDistance('brisa clara', 'brisa clara'), 0);
});

test('scanInbox groups loose name matches of the same length, skipping claimed, old and non-audio files', () => {
  /** @type {Record<string, number>} */
  const lengths = {
    'cancao azul - sem voz.mpeg': 223.24,
    'cancao azuz - com voz.mpeg': 223.24,
    'Cancao Azul (novo tom) - com voz.m4a': 231.8,
    'Brisa Clara - guia.m4a': 190,
    'Brisa Clara - playback.m4a': 190.3,
    'old.m4a': 100,
    'claimed.m4a': 100,
  };
  for (const name of [...Object.keys(lengths), 'bemtevi-results-x.json', 'notes.txt']) writeFileSync(join(dir, name), 'x');
  const old = new Date(Date.now() - 30 * 86_400_000);
  utimesSync(join(dir, 'old.m4a'), old, old);

  const groups = scanInbox({ dir, claimed: new Set([join(dir, 'claimed.m4a')]), duration: (f) => lengths[f.split('/').pop() ?? ''] ?? null });
  const shape = groups.map((g) => [g.title, g.files.map((f) => `${f.name}:${f.role}`)]);
  assert.deepEqual(shape, [
    ['Brisa Clara', ['Brisa Clara - guia.m4a:guia', 'Brisa Clara - playback.m4a:base']],
    ['Cancao Azul (novo tom)', ['Cancao Azul (novo tom) - com voz.m4a:guia']],
    ['cancao azul', ['cancao azul - sem voz.mpeg:base', 'cancao azuz - com voz.mpeg:guia']],
  ]);
  assert.equal(groups[2].files[0].path, join(dir, 'cancao azul - sem voz.mpeg'));
  assert.equal(groups[2].files[0].duration, 223.24);
});

test('scanInbox groups by name alone when a length is unknown, and a missing folder is empty', () => {
  writeFileSync(join(dir, 'Onda - com voz.m4a'), 'x');
  writeFileSync(join(dir, 'onda - sem voz.m4a'), 'x');
  assert.equal(scanInbox({ dir, duration: () => null }).length, 1);
  assert.deepEqual(scanInbox({ dir: join(dir, 'nope') }), []);
});

test('a recording of 10 minutes or more is a class of its own, never grouped with a song', () => {
  /** @type {Record<string, number>} */
  const lengths = { 'Aula 30 set.m4a': 2700, 'aula 30 set - com voz.m4a': 223, 'Cancao Azul.m4a': 223.2, 'Nove minutos.m4a': 599 };
  for (const name of Object.keys(lengths)) writeFileSync(join(dir, name), 'x');
  const groups = scanInbox({ dir, duration: (f) => lengths[f.split('/').pop() ?? ''] ?? null });
  assert.deepEqual(groups.map((g) => [g.kind, g.files.map((f) => f.name)]), [
    ['class', ['Aula 30 set.m4a']],
    ['song', ['Cancao Azul.m4a']],
    ['song', ['Nove minutos.m4a']],
    ['song', ['aula 30 set - com voz.m4a']],
  ]);
});
