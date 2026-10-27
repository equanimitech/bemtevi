#!/usr/bin/env node
// @ts-check
/**
 * bemtevi CLI. The /bemtevi:song skill calls this as:
 *   node "${CLAUDE_PLUGIN_ROOT}/lib/cli.mjs" <subcommand> [args]
 * Every command prints JSON to stdout; errors go to stderr, exit code 1.
 */
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { readFileSync, mkdirSync, copyFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { slugify, normalizeTags } from './text.mjs';
import { TYPES, SONG_EDITABLE, VERSION_KINDS, normalizeSections, patchSong, songsOf, songStatus } from './resources.mjs';
import { writeHomeIndex, writeSongPages, writeAllPages, songDir, repertoireFile } from './home.mjs';
import { audioDuration, scanInbox } from './inbox.mjs';
import { findLyrics, getLyrics } from './lyrics.mjs';
import { readProjects, writeProjects, migrateFromOliba, dataDir } from './store.mjs';

/** @param {unknown} value */
const out = (value) => {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};

/**
 * @param {string} message
 * @returns {never}
 */
const fail = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

/** @param {string | undefined} raw */
const parseTags = (raw) =>
  raw ? raw.split(',').map((t) => t.trim()).filter(Boolean) : [];

/** Where downloads land (override: BEMTEVI_DOWNLOADS_DIR, for tests). */
const downloadsDir = () => process.env.BEMTEVI_DOWNLOADS_DIR ?? join(homedir(), 'Downloads');

/** Open a file in the default browser; silently skip where there is no opener. @param {string} file */
const openFile = (file) => {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  try {
    spawn(opener, [file], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
  } catch { /* the path is printed either way */ }
};

// --- Songbooks ---

/** @param {string[]} argv */
function cmdProjectCreate(argv) {
  const { values } = parseArgs({ args: argv, options: { topic: { type: 'string' }, language: { type: 'string' } } });
  if (!values.topic) fail('project-create requires --topic');
  const project = { id: randomUUID(), topic: values.topic, language: values.language ?? null, createdAt: new Date().toISOString(), resources: [] };
  const projects = readProjects();
  projects[project.id] = project;
  writeProjects(projects);
  out(project);
}

function cmdProjectList() {
  out(Object.values(readProjects())
    .map((p) => ({ id: p.id, topic: p.topic, language: p.language ?? null, createdAt: p.createdAt }))
    .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '')));
}

/** @param {string[]} argv */
function cmdProjectGet(argv) {
  const [id] = argv;
  if (!id) fail('usage: project-get <id>');
  const project = readProjects()[id];
  if (!project) fail(`no project with id ${id}`);
  out(project);
}

/**
 * Rebuild every page (song pages, repertoires, the home index) and print the
 * home index's path; --open opens it.
 * @param {string[]} argv
 */
function cmdIndex(argv) {
  const { values } = parseArgs({ args: argv, options: { open: { type: 'boolean' } } });
  const files = writeAllPages(readProjects());
  const file = files[files.length - 1];
  if (values.open) openFile(file);
  out({ file, files });
}

/** Copy the songs oliba kept into bemtevi (also run at session start). */
function cmdMigrate() {
  const copied = migrateFromOliba();
  if (copied.length) writeAllPages(readProjects());
  out({ copied });
}

// --- Songs ---

/** @typedef {import('./resources.mjs').Song} Song */

/**
 * A song by id or slug, in whichever project holds it.
 * @param {Record<string, any>} projects @param {string} ref
 * @returns {{ project: any, song: Song }}
 */
const findSong = (projects, ref) => {
  for (const project of Object.values(projects)) {
    const song = songsOf(project).find((s) => s.id === ref || s.slug === ref);
    if (song) return { project, song };
  }
  return fail(`no song with id ${ref}`);
};

/** @param {string} file */
const checkAudio = (file) => {
  if (!existsSync(file) || !statSync(file).isFile()) fail(`no audio file at ${file}`);
};

/**
 * Copy an audio file next to the song page as <kind>.<ext> (then <kind>-2.<ext>).
 * The original stays where it was; `source` records it, which claims it in the inbox.
 * @param {any} project @param {Song} song
 * @param {{ kind: import('./resources.mjs').VersionKind, file: string, key?: string | null }} input
 */
