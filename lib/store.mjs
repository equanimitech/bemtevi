// @ts-check
/**
 * Persistence for bemtevi: plain JSON in ~/.bemtevi/ (override with
 * BEMTEVI_DIR). `projects.json` holds songbooks keyed by id, each with its
 * songs in `resources`. No server, no account, no sync.
 */
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { migrateSongs, songsOf } from './resources.mjs';
import { slugify } from './text.mjs';

export const dataDir = () => process.env.BEMTEVI_DIR ?? join(homedir(), '.bemtevi');
/** Where oliba kept songs before its 0.20. */
export const olibaDir = () => process.env.OLIBA_DIR ?? join(homedir(), '.oliba');

/** @param {string} dir @returns {Record<string, any>} */
const readProjectsAt = (dir) => {
  try {
    return JSON.parse(readFileSync(join(dir, 'projects.json'), 'utf8'));
  } catch (err) {
    if (err && /** @type {any} */ (err).code === 'ENOENT') return {};
    throw err;
  }
};

/**
 * Songbooks, with songs' pre-0.16 statuses read as today's (see migrateSongs).
 * @returns {Record<string, any>}
 */
export const readProjects = () => Object.fromEntries(Object.entries(readProjectsAt(dataDir())).map(([id, p]) => [id, migrateSongs(p)]));

/**
 * Write atomically (tmp file + rename), pretty-printed so it stays editable.
 * @param {Record<string, any>} projects
 */
export function writeProjects(projects) {
  mkdirSync(dataDir(), { recursive: true });
  const target = join(dataDir(), 'projects.json');
  writeFileSync(`${target}.tmp`, `${JSON.stringify(projects, null, 2)}\n`);
  renameSync(`${target}.tmp`, target);
}

/**
 * Copy the songs oliba kept (before its 0.20) into bemtevi: each oliba
 * project with songs becomes a songbook with the same id, its folder under
 * songs/ copied beside it. Copies only, never moves or deletes; a songbook
 * already here is left alone, so running it again changes nothing.
 * @returns {string[]} the ids of the songbooks copied in
 */
export function migrateFromOliba() {
  const from = olibaDir();
  if (from === dataDir() || !existsSync(join(from, 'projects.json'))) return [];
  const projects = readProjects();
  /** @type {string[]} */
  const copied = [];
  for (const p of Object.values(readProjectsAt(from))) {
    const songs = songsOf(p);
    if (!songs.length || projects[p.id]) continue;
    const slug = p.slug ?? slugify(p.topic ?? p.id);
    const folder = join(from, 'songs', slug);
    if (existsSync(folder)) cpSync(folder, join(dataDir(), 'songs', slug), { recursive: true, force: false, errorOnExist: false });
    projects[p.id] = migrateSongs({ id: p.id, topic: p.topic, slug, language: p.language ?? null, createdAt: p.createdAt ?? new Date().toISOString(), resources: songs });
    copied.push(p.id);
  }
  if (copied.length) writeProjects(projects);
  return copied;
}
