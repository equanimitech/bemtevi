# bemtevi

Portuguese for the great kiskadee, a songbird you hear before you see.

Practice pages for singers with a teacher, in Claude Code.

Your teacher sends a guide recording (with voice) and a backing track (without). bemtevi files both as one local page per song: switch between them at the same spot, loop a section, slow down without changing pitch, and read the lyrics large below the player, lit line by line when their timing fits the recording.

Local-first. Anti-guilt.

## Requirements

- [Claude Code](https://claude.com/claude-code).
- [Node.js](https://nodejs.org) 18 or newer. The current LTS is best.
- macOS or Linux. The hooks run in a POSIX shell. Windows is untested; WSL should work.

## Install

1. In a terminal: `claude plugin marketplace add https://github.com/equanimitech/bemtevi.git && claude plugin install bemtevi@bemtevi`
2. Or inside Claude Code: `/plugin marketplace add https://github.com/equanimitech/bemtevi.git`, then `/plugin install bemtevi@bemtevi`
3. Restart Claude Code.

## How it works

1. Download the teacher's audio in WhatsApp Web (or AirDrop it). It lands in `~/Downloads`.
2. Run `/bemtevi:song add`. bemtevi finds the new files, pairs the guide ("com voz") with the backing ("sem voz"), asks which song and key, and copies them next to the song's page. The downloads stay where they were.
3. The page opens. Loop the part you're working on, slow it down, switch to the backing and sing over it.

Everything else happens in the conversation: "the chorus starts at 0:42", "paste the chords", "this song is ready", "open Flor de Lis". A song is `active` while you're singing it and `stored` once you put it away; the repertoire shows the active ones first and folds the stored ones away, newest first. Tags show as quiet labels.

No dates, no counts, no "last sung", no reminders. A song is a skill you keep, not a fact you recall: it has a page, never a schedule.

## Command

| Command | What it does |
|---|---|
| `/bemtevi:song` | Open the repertoire |
| `/bemtevi:song add` | File new recordings from `~/Downloads` |
| `/bemtevi:song <title>` | Open that song's page |
| `/bemtevi:song <title>: <change>` | Change a song: sections, key, chords, notes, status, tags, lyrics |

## Lyrics

Lyrics come from [LRCLIB](https://lrclib.net), fetched for your own study and stored only on your machine. LRCLIB often holds several timings of one song: pick another from the player bar, nudge the delay, or turn following off. You can also paste lyrics yourself. Chords are always pasted by you; bemtevi never fetches them.

## Coming from oliba

Songs used to live in [oliba](https://github.com/equanimitech/oliba). On its first session, bemtevi copies them from `~/.oliba` into `~/.bemtevi`, with their recordings and notes. It only copies: the originals in `~/.oliba/songs` stay until you delete them.

## Data

All data lives in `~/.bemtevi/` as plain JSON and audio files. No account, no server, no sync. Each song's folder holds its page and its recordings, so a page works offline and can be sent as a folder. `~/.bemtevi/index.html` links every songbook.

Override the data directory with `BEMTEVI_DIR` for testing or custom locations.

## Privacy

bemtevi has no account, no analytics and no crash reporting. Your recordings never leave your machine.

What it keeps, all under `~/.bemtevi/`: a copy of each recording you file, each song's details (title, artist, key, sections, chords, notes, status, tags), the lyrics you fetched or pasted, and one HTML page per song plus the repertoire.

What it reads on your machine: new audio files in `~/Downloads` when you run `/bemtevi:song add` (names and lengths, to pair them; on macOS the length comes from `afinfo`), and, once, the songs in `~/.oliba` to copy them over.

This request goes out:

- **LRCLIB** ([lrclib.net](https://lrclib.net)): the song's title and artist, to search for lyrics, then the id of the lyrics you pick. It also sees bemtevi's version in the request's user agent. Nothing else about you or your recordings. Paste the lyrics yourself and bemtevi sends nothing at all.

The pages load nothing from the web: no fonts, no scripts, no trackers. They work offline.

## Using bemtevi fairly

- **Your teacher's recordings are for your practice.** Keep them, and the pages that play them, to yourself. Ask your teacher before you pass a song's folder on, even to a friend in the same class.
- **Lyrics are for your own study.** They come from a free community database, so don't publish them from your songbook.
- **Chords you paste stay yours.** If you copied a cifra from a site, it stays on your machine with the song.

## Acknowledgements

Song lyrics come from [LRCLIB](https://lrclib.net) by tranxuanthang and its contributors: a free, open lyrics database with an open API. The player is a native `<audio>` element.

## Development

No dependencies, no build step. Run the tests with:

```sh
node --test lib/*.test.mjs
```

## License

MIT. An [EquanimiTech](https://equanimi.tech) project.