const addVersion = (project, song, { kind, file, key }) => {
  const source = resolve(file);
  const dir = songDir(project, song);
  mkdirSync(dir, { recursive: true });
  const ext = extname(source).toLowerCase();
  let name = `${kind}${ext}`;
  for (let n = 2; song.versions.some((v) => v.file === name) || existsSync(join(dir, name)); n++) name = `${kind}-${n}${ext}`;
  copyFileSync(source, join(dir, name));
  const version = { kind, file: name, key: key || null, duration: audioDuration(source), source };
  song.versions = [...song.versions, version];
  return version;
};

/**
 * Put the song's LRCLIB lyrics on it, matched to the length of its audio
 * (a guide first). No match or no network: the one line to tell the learner.
 * @param {Song} song
 * @returns {Promise<{ lyrics: 'found' | 'not-found' | 'failed', note?: string }>}
 */
const fetchLyrics = async (song) => {
  const audio = song.versions.find((v) => v.kind === 'guia' && v.duration) ?? song.versions.find((v) => v.duration);
  const result = await findLyrics({ title: song.title, artist: song.artist, duration: audio?.duration ?? null });
  if (result.status === 'found') {
    Object.assign(song, result.found, { lyricsCandidates: result.candidates });
    return { lyrics: 'found' };
  }
  return {
    lyrics: result.status,
    note: result.status === 'not-found'
      ? `LRCLIB has no lyrics for "${song.title}"; paste them with song-set --lyrics.`
      : `Couldn't reach LRCLIB (${result.reason}); the song is saved, run song-lyrics ${song.id} later.`,
  };
};

/** @param {string} usage @returns {any} */
const readJsonStdin = (usage) => {
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return fail(usage);
  }
};

/**
 * File a song under a project: validate, copy its audio next to its page,
 * render the page and the repertoire, relink the home index.
 * stdin: { title, artist, spotify?, originalKey?, sections?, lyrics?, cifra?, notes?, status?, versions?: [{ kind, file, key? }] }
 * @param {string[]} argv
 */
async function cmdSongAdd(argv) {
  const { values, positionals } = parseArgs({ args: argv, options: { 'no-open': { type: 'boolean' }, 'no-lyrics': { type: 'boolean' } }, allowPositionals: true });
  const [projectId] = positionals;
  if (!projectId) fail('usage: song-add <projectId> [--no-open] [--no-lyrics] < song.json');
  const raw = readJsonStdin('song-add needs the song as JSON on stdin');
  // Old status names (working, repertoire, retired) still map, for songs copied from oliba.
  const input = raw.status === undefined ? raw : { ...raw, status: songStatus(raw.status) };
  const problem = TYPES.song.validate(input);
  if (problem) fail(`song-add: ${problem}`);
  const projects = readProjects();
  const project = projects[projectId];
  if (!project) fail(`no project with id ${projectId}`);
  for (const v of input.versions ?? []) checkAudio(v.file);

  const taken = new Set(songsOf(project).map((s) => s.slug));
  const base = slugify(input.title);
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
  /** @type {Song} */
  const song = {
    id: randomUUID(),
    type: 'song',
    slug,
    title: input.title.trim(),
    artist: input.artist.trim(),
    spotify: input.spotify || null,
    originalKey: input.originalKey || null,
    sections: normalizeSections(input.sections),
    lyrics: input.lyrics || null,
    syncedLyrics: null,
    lrclibId: null,
    lyricsDuration: null,
    lyricsCandidates: [],
    cifra: input.cifra || null,
    tags: normalizeTags(input.tags ?? []),
    notes: input.notes || null,
    versions: [],
    status: songStatus(input.status ?? 'active'),
    createdAt: new Date().toISOString(),
  };
  for (const v of input.versions ?? []) addVersion(project, song, v);
  const lyrics = song.lyrics || values['no-lyrics'] ? {} : await fetchLyrics(song);
  project.resources = [...(project.resources ?? []), song];
  const pages = writeSongPages(project, song);
  writeProjects(projects);
  writeHomeIndex(projects);
  if (!values['no-open']) openFile(pages.file);
  out({ song, ...pages, ...lyrics });
}

