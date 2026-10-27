// @ts-check
/**
 * Songs: what a songbook keeps, in
 * `project.resources: [{ id, type, ... }]`. The type decides the schema, the
 * page template, the `<bemtevi-*>` tags that page uses and what the page hands
 * back. Claude fills the JSON; the CLI renders every page.
 */
import { escapeHtml, fold, normalizeTags, tagsProblem } from './text.mjs';

/**
 * @typedef {'guia' | 'base' | 'original'} VersionKind
 * @typedef {{ kind: VersionKind, file: string, key: string | null, duration: number | null, source: string | null }} SongVersion
 * @typedef {{ name: string, start: number, end: number }} Section
 * @typedef {'active' | 'stored'} SongStatus
 * @typedef {import('./lyrics.mjs').LyricsCandidate} LyricsCandidate
 * @typedef {Object} Song
 * @property {string} id
 * @property {'song'} type
 * @property {string} slug fixed at creation; the page folder's name
 * @property {string} title
 * @property {string} artist
 * @property {string | null} spotify
 * @property {string | null} originalKey
 * @property {Section[]} sections
 * @property {string | null} lyrics plain text
 * @property {string | null} syncedLyrics LRC, timed to the LRCLIB record
 * @property {number | null} lrclibId
 * @property {number | null} lyricsDuration seconds, of the LRCLIB record
 * @property {LyricsCandidate[]} [lyricsCandidates] the LRCLIB tracks to choose from, the kept one included
 * @property {string | null} cifra
 * @property {string | null} notes
 * @property {SongVersion[]} versions key lives here: the teacher re-sends songs in new keys
 * @property {SongStatus} status
 * @property {string[]} [tags] the learner's own groupings ("voz", "festa"), shown as quiet labels
 * @property {string} createdAt
 */

export const VERSION_KINDS = /** @type {const} */ (['guia', 'base', 'original']);
export const SONG_STATUSES = /** @type {const} */ (['active', 'stored']);
/** The three statuses before 0.16, read as the two after. */
const OLD_STATUSES = /** @type {Record<string, SongStatus>} */ ({ working: 'active', repertoire: 'stored', retired: 'stored' });
/**
 * A status by its current or pre-0.16 name; anything else passes through for validation to refuse.
 * @param {string} status
 */
export const songStatus = (status) => OLD_STATUSES[status] ?? status;
/**
 * The project with its songs' old statuses read as new ones. The store is
 * rewritten only when something else changes the project.
 * @param {any} project
 */
export const migrateSongs = (project) => (project.resources?.some((/** @type {any} */ r) => r.type === 'song' && r.status in OLD_STATUSES)
  ? { ...project, resources: project.resources.map((/** @type {any} */ r) => (r.type === 'song' ? { ...r, status: songStatus(r.status) } : r)) }
  : project);
/** Fields `song-set` may change. Versions change through `song-version`. */
export const SONG_EDITABLE = ['title', 'artist', 'spotify', 'originalKey', 'sections', 'lyrics', 'cifra', 'notes', 'status', 'tags'];

// --- Keys and times ---

const LETTERS = /** @type {Record<string, number>} */ ({ c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 });
const SOLFEGE = /** @type {Record<string, number>} */ ({ do: 0, re: 2, mi: 4, fa: 5, sol: 7, la: 9, si: 11 });

/**
 * Pitch class of a key name: letters (Bb, F#m, A♭) or pt solfège (si bemol, fá#).
 * @param {string | null | undefined} key
 * @returns {number | null} 0–11, or null when it can't be read
 */
