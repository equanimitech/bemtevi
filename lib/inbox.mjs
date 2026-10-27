// @ts-check
/**
 * Audio files on disk: their length, and (for `cli.mjs inbox`) which new ones
 * in Downloads could belong to a song.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fold } from './text.mjs';

/** What the teacher sends: WhatsApp Web names MP3s .mpeg; the page decides what plays. */
export const AUDIO_FILE = /\.(m4a|mp3|mpeg|mp4|aac|ogg|opus|wav)$/i;

/** Suffixes that name a recording's role, backing first ("sem voz" before "voz"). */
const ROLES = /** @type {const} */ ([
  ['base', /\b(sem voz|instrumental|playback|karaoke|no vocals?|backing(?: track)?)\b/i],
  ['guia', /\b(com voz|guia|with vocals?|vocal guide)\b/i],
]);

/**
 * "flor de lis - sem voz.mpeg" → { title: "flor de lis", role: "base" }.
 * Copy suffixes like "(1)" go too.
 * @param {string} name
 * @returns {{ title: string, role: 'guia' | 'base' | null }}
 */
export const parseAudioName = (name) => {
  const stem = name.replace(/\.[^.]+$/, '').replace(/\s*\(\d+\)$/, '').replace(/_/g, ' ').normalize('NFC');
  const hit = ROLES.find(([, re]) => re.test(fold(stem)));
  const title = (hit ? stem.replace(hit[1], ' ') : stem)
    .replace(/\(\s*\)|\[\s*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—]+|[\s\-–—]+$/g, '')
    .trim();
  return { title, role: hit ? hit[0] : null };
};

/**
 * Levenshtein distance; names differ by a typo ("lis" / "liz").
 * @param {string} a @param {string} b
 */
export const editDistance = (a, b) => {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (const [i, ca] of [...a].entries()) {
    const row = [i + 1];
    for (const [j, cb] of [...b].entries()) row.push(Math.min(prev[j + 1] + 1, row[j] + 1, prev[j] + (ca === cb ? 0 : 1)));
    prev = row;
  }
  return prev[b.length];
};

/** A recording this long is a class, not a song (seconds): Voice Memos of a lesson run 30–60 min. */
export const CLASS_SECONDS = 600;

/**
 * @typedef {{ path: string, name: string, title: string, role: 'guia' | 'base' | null, duration: number | null }} InboxFile
 * @typedef {{ title: string, kind: 'song' | 'class', files: InboxFile[] }} InboxGroup
 */

/**
 * Two files are one song when their names match loosely (case and accents
 * folded, ≤ 2 edits) and their lengths match within 0.5 s. An unknown length
 * doesn't split them: the learner confirms every group anyway.
 * @param {InboxFile} a @param {InboxFile} b
 */
export const sameSong = (a, b) => editDistance(fold(a.title), fold(b.title)) <= 2
  && (a.duration === null || b.duration === null || Math.abs(a.duration - b.duration) <= 0.5);

/**
 * Audio in `dir` changed in the last `days` and not yet claimed by a song
 * (a version's `source`) or a class, grouped into proposed songs. A file of
 * 10 min or more is a class on its own: never offered as a song.
 * @param {{ dir: string, claimed?: Set<string>, days?: number, now?: number, duration?: (file: string) => number | null }} opts
 * @returns {InboxGroup[]}
 */
export const scanInbox = ({ dir, claimed = new Set(), days = 14, now = Date.now(), duration = audioDuration }) => {
  let names;
  try {
    names = readdirSync(dir).filter((n) => AUDIO_FILE.test(n)).sort();
  } catch {
    return [];
  }
  /** @type {InboxGroup[]} */
  const groups = [];
  for (const name of names) {
    const path = join(dir, name);
    const stat = statSync(path, { throwIfNoEntry: false });
    if (!stat?.isFile() || claimed.has(path) || now - stat.mtimeMs > days * 86_400_000) continue;
    const file = { path, name, ...parseAudioName(name), duration: duration(path) };
    if ((file.duration ?? 0) >= CLASS_SECONDS) {
      groups.push({ title: file.title, kind: 'class', files: [file] });
      continue;
    }
    const group = groups.find((g) => g.kind === 'song' && sameSong(g.files[0], file));
    if (group) group.files.push(file);
    else groups.push({ title: file.title, kind: 'song', files: [file] });
  }
  return groups;
};

/**
 * Seconds of audio, read with macOS's `afinfo`; null elsewhere or when it can't tell.
 * ponytail: macOS only; the page reads `audio.duration` itself, so other systems just lose grouping by length.
 * @param {string} file
 * @returns {number | null}
 */
export const audioDuration = (file) => {
  if (process.platform !== 'darwin') return null;
  try {
    const info = execFileSync('afinfo', [file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 });
    const m = info.match(/estimated duration:\s*([\d.]+)/);
    return m ? Math.round(Number(m[1]) * 100) / 100 : null;
  } catch {
    return null;
  }
};
