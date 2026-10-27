// @ts-check
/** Small string helpers shared by the CLI and the resource types. */

/** Case- and accent-insensitive form for fuzzy matching. @param {string} s */
export const fold = (s) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();

/** @param {string} s */
export const escapeHtml = (s) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

/** @param {string} s */
export const slugify = (s) => fold(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'untitled';

/** Tags on projects and songs: short, no comma (a comma separates them on the command line). */
export const TAG_MAX = 40;
export const TAGS_MAX = 20;

/**
 * Trimmed, deduped case- and accent-insensitively (the first spelling stays).
 * @param {string[]} tags
 */
export const normalizeTags = (tags) => {
  const seen = new Set();
  return tags.map((t) => t.trim()).filter((t) => t && !seen.has(fold(t)) && seen.add(fold(t)));
};

/**
 * What's wrong with a list of tags, in one line, or null.
 * @param {unknown} tags
 * @returns {string | null}
 */
export const tagsProblem = (tags) => {
  if (!Array.isArray(tags) || tags.length > TAGS_MAX) return `"tags" must be a list of up to ${TAGS_MAX} tags`;
  for (const t of tags) {
    if (typeof t !== 'string' || !t.trim() || t.length > TAG_MAX || t.includes(',')) return `a tag is text of 1–${TAG_MAX} characters, with no comma`;
  }
  return null;
};