export const pitchClass = (key) => {
  const k = fold(key ?? '').replace(/♯/g, '#').replace(/♭/g, 'b');
  const m = k.match(/^(do|re|mi|fa|sol|la|si)\s*(sustenido|bemol|#|b)?/) ?? k.match(/^([a-g])(#|b)?(?![a-z]{2})/);
  if (!m) return null;
  const base = SOLFEGE[m[1]] ?? LETTERS[m[1]];
  const shift = m[2] === '#' || m[2] === 'sustenido' ? 1 : m[2] ? -1 : 0;
  return (base + shift + 12) % 12;
};

/**
 * Semitones from one key to another, the short way round (−6 to +5).
 * Derived at render, never stored.
 * @param {string | null} from @param {string | null} to
 */
export const semitones = (from, to) => {
  const a = pitchClass(from);
  const b = pitchClass(to);
  return a === null || b === null ? null : ((b - a + 18) % 12) - 6;
};

/**
 * Seconds from 42, "42", "0:42" or "1:05.5".
 * @param {unknown} t
 * @returns {number}
 */
export const seconds = (t) => {
  if (typeof t === 'number') return t;
  const m = String(t ?? '').trim().match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
  return m ? Number(m[1] ?? 0) * 60 + Number(m[2]) : NaN;
};

/** 62.5 → "1:02". @param {number} t */
export const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/**
 * LRC lines → [{ t, text }], in time order; metadata tags like [ar:...] dropped.
 * @param {string | null} lrc
 */
export const parseLrc = (lrc) =>
  (lrc ?? '').split('\n')
    .map((line) => line.match(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/))
    .filter((m) => m !== null)
    .map((m) => ({ t: Number(m[1]) * 60 + Number(m[2]), text: m[3].trim() }))
    .sort((a, b) => a.t - b.t);

// --- Validation ---

/** @param {unknown} v */
const blank = (v) => v === undefined || v === null || (typeof v === 'string' && !v.trim());

/**
 * Check a song, or a patch to one. Returns the first problem, in one line.
 * @param {Record<string, any>} song
 * @param {{ patch?: boolean }} [opts] a patch skips `required`
 * @returns {string | null}
 */
export const validateSong = (song, { patch = false } = {}) => {
  if (!patch) {
    for (const field of TYPES.song.required) if (blank(song[field])) return `a song needs "${field}"`;
  }
  for (const field of ['title', 'artist']) {
    if (field in song && blank(song[field])) return `"${field}" can't be empty`;
  }
  if (!blank(song.spotify) && !/^https:\/\//.test(song.spotify)) return '"spotify" must be an https link';
  if (!blank(song.originalKey) && pitchClass(song.originalKey) === null) return `can't read the key "${song.originalKey}": use Bb, F#m or si bemol`;
  if (song.status !== undefined && !SONG_STATUSES.includes(song.status)) return `"status" must be one of: ${SONG_STATUSES.join(', ')}`;
  if (song.sections !== undefined) {
    if (!Array.isArray(song.sections)) return '"sections" must be a list of { name, start, end }';
    for (const s of song.sections) {
      if (blank(s?.name)) return 'every section needs a "name"';
      const [start, end] = [seconds(s.start), seconds(s.end)];
      if (!(start >= 0) || !(end > start)) return `section "${s.name}" needs start < end, in seconds or m:ss`;
    }
  }
  if (song.tags !== undefined) {
    const problem = tagsProblem(song.tags);
    if (problem) return problem;
  }
  if (song.versions !== undefined) {
    if (!Array.isArray(song.versions)) return '"versions" must be a list of { kind, file, key }';
    for (const v of song.versions) {
      if (!VERSION_KINDS.includes(v?.kind)) return `a version's "kind" must be one of: ${VERSION_KINDS.join(', ')}`;
      if (blank(v.file)) return 'every version needs a "file"';
      if (!blank(v.key) && pitchClass(v.key) === null) return `can't read the key "${v.key}": use Bb, F#m or si bemol`;
    }
  }
  return null;
};

// --- Rendering (HTML fragments; cli.mjs wraps them in the page template) ---

const LABELS = {
  pt: {
    guia: 'Guia', base: 'Base', original: 'Original', originalKey: 'Tom original', sameKey: 'tom original',
    speed: 'Velocidade', clear: 'Sem loop', sections: 'Trechos', lyrics: 'Letra', cifra: 'Cifra', notes: 'Notas',
    offset: 'Atraso da letra', earlier: 'Letra mais cedo', later: 'Letra mais tarde', noAudio: 'Nenhum áudio ainda.', unplayable: 'Este navegador não toca este arquivo:',
    track: 'Versão da letra', synced: 'sincronizada', follow: 'Acompanhar a letra', step: '0,5 s',
    footer: 'A página toca os áudios da própria pasta: para levar ou enviar, leve a pasta inteira.',
    repertoire: 'Repertório', active: 'Ativas', stored: 'Guardadas',
  },
  fr: {
    guia: 'Guide', base: 'Accompagnement', original: 'Original', originalKey: 'Tonalité originale', sameKey: 'tonalité originale',
    speed: 'Vitesse', clear: 'Sans boucle', sections: 'Passages', lyrics: 'Paroles', cifra: 'Accords', notes: 'Notes',
    offset: 'Décalage des paroles', earlier: 'Paroles plus tôt', later: 'Paroles plus tard', noAudio: 'Pas encore d’audio.', unplayable: 'Ce navigateur ne lit pas ce fichier :',
    track: 'Version des paroles', synced: 'synchronisée', follow: 'Suivre les paroles', step: '0,5 s',
    footer: 'La page lit les fichiers audio de son propre dossier : pour la déplacer ou l’envoyer, prenez tout le dossier.',
    repertoire: 'Répertoire', active: 'En cours', stored: 'Rangées',
  },
  en: {
    guia: 'Guide', base: 'Backing', original: 'Original', originalKey: 'Original key', sameKey: 'original key',
    speed: 'Speed', clear: 'No loop', sections: 'Sections', lyrics: 'Lyrics', cifra: 'Chords', notes: 'Notes',
    offset: 'Lyrics delay', earlier: 'Lyrics earlier', later: 'Lyrics later', noAudio: 'No audio yet.', unplayable: "This browser can't play this file:",
    track: 'Lyrics version', synced: 'synced', follow: 'Follow the lyrics', step: '0.5 s',
    footer: 'The page plays the audio in its own folder: to move or send it, take the whole folder.',
    repertoire: 'Repertoire', active: 'Active', stored: 'Stored',
  },
};

/** pt, fr or en, from a BCP 47 code. @param {string | null | undefined} lang */
export const labels = (lang) => {
  const code = fold(lang ?? '');
  return code.startsWith('pt') ? LABELS.pt : code.startsWith('fr') ? LABELS.fr : LABELS.en;
};

/**
 * "Guia · Bb (−2 st)": the version's kind, its key and its distance from the original.
 * @param {SongVersion} v @param {string | null} originalKey @param {typeof LABELS.pt} L
 */
const versionLabel = (v, originalKey, L) => {
  const st = semitones(originalKey, v.key);
  const shift = st === null ? '' : st === 0 ? ` (${L.sameKey})` : ` (${st > 0 ? '+' : '−'}${Math.abs(st)} st)`;
  return `${L[v.kind]}${v.key ? ` · ${v.key}${shift}` : ''}`;
};

/**
 * Synced lyrics highlight only where their timing can be trusted: the original
 * recording, or a version within 3 s of the lyric track's length.
 * @param {SongVersion} v @param {{ duration: number | null }} track
 */
const inSync = (v, track) => v.kind === 'original'
  || (v.duration != null && track.duration != null && Math.abs(v.duration - track.duration) <= 3);

/**
 * The song's LRCLIB tracks: its candidates, or (a song fetched before there
 * were candidates) the one it kept. Pasted lyrics have none.
 * @param {Song} song
 * @returns {LyricsCandidate[]}
 */
export const lyricTracks = (song) => {
  if (song.lyricsCandidates?.length) return song.lyricsCandidates;
  if (song.lrclibId == null || !song.lyrics) return [];
  return [{ id: song.lrclibId, album: null, duration: song.lyricsDuration ?? 0, synced: Boolean(song.syncedLyrics), lyrics: song.lyrics, syncedLyrics: song.syncedLyrics }];
};

/**
 * Timed lines, each marked where the plain text starts a new stanza: LRC has
 * no blank lines, the plain lyrics do. Lines are matched in order, loosely.
 * @param {string | null} lrc @param {string | null} plain
 */
export const stanzaLines = (lrc, plain) => {
  const breaks = [];
  let blank = false;
  for (const line of (plain ?? '').split('\n')) {
    if (!line.trim()) { blank = true; continue; }
    breaks.push({ text: fold(line), gap: blank });
    blank = false;
  }
  // ponytail: in-order match with a 2-line lookahead; a track whose words differ just loses its gaps.
  let j = 0;
  return parseLrc(lrc).map((l) => {
    const i = l.text ? breaks.findIndex((br, k) => k >= j && k <= j + 2 && br.text === fold(l.text)) : -1;
    if (i < 0) return { ...l, gap: false };
    j = i + 1;
    return { ...l, gap: breaks[i].gap && i > 0 };
  });
};

/**
 * "Pétala · 3:43 · sincronizada": which album the track came with, its length, whether it's timed.
 * @param {LyricsCandidate} t @param {typeof LABELS.pt} L
 */
const trackLabel = (t, L) => [t.album, clock(t.duration), t.synced ? L.synced : ''].filter(Boolean).join(' · ');

/**
 * One track's lyrics, big: timed lines when it has them, else the plain text.
 * @param {LyricsCandidate} t @param {boolean} shown
 */
const trackHtml = (t, shown) => {
  const e = escapeHtml;
  const lines = stanzaLines(t.syncedLyrics, t.lyrics);
  const attrs = ` data-track="${t.id}"${shown ? '' : ' hidden'}`;
  return lines.length
    ? `<div class="lrc"${attrs}>\n${lines.map((l) => `<p data-t="${l.t}"${l.gap ? ' class="gap"' : ''}>${e(l.text)}</p>`).join('\n')}\n</div>`
    : `<pre${attrs}>${e(t.lyrics)}</pre>`;
};

/** @param {any[] | undefined} sections */
export const normalizeSections = (sections) =>
  (sections ?? []).map((s) => ({ name: String(s.name).trim(), start: seconds(s.start), end: seconds(s.end) }));

/**
 * A song with a checked patch applied, as `song-set` does it: an empty string clears a field; sections and tags come out
 * normalized; pasted lyrics drop the LRCLIB tracks and timing.
 * @param {Song} song @param {Record<string, any>} patch
 * @returns {Song}
 */
export const patchSong = (song, patch) => {
  const next = /** @type {Record<string, any>} */ ({ ...song });
  for (const [k, v] of Object.entries(patch)) next[k] = typeof v === 'string' ? (v.trim() || null) : v;
  if (patch.sections) next.sections = normalizeSections(patch.sections);
  if (patch.tags) next.tags = normalizeTags(patch.tags);
  if ('lyrics' in patch) Object.assign(next, { syncedLyrics: null, lrclibId: null, lyricsDuration: null, lyricsCandidates: [] });
  return /** @type {Song} */ (next);
};

/** A song's tags, as quiet plain text. @param {Song} song */
const tagLine = (song) => (song.tags?.length ? ` <span class="tags">${song.tags.map(escapeHtml).join(' · ')}</span>` : '');

/**
 * The song page body: header, the sticky `<bemtevi-player>` (its last row holds
 * the lyric controls), then the lyrics, big, beside the cifra and notes.
 * Every lyric track is in the page, so switching works offline; the one the
 * CLI kept shows first. Relative `src`: the page sits next to its audio.
 * @param {Song} song @param {string | null | undefined} lang
 */
const renderSong = (song, lang) => {
  const L = labels(lang);
  const e = escapeHtml;
  const tracks = lyricTracks(song);
  const shown = tracks.find((t) => t.id === song.lrclibId) ?? tracks[0];
  const timed = tracks.filter((t) => t.synced);
  const figures = song.versions.map((v) => {
    const sync = timed.filter((t) => inSync(v, t)).map((t) => t.id);
    return `<figure${sync.length ? ` data-sync="${sync.join(' ')}"` : ''}>\n<figcaption>${e(versionLabel(v, song.originalKey, L))}</figcaption>\n<audio controls preload="metadata" src="${e(encodeURI(v.file))}"></audio>\n</figure>`;
  });
  const sections = song.sections.map((s) =>
    `<button type="button" data-start="${s.start}" data-end="${s.end}">${e(s.name)} <span class="gloss">${clock(s.start)}–${clock(s.end)}</span></button>`);
  const picker = tracks.length > 1
    ? `<label><span class="lbl">${L.track}</span> <select class="track" data-song="${e(song.id)}" data-default="${shown.id}">\n${tracks.map((t) => `<option value="${t.id}"${t === shown ? ' selected' : ''}>${e(trackLabel(t, L))}</option>`).join('\n')}\n</select></label>`
    : '';
  const follow = timed.length
    ? [
      `<label><input class="follow" type="checkbox" checked> ${L.follow}</label>`,
      `<span class="offset"><span class="lbl">${L.offset}</span> <button type="button" class="nudge" data-step="-0.5" aria-label="${L.earlier}">−${L.step}</button> <output class="offset">0 s</output> <button type="button" class="nudge" data-step="0.5" aria-label="${L.later}">+${L.step}</button></span>`,
    ].join('\n')
    : '';
  const lyricBar = picker || follow ? `<p class="lyric-bar" hidden>\n${[picker, follow].filter(Boolean).join('\n')}\n</p>` : '';
  const player = song.versions.length
    ? [
      `<bemtevi-player data-unplayable="${e(L.unplayable)}">`,
      ...figures,
      '<p class="transport" hidden>',
      '<output class="clock">0:00.0</output>',
      `<label>${L.speed} <input class="rate" type="range" min="0.5" max="1" step="0.05" value="1"> <output class="rate">1.00×</output></label>`,
      `<button type="button" class="mark-a">A</button> <button type="button" class="mark-b">B</button> <button type="button" class="clear">${L.clear}</button> <output class="range"></output>`,
      '</p>',
      sections.length ? `<p class="sections" hidden>\n${sections.join('\n')}\n</p>` : '',
      lyricBar,
      '</bemtevi-player>',
    ].filter(Boolean).join('\n')
    : `<p class="note">${L.noAudio}</p>`;
  const lyrics = tracks.length
    ? `<section class="lyrics">\n<h2>${L.lyrics}</h2>\n${tracks.map((t) => trackHtml(t, t === shown)).join('\n')}\n</section>`
    : song.lyrics ? `<section class="lyrics">\n<h2>${L.lyrics}</h2>\n<pre>${e(song.lyrics)}</pre>\n</section>` : '';
  const aside = [
    song.cifra ? `<section class="cifra">\n<h2>${L.cifra}</h2>\n<pre>${e(song.cifra)}</pre>\n</section>` : '',
    song.notes ? `<section class="notes">\n<h2>${L.notes}</h2>\n<p>${e(song.notes).replace(/\n/g, '<br>')}</p>\n</section>` : '',
  ].filter(Boolean).join('\n');
  const originalKey = song.originalKey ? ` · ${L.originalKey}: ${e(song.originalKey)}` : '';
  return [
    `<p class="kicker"><a href="../index.html">${L.repertoire}</a></p>`,
    `<h1>${e(song.title)}</h1>`,
    `<p class="mission">${e(song.artist)}${originalKey}${song.spotify ? ` · <a href="${e(song.spotify)}">Spotify</a>` : ''}${tagLine(song)}</p>`,
    player,
    lyrics || aside ? `<div class="song">\n${[lyrics, aside && `<div class="aside">\n${aside}\n</div>`].filter(Boolean).join('\n')}\n</div>` : '',
    `<p class="ask">${L.footer}</p>`,
  ].filter(Boolean).join('\n');
};

/**
 * The project's repertoire: the active songs, then the stored ones folded
 * away, each newest first (ties by title). No dates, no counts.
 * @param {{ topic: string }} project @param {Song[]} songs @param {string | null | undefined} lang
 */
export const renderRepertoire = (project, songs, lang) => {
  const L = labels(lang);
  const e = escapeHtml;
  /** @param {SongStatus} status */
  const list = (status) => {
    const items = songs
      .filter((s) => s.status === status)
      .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '') || fold(a.title).localeCompare(fold(b.title)))
      .map((s) => `  <li><a href="${e(s.slug)}/index.html">${e(s.title)}</a> <span class="gloss">${e(s.artist)}</span>${tagLine(s)}</li>`);
    return items.length ? `<ul class="songs">\n${items.join('\n')}\n</ul>` : '';
  };
  const active = list('active');
  const stored = list('stored');
  return [
    `<p class="kicker"><a href="../../index.html">bemtevi</a> · ${e(project.topic)}</p>`,
    `<h1>${L.repertoire}</h1>`,
    active && `<h2>${L.active}</h2>\n${active}`,
    stored && `<details class="stored">\n<summary>${L.stored}</summary>\n${stored}\n</details>`,
  ].filter(Boolean).join('\n');
};

/** A project's songs. @param {any} project @returns {Song[]} */
export const songsOf = (project) => (project.resources ?? []).filter((/** @type {any} */ r) => r.type === 'song');

/**
 * The registry. `review: 'none'`: a song is a skill you keep, not a fact you
 * recall, so its page hands nothing back (lessons: quiz results → FSRS).
 */
export const TYPES = {
  song: {
    required: ['title', 'artist'],
    dir: 'songs',
    tags: ['bemtevi-player'],
    scripts: ['player.js'],
    review: 'none',
    validate: validateSong,
    render: renderSong,
  },
};
