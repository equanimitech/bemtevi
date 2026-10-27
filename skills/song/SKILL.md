---
name: song
description: File the songs a learner practises (the teacher's guide and backing recordings, key, lyrics, sections, cifra, notes) as one local page per song with a player that loops a section, slows down without changing pitch and switches guide/backing at the same spot. Use when the user runs /bemtevi:song or /song, says "add the teacher's audio", "file this song", "new song from class", "open Flor de Lis", "show my repertoire", "the chorus starts at 0:42", "this song is ready", "paste the chords", or has downloaded song recordings from WhatsApp.
---

# /bemtevi:song: the teacher's recordings, one page per song

A song is a skill the learner keeps, not a fact to recall: it has a page, never a schedule. You fill JSON; the CLI copies the audio, fetches the lyrics and renders every page. You never write song HTML.

If `node` is not found, tell the user in one line to install the Node.js LTS from nodejs.org, then restart Claude Code, and stop.

Speak the songbook's `language` throughout.

## Parse input

`$ARGUMENTS` is one of:
- empty → open the repertoire
- `add` → **Add from Downloads**
- `<title>` → open that song's page
- `<title>: <change>` → **Change a song** ("Flor de Lis: refrão 0:42–1:05", "Aquarela: pronta", "Wave: cifra")

Titles are case- and accent-insensitive substring matches against `songs`:

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/cli.mjs" songs
```

It prints `{ songs: [{ id, projectId, title, artist, status, file }], index }`. Several matches: ask which with one `AskUserQuestion`. None: say so in one line and offer `/bemtevi:song add`.

## Open

- Repertoire: `node "${CLAUDE_PLUGIN_ROOT}/lib/cli.mjs" songs --open`
- One song: `node "${CLAUDE_PLUGIN_ROOT}/lib/cli.mjs" song-get <songId> --open`

Reply with the path in one line. Nothing else.

## Which songbook

Songs live in a songbook (the CLI calls it a project). If `songs` lists any, use that `projectId`. Otherwise run `project-list`: one songbook, use it; several, ask once with `AskUserQuestion`; none, ask once what to call it and which language the pages speak, then:

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/cli.mjs" project-create --topic "<name>" --language <pt-BR|fr|en>
```

Songs filed in oliba before its 0.20 are copied into bemtevi at session start (`migrate` does it on demand); the originals stay in `~/.oliba/songs`.

## Add from Downloads

The teacher sends audio files over WhatsApp. The learner downloads them in WhatsApp Web or Desktop on the Mac (or AirDrops them from the phone); they land in `~/Downloads`.

1. List what's new:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/lib/cli.mjs" inbox
   ```

   It prints `{ dir, groups: [{ title, kind, files: [{ path, name, title, role, duration }] }] }`: audio from the last 14 days (`--days N` for more) that no song has claimed yet. Files whose names match loosely and whose lengths match are one group; `role` is `guia` ("com voz", "guia", "with vocals"), `base` ("sem voz", "instrumental", "playback", "karaoke", "no vocals") or `null`.

   A group with `kind: "class"` is a recording of 10 minutes or more: never propose it as a song. Say in one line, in `language`, that <name> looks like a class recording, and leave it.

   No `kind: "song"` groups: "Nothing new in Downloads. Download the teacher's audio in WhatsApp Web, then `/bemtevi:song add` again." and stop.

2. For each group, **one** `AskUserQuestion` call, with only the questions you need:
   - "Which song is this?" Options: "New: <Title> · <Artist>" (the title cleaned up, "flor de liz" → "Flor de Lis"; the artist only if you're sure), then any existing song whose title is close ("Add to <title>"), then "Skip".
   - "Which key?" Options: "Don't know yet", plus a key the learner already named in this conversation. Keys read as letters or solfège: `Bb`, `F#m`, `si bemol`.
   - For each file with `role: null` only: "Is <name> the guide (with voice) or the backing?" Options: "Guia", "Base", "Original recording".

   A group the learner says is two songs: ask again per file.

3. File it. New song: write the JSON to a temp file and pipe it in.

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/lib/cli.mjs" song-add <projectId> < song.json
   ```

   ```json
   {
     "title": "Flor de Lis",
     "artist": "Djavan",
     "versions": [
       { "kind": "guia", "file": "/Users/you/Downloads/flor de liz - com voz.mpeg", "key": "Bb" },
       { "kind": "base", "file": "/Users/you/Downloads/flor de lis - sem voz.mpeg", "key": "Bb" }
     ]
   }
   ```

   Also accepted, only when the learner said them: `originalKey`, `spotify` (an https link), `sections: [{ "name", "start", "end" }]` (seconds or `m:ss`), `notes`, `cifra`, `lyrics`, `status`. Never invent a key, a section or a link.

   Existing song, one call per file:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/lib/cli.mjs" song-version <songId> --kind guia|base|original --file "<path>" [--key Bb]
   ```

   The CLI copies each file next to the song's page; the download stays in `~/Downloads` and is no longer listed by `inbox`. `song-add` opens the page and fetches the lyrics from LRCLIB.

4. Reply in one line per song: the page path. If the output has a `note` (no lyrics found, or LRCLIB unreachable), add it in one line, in `language`. A failure (`song-add: a song needs "artist"`, `no audio file at …`): say what it reports and ask for the missing piece.

## Change a song

Get the song first (`song-get <songId>`), then one call:

| The learner says | Run |
|---|---|
| "o refrão é de 0:42 a 1:05" | `song-set <songId> < patch.json` with every section, old and new: `{ "sections": [{ "name": "Refrão", "start": "0:42", "end": "1:05" }] }` |
| "X tá ativa", "voltei a cantar X" | `song-set <songId> --status active` |
| "X tá guardada", "guarda essa", "não vou cantar mais" | `song-set <songId> --status stored` |
| "marca X como samba" | `song-set <songId> --tags "<its tags from song-get>,samba"`: the full list, old and new |
| "tira a tag Y" | `song-set <songId> --tags "<its tags without Y>"` (an empty value clears them all) |
| pastes a cifra | `song-set <songId> --cifra "<exactly what they pasted>"` |
| a note from class | `song-set <songId> --notes "<their words>"` |
| "o tom original é C" | `song-set <songId> --original-key C` |
| "a guia está em A" | `song-version <songId> --file guia.m4a --key A` (the version's `file` from `song-get`) |
| "veio uma guia nova em outro tom" | **Add from Downloads**, then add it to this song with `song-version` |
| "busca a letra de novo" | `song-lyrics <songId>` |
| "a letra está errada", "está fora de sincronia" | `song-lyrics <songId> --list` (LRCLIB tracks: album, length, synced; `kept` is the one shown), ask which with one `AskUserQuestion` (album · m:ss), then `song-lyrics <songId> --pick <id>`. The page also has the picker, the "acompanhar a letra" toggle and a ±0,5 s delay in its player bar: say so when it's only the timing |
| pastes lyrics | `song-set <songId> --lyrics "<what they pasted>"` (replaces fetched lyrics) |

A song is `active` (being sung now; the repertoire shows these first, as "Ativas") or `stored` (put away, folded under "Guardadas"); a new song is active. Tags show as quiet labels. The pages are for reading and practice only: every change goes through you, here.

Sections are typed to you: the page shows a clock so the learner can say where a part starts. Reply in one line: what changed, and the page path.

## Rules (hard constraints)

- JSON only. Never write or edit the HTML; the CLI renders it.
- Never move, rename or delete the learner's downloads.
- Lyrics come only from LRCLIB, through the CLI, for the learner's own study. Never fetch lyrics or chords from Letras, Cifra Club or any other site; a cifra is pasted by the learner.
- Never drive WhatsApp. The learner downloads the files.
- Anti-guilt: no counts of songs, no dates, no "last sung", no practice reminders, no streaks. A song never becomes a due card.