/**
 * Fetch (or fetch again) a song's lyrics from LRCLIB. A miss keeps what it had.
 * `--list` prints the lyric tracks it keeps to choose from (no network);
 * `--pick <lrclibId>` fetches that record and makes it the song's lyrics.
 * @param {string[]} argv
 */
async function cmdSongLyrics(argv) {
  const { values, positionals } = parseArgs({ args: argv, options: { list: { type: 'boolean' }, pick: { type: 'string' } }, allowPositionals: true });
  const [ref] = positionals;
  if (!ref) fail('usage: song-lyrics <songId> [--list | --pick <lrclibId>]');
  const projects = readProjects();
  const { project, song } = findSong(projects, ref);
  if (values.list) {
    const candidates = (song.lyricsCandidates ?? []).map(({ id, album, duration, synced }) => ({ id, album, duration, synced, kept: id === song.lrclibId }));
    return out({ songId: song.id, lrclibId: song.lrclibId, candidates, ...(candidates.length ? {} : { note: `No lyric tracks stored; run song-lyrics ${song.id} to search LRCLIB.` }) });
  }
  if (values.pick !== undefined) {
    const id = Number(values.pick);
    if (!Number.isInteger(id) || id <= 0) fail('--pick needs an LRCLIB id, a whole number (song-lyrics <songId> --list shows them)');
    const result = await getLyrics(id);
    if (result.status === 'not-found') fail(`LRCLIB has no lyrics with id ${id}`);
    if (result.status === 'failed') fail(`Couldn't reach LRCLIB (${result.reason}); nothing changed.`);
    const others = (song.lyricsCandidates ?? []).filter((c) => c.id !== id);
    Object.assign(song, result.found, { lyricsCandidates: [...result.candidates, ...others] });
    const pages = writeSongPages(project, song);
    writeProjects(projects);
    return out({ song, ...pages, lyrics: 'picked' });
  }
  const lyrics = await fetchLyrics(song);
  const pages = writeSongPages(project, song);
  writeProjects(projects);
  out({ song, ...pages, ...lyrics });
}

const SONG_FLAGS = /** @type {const} */ ({
  title: { type: 'string' },
  artist: { type: 'string' },
  spotify: { type: 'string' },
  'original-key': { type: 'string' },
  status: { type: 'string' },
  cifra: { type: 'string' },
  notes: { type: 'string' },
  lyrics: { type: 'string' },
  tags: { type: 'string' },
});

/**
 * Change a song: flags for one field, or a JSON patch on stdin (sections,
 * several fields at once). An empty value clears the field. Pasted lyrics
 * replace fetched ones, timing included.
 * @param {string[]} argv
 */
function cmdSongSet(argv) {
  const { values, positionals } = parseArgs({ args: argv, options: SONG_FLAGS, allowPositionals: true });
  const [ref] = positionals;
  if (!ref) fail('usage: song-set <songId> [--status active|stored] [--tags a,b] [--cifra "..."] [--notes "..."] [--original-key Bb] [--lyrics "..."] | song-set <songId> < patch.json');
  const flags = Object.fromEntries(Object.entries(values).map(([k, v]) => [k === 'original-key' ? 'originalKey' : k, k === 'tags' ? parseTags(v) : v]));
  const given = Object.keys(flags).length ? flags : readJsonStdin('song-set needs a flag or a JSON patch on stdin');
  // Old status names (working, repertoire, retired) still map, for songs copied from oliba.
  const patch = given.status === undefined ? given : { ...given, status: songStatus(given.status) };
  const unknown = Object.keys(patch).filter((k) => !SONG_EDITABLE.includes(k));
  if (unknown.length) fail(`song-set can't change ${unknown.join(', ')} (versions: song-version)`);
  const problem = TYPES.song.validate(patch, { patch: true });
  if (problem) fail(`song-set: ${problem}`);
  const projects = readProjects();
  const { project, song: old } = findSong(projects, ref);
  const song = patchSong(old, patch);
  project.resources = project.resources.map((/** @type {any} */ r) => (r === old ? song : r));
  const pages = writeSongPages(project, song);
  writeProjects(projects);
  writeHomeIndex(projects);
  out({ song, ...pages });
}

