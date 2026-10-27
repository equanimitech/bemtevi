#!/usr/bin/env node
// @ts-check
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeAllPages } from './home.mjs';
import { migrateFromOliba, readProjects, dataDir } from './store.mjs';

/** @type {string[]} */
let copied = [];
try { copied = migrateFromOliba(); } catch { /* retried next session */ }

// After an upgrade or a copy from oliba, re-render every page so none is left
// in an old shape. Pages only, from the store. A failure retries next session.
const here = dirname(fileURLToPath(import.meta.url));
const pagesVersion = join(dataDir(), '.pages-version');
try {
  const running = JSON.parse(readFileSync(join(here, '..', '.claude-plugin', 'plugin.json'), 'utf8')).version;
  const stored = existsSync(pagesVersion) ? readFileSync(pagesVersion, 'utf8').trim() : null;
  if (running && (stored !== running || copied.length)) {
    writeAllPages(readProjects());
    mkdirSync(dataDir(), { recursive: true });
    writeFileSync(pagesVersion, running);
  }
} catch { /* pages rebuild next session */ }

process.stdout.write("bemtevi active. Skill: /bemtevi:song (file the teacher's recordings as one practice page per song: guide and backing, loops, slowdown, lyrics). Data: ~/.bemtevi/\n");
if (copied.length) process.stdout.write('Tell the user once, in one line: their songs were copied from oliba into ~/.bemtevi; the originals in ~/.oliba/songs stay until they delete them.\n');
