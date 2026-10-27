// @ts-check
/**
 * Writing pages: the template, ~/.bemtevi/index.html (every songbook), each
 * song's page and its songbook's repertoire. Pages are for reading and
 * practice; changes go through the conversation and the CLI.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { escapeHtml, fold, slugify } from './text.mjs';
import { TYPES, labels, renderRepertoire, songsOf } from './resources.mjs';
import { dataDir } from './store.mjs';

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');

/**
 * The one page template, with the stylesheet and scripts inlined so each
 * file stands alone.
 * @param {{ title: string, lang?: string | null, body: string, data?: Record<string, string>, scripts?: string[] }} page
 */
export const renderPage = ({ title, lang, body, data = {}, scripts = [] }) => `<!doctype html>
<html lang="${escapeHtml(lang || 'en')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="bemtevi">
<link rel="icon" href="data:,">
<title>${escapeHtml(title)}</title>
<style>
${readFileSync(join(ASSETS, 'bemtevi.css'), 'utf8')}</style>
</head>
<body>
<main${Object.entries(data).map(([k, v]) => ` data-${k}="${escapeHtml(v)}"`).join('')}>
${body}
</main>
${scripts.map((name) => `<script>\n${readFileSync(join(ASSETS, name), 'utf8')}</script>\n`).join('')}</body>
</html>
`;

/**
 * The songbook's folder name under songs/. Fixed the first time, so renaming
 * the songbook doesn't move its files.
 * @param {any} project
 */
export const projectSlug = (project) => (project.slug ??= slugify(project.topic ?? project.id));

/** ~/.bemtevi/songs/<songbook>/<song>/ @param {any} project @param {import('./resources.mjs').Song} song */
export const songDir = (project, song) => join(dataDir(), TYPES.song.dir, projectSlug(project), song.slug);

/** ~/.bemtevi/songs/<songbook>/index.html @param {any} project */
export const repertoireFile = (project) => join(dataDir(), TYPES.song.dir, projectSlug(project), 'index.html');

/**
 * The home index: every songbook that has songs, linking its repertoire. No counts.
 * @param {Record<string, any>} projects
 */
export const writeHomeIndex = (projects) => {
  const books = Object.values(projects).filter((p) => songsOf(p).length)
    .sort((a, b) => fold(a.topic ?? '').localeCompare(fold(b.topic ?? '')));
  const lang = books[0]?.language ?? 'en';
  const body = [
    '<h1>bemtevi</h1>',
    ...books.map((p) => `<p><a href="${TYPES.song.dir}/${escapeHtml(projectSlug(p))}/index.html">${escapeHtml(p.topic ?? p.id)}</a></p>`),
  ].join('\n');
  mkdirSync(dataDir(), { recursive: true });
  const file = join(dataDir(), 'index.html');
  writeFileSync(file, renderPage({ title: 'bemtevi', lang, body, data: { type: 'home' } }));
  return file;
};

/** @param {any} project @param {import('./resources.mjs').Song} song */
const writeSongPage = (project, song) => {
  const dir = songDir(project, song);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'index.html');
  writeFileSync(file, renderPage({
    title: song.title,
    lang: project.language,
    body: TYPES.song.render(song, project.language),
    data: { type: 'song' },
    scripts: TYPES.song.scripts,
  }));
  return file;
};

/** @param {any} project */
const writeRepertoire = (project) => {
  const index = repertoireFile(project);
  mkdirSync(dirname(index), { recursive: true });
  writeFileSync(index, renderPage({
    title: labels(project.language).repertoire,
    lang: project.language,
    body: renderRepertoire(project, songsOf(project), project.language),
    data: { type: 'repertoire' },
  }));
  return index;
};

/**
 * Render the song's page and its songbook's repertoire.
 * @param {any} project @param {import('./resources.mjs').Song} song
 */
export const writeSongPages = (project, song) => ({ file: writeSongPage(project, song), index: writeRepertoire(project) });

/**
 * Re-render every song page, every repertoire and the home index from the store.
 * @param {Record<string, any>} projects
 * @returns {string[]} the paths written
 */
export const writeAllPages = (projects) => [
  ...Object.values(projects).flatMap((p) => (songsOf(p).length ? [...songsOf(p).map((s) => writeSongPage(p, s)), writeRepertoire(p)] : [])),
  writeHomeIndex(projects),
];