/**
 * Add a recording to a song (copied next to its page), or re-key one it has:
 * `--file` naming an existing version's file changes that version.
 * @param {string[]} argv
 */
function cmdSongVersion(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    options: { kind: { type: 'string' }, file: { type: 'string' }, key: { type: 'string' } },
    allowPositionals: true,
  });
  const [ref] = positionals;
  if (!ref || !values.file) fail(`usage: song-version <songId> --file <audio> --kind ${VERSION_KINDS.join('|')} [--key Bb]  (the file name of a version it has, with --key, re-keys it)`);
  const projects = readProjects();
  const { project, song } = findSong(projects, ref);
  const existing = song.versions.find((v) => v.file === values.file);
  const kind = /** @type {any} */ (values.kind ?? existing?.kind);
  const problem = TYPES.song.validate({ versions: [{ kind, file: values.file, key: values.key }] }, { patch: true });
  if (problem) fail(`song-version: ${problem}`);
  let version;
  if (existing) {
    Object.assign(existing, { kind, key: values.key ?? existing.key });
    version = existing;
  } else {
    checkAudio(values.file);
    version = addVersion(project, song, { kind, file: values.file, key: values.key });
  }
  const pages = writeSongPages(project, song);
  writeProjects(projects);
  out({ version, ...pages });
}

/** A song and its page's path; --open opens the page. @param {string[]} argv */
function cmdSongGet(argv) {
  const { values, positionals } = parseArgs({ args: argv, options: { open: { type: 'boolean' } }, allowPositionals: true });
  const [ref] = positionals;
  if (!ref) fail('usage: song-get <songId> [--open]');
  const { project, song } = findSong(readProjects(), ref);
  const file = join(songDir(project, song), 'index.html');
  if (values.open) openFile(file);
  out({ projectId: project.id, song, file });
}

/**
 * New audio in Downloads (WhatsApp Web, AirDrop) that no song has claimed yet,
 * grouped into proposed songs with each file's role guessed from its name.
 * @param {string[]} argv
 */
function cmdInbox(argv) {
  const { values } = parseArgs({ args: argv, options: { days: { type: 'string' } } });
  const claimed = new Set([
    ...Object.values(readProjects()).flatMap((p) => songsOf(p).flatMap((s) => s.versions.map((v) => v.source ?? ''))),
  ]);
  const dir = downloadsDir();
  out({ dir, groups: scanInbox({ dir, claimed, days: values.days ? Number(values.days) : 14 }) });
}

/**
 * Every song (for matching a title), and the repertoire index when one project
 * has songs; --open opens it (the home index when several do).
 * @param {string[]} argv
 */
function cmdSongs(argv) {
  const { values } = parseArgs({ args: argv, options: { project: { type: 'string' }, open: { type: 'boolean' } } });
  const projects = Object.values(readProjects()).filter((p) => songsOf(p).length && (!values.project || p.id === values.project));
  const songs = projects.flatMap((p) => songsOf(p).map((s) => ({
    id: s.id, projectId: p.id, title: s.title, artist: s.artist, status: s.status, file: join(songDir(p, s), 'index.html'),
  })));
  const index = projects.length === 1 ? repertoireFile(projects[0]) : null;
  if (values.open) openFile(index ?? join(dataDir(), 'index.html'));
  out({ songs, index });
}

// --- Dispatch ---

/** @type {Record<string, (argv: string[]) => void | Promise<void>>} */
const commands = {
  'project-create': cmdProjectCreate,
  'project-list': cmdProjectList,
  'project-get': cmdProjectGet,
  index: cmdIndex,
  migrate: cmdMigrate,
  'song-add': cmdSongAdd,
  'song-set': cmdSongSet,
  'song-version': cmdSongVersion,
  'song-get': cmdSongGet,
  'song-lyrics': cmdSongLyrics,
  songs: cmdSongs,
  inbox: cmdInbox,
};

const [cmd, ...rest] = process.argv.slice(2);
const handler = cmd ? commands[cmd] : undefined;
if (!handler) fail(`usage: cli.mjs <${Object.keys(commands).join('|')}> [args]`);
handler(rest);
