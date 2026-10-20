# Authorized Foony Import

The maintainer reports permission to use Foony source and media for this local project. The importer records that
statement; it does not infer permission to redistribute the snapshot under lolPing's MIT license. The bulk snapshot
stays in ignored `vendor/foony/`. Four catalog icons were copied to the local feature assets; their hashes and separate
rights status are listed in [tabletop-assets.md](tabletop-assets.md). Check redistribution authorization before publishing.

Run `node tools/foony-import.mjs` to capture public client distribution files referenced by the Chinese PaintJob,
Tic-Tac-Toe, Four In A Row and Chess pages. The tool uses HTTP GET without credentials. It does not join rooms,
create accounts, call game APIs, guess source-map addresses, evaluate downloaded scripts or bypass access controls.
Referenced third-party origins are listed, never fetched. Shared site modules can include references to other games.

Each run creates `vendor/foony/snapshots/<UTC timestamp>/site/` and a `manifest.json` with source URLs, SHA-256 hashes,
byte sizes, MIME types, capture times, skipped requests, external references and unresolved dynamic paths. Limits
are 800 files, 256 MiB total and 16 MiB per file. HTTP errors and redirects are recorded rather than bypassed. A limit
or an unresolved reference means the snapshot is incomplete. Static discovery cannot reconstruct assets whose paths
are assembled at runtime, server state, game sessions, word services or database records.

`node tools/foony-import.mjs --resume <snapshot-name>` reuses verified local bytes and follows newly discovered
references, with a 1200-file cap. Resume checks the stored hash before accepting a cached file. It does not execute
or translate the application. Stop and inspect the manifest before expanding the capture scope further.

Public JavaScript is a compiled browser distribution, not the original source project. A captured homepage is not a
working offline game. `originalSourceAvailable` and `offlineReady` remain false deliberately. Readable original
source, server logic, build configuration, asset licenses and any private dependencies must come from the authorized
source package or repository. No claim is made that this importer can retrieve unpublished files.

The current catalog now replaces the website entry with local Draw and guess, Tic-tac-toe, Four in a row and Chess.
Their renderer and isolated rule scripts are local implementations; the original Foony source project and backend
have not been imported. The four copied icons are the only imported snapshot media used by these games. The snapshot's
`offlineReady: false` still describes the captured website, not these separate local games. The local session host
implements consent, bounded strokes, ordered moves, explicit rematches and loss repair through lolPing rooms.

For a future full authorized original-source migration:

1. Import the authorized original project and its license notices separately, without credentials or production data.
2. Identify each game's rules, renderer, media and server dependencies using the captured references.
3. Replace Foony auth, room discovery, game transport and result persistence with lolPing's consent-based room APIs.
4. Keep drawing streams, secret words, board turns and reconnect state bounded and validate them in main.
5. Run deterministic multi-peer tests, offline checks and Windows/macOS window/input checks before enabling entries.

Do not add remote browser bundles to a privileged preload, run them in the main process, or disable Electron
sandboxing to make the snapshot run. The existing QuickJS contract does not provide Foony's DOM, canvas, networking
or service backend. More host interfaces and per-game transport work are required for a local implementation.

The importer itself is tested in `tests/tools/foony-import.test.ts` with fake responses. Tests verify scope restrictions,
HTML/JavaScript parsing, integrity records, cache reuse, size bounds and refusal to follow redirects. No real network
is used by those tests.
