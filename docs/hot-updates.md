# Git feature updates

The installed host and the script features have different lifetimes. The host is updated with the installer.
Features are loaded into QuickJS workers and switch without restarting the host. The identity is the full Git
commit hash, not an extra semantic version. The API number describes a host contract, not a release version.

## Publishing

1. Install a build with this host on every machine once.
2. Change scripts and definitions under `src/features/`. User-facing text belongs in `src/shared/i18n.ts` in both languages.
3. Run `npm run typecheck`, `npm run test:helper` and `npm test`.
4. Commit and push to the configured `origin/main`. Do not bump `package.json` just for a feature update.
5. Wait for the Hot Features workflow to finish. Enable Actions and allow release writes in the public repository.
6. Run a clean build at that commit or accept that commit's feature update. Join the room and click Push latest commit.
7. Other members explicitly accept or decline. A recipient verifies ancestry and artifacts independently.

`node tools/hot-publish.mjs` checks a clean checkout, repository identity and pushed head, then builds into
`out/hot-release`. Only the workflow uploads them. It creates `hot-<40 hex commit>` prereleases with
`lolPing-hot-update.json` and `lolPing-features.json`. It never touches the installer workflow or latest feed.
No Git credentials, source files or peer-provided download addresses enter room messages.

The host fingerprint is generated from Git-normalized host files at build time. Feature scripts, media and catalog
definitions are excluded. i18n is compiled into the catalog for feature labels and text; static host UI text remains
the installed build's text. Host code, dependencies, native helpers and bundled assets must match, otherwise an
installer update is required. Put new feature media in the feature bundle, not in host assets.

Build identity is captured at startup, not updated when Git changes underneath a running app. After committing and
pushing development changes, restart `npm run dev` from the clean checkout before publishing. electron-vite's
timestamped `electron.vite.config.<timestamp>.mjs` loader file is ignored so it cannot falsely mark that build dirty;
real source changes and other untracked files still block publication.

## Script contract

The catalog has a manifest for each script named `src/features/<id>.js`. Modules have stable IDs, bilingual
names, settings, text and actions, and explicit capabilities: `timers`, `storage`, `overlay`, `audio`, `room.receive`
`room.send` and `games`. New schema fields default through `moduleValues`. No module release number is needed.
Optional media lives in `src/features/assets/<id>/` as PNG, JPG, WebP, WAV or OGG and is bundled by filename.

Each script defines `globalThis.feature.handle(input)` and returns `{commands, state}` synchronously.
Input has `event`, `data`, `context` and the previous `state`. Context supplies `now`, `lang`, normalized
`settings`, `paused`, `busy`, `room` and bilingual `texts`. Never use an ambient clock for scheduling.
Events are `activate`, `tick` (once a second), `settings`, `action` and `room.message`. `activate` receives
old state and can migrate it. Keep migrations tolerant of several skipped commits. Promise jobs are not run;
use ticks and state for delayed work instead of host timers or async functions.

Commands:

- `show {scene}`: an all-display or primary-display scene with safe text, images and bars. `fullscreen`
  fills the viewport; other layouts use normalized position and width. Text uses `textContent`, never HTML.
- `clear {key}`: remove this module's scene.
- `sound {asset, volume}`: host-controlled audio on the primary display; global mute and volume still apply.
- `publish {topic, data}`: bounded JSON through the encrypted room. Only matching Git commits receive it;
  room pause, mute and rate limits still apply. The message also includes module, topic and peer.

The builtin image is `builtin:hydration`; the builtin sound is `builtin:Base`. The manifest does not grant
Node, Electron, DOM, filesystem, arbitrary IPC, networking or input-hook access. Media has explicit names,
MIME types and bounded base64 data; the host validates magic bytes and image dimensions.
Media is registered locally by content digest and served through `lolping://modules`, only for active modules.
Overlay messages carry short URLs, not repeated image/audio bytes. This protocol never serves scripts or paths on disk.

## Activation and recovery

Downloads come from locally constructed GitHub addresses. The receiver verifies main's head, its matching
lightweight tag, completed assets, exact bytes and SHA-256. Git compare must report strictly ahead with the
current commit as merge base. Equal, older, diverged or unknown histories are refused. Invitations can skip
any number of commits. A newly changed remote head requires a new invitation rather than silently substituting it.
The receiver also checks the release's host hash against the commit's Git tree and each script/media blob against
its Git blob ID. Artifacts cannot substitute executable source while keeping the same commit label.

All modules stage in new workers first, carrying normalized settings and old bounded state. Activation emits
no visible commands. The active snapshot and previous snapshot are atomically written before the whole runtime
switches. Old workers are terminated and old scenes cleared. Room transports, native helper and windows remain.
Each worker has a 16 MiB QuickJS heap, a 256 KiB stack, a 30 ms execution budget and a host watchdog. State is
limited to 16 KiB; scripts, media, scenes and the module count are also capped. Invalid commands fail the module.

Failed staging leaves the old runtime intact. Later runtime failures request restoration of the previous
snapshot. Startup restores the previous snapshot if the saved active scripts cannot initialize; otherwise
it falls back to bundled scripts. Manual Roll back restores the previous commit and its settings/state.
Snapshots are local and restore offline. Installing a different base commit starts its bundled feature set
with normalized saved module settings and state; the old scripts do not override a new installer.
Timers start a full interval on activation.
Module state is checkpointed every 30 ticks and on settings, update and orderly shutdown.
Host commands share a room-independent safety budget: 12 commands/s, burst 24 across all modules;
each module gets 4 overlay commands/s (burst 8), 1 sound/s (burst 2) and 1 room publish/s (burst 2).
Excess outputs are dropped, not queued. Progress events do not trigger room presence announcements.
These checks do not authenticate room peer names: the existing shared room key still permits forged identities.
Trust is in the configured Git repository and the recipient's verification, not the person sending the notice.

## Game scripts

`src/features/catalog.ts` includes the `arcade` and `tabletop` modules. Their optional `games` arrays define up to 12 games per module.
Each game has a stable `id`, bilingual `name` and `description`, a local `cover`, an `accent` token and one to eight
`stages`. Stages have stable IDs, bilingual names and metric units (`ms`, `cps`, `level`, `points`). Covers use bundled
module image filenames or the host's named builtin ping assets. User-facing text still belongs in `i18n.ts` and enters
the bundle through manifest `texts`. No additional game release number is maintained.

The catalog includes Talent circuit and four local room games. Legacy `web` descriptors remain readable, restricted
to the existing sandboxed Foony PaintJob host, but are not included in the current catalog. Local games never load
downloaded browser bundles or contact Foony. Their rules and media are part of the Git-verified bundle.

Modules declaring `games` also implement `feature.game({event, data, context, state})`. The game worker is separate
from the module's passive reminder worker. Each stage starts with fresh transient state and receives:

- `start`: `data` contains `game`, `stage`, the shared room `seed` and renderer-local `now`.
- `shown`: the frame has been rendered; start its local clock using `data.now`. Return the same view, with updated
  state and a wake-up delay. The host does not repaint in response to this acknowledgement.
- `input`: `data.control` identifies an enabled button, tile, target or declared background action, with `data.now`.
- `timer`: one scheduled wake-up for the current displayed revision, with `data.now`.

Return `{state, view, wakeAfter, result?}` synchronously. `state` is bounded to 16 KiB and is never persisted.
`wakeAfter` is null or 16–60000 milliseconds. Return a complete view after an input or timer; the host clears the old
timer, renders the revision and sends `shown`. Counter/text-only revisions keep their displayed controls and clock;
they update in place without another acknowledgement, so rapid clicks do not wait for repaint. Only schedule from
`shown` when a delay must follow an actual visible
frame. Scripts cannot call host timers, load URLs, execute renderer code or access files.

`view` has `layout` (`stack`, `pad`, `arena`, `grid`), `tone` (`neutral`, `accent`, `danger`, `success`), `columns`
(1–8), optional `backgroundAction` and 1–64 nodes. Every node has a unique stable `id` and a `type`: `text`, `button`,
`target`, `tile`, `image` or `bar`. Optional fields are bounded `text`, `tone`, `disabled`, normalized target `x`/`y`,
bar `value` (0–1) or a declared image `asset`. There is no HTML, CSS, arbitrary URL or event-handler field. Unknown
attributes are discarded. Target centers stay within safe board margins; component dimensions belong to the host.
Button labels are also accessible names. Interactive game input is pointer-based in this host.

`result`, when present after an input or timer, is `{test, score, metric, accuracy}`. `test` must match the active stage,
score is 0–100, metric is 0–60000 and accuracy is 0–1. Main accepts the first result per player/stage. Ranking uses
the mean of completed stage scores and excludes incomplete matches. These self-reported scores are not anti-cheat.

To add a compatible game: add its descriptor and translations, implement its stage logic in the module script, and
test its views and results. Push the Git commit and wait for Hot Features, then offer the update through the room.
Receivers explicitly accept as usual. The catalog refreshes in the existing window. Invitations include the exact
module payload digest, so different script/config generations cannot join one match. An unfinished affected match
is cancelled on update, rollback or disable instead of mixing rules; completed results keep their original metadata.
Activation smoke-checks every stage. Later game worker failures disable that pack and request the existing rollback.

For shared games, a descriptor adds `session: 'grid' | 'draw'` and implements
`feature.session({event, data, context, state})`. `start` supplies game ID, pinned seed, ordered peers, host, local self
and a zero initial time. Only the organizer creates clock events; all accepted action events carry authoritative
sequence, actor, request ID and time. Return `{state, view, accepted}`. State is at most 128 KiB and remains transient.
Views are rebuilt from a bounded grid/drawing schema: cells, legal source squares, status, moves, choices, word/hint,
deadline, at most 400 short strokes, 24 messages and eight scores. The renderer sees this view, not raw script state.
Actions are fixed move, stroke, guess, word choice, clear, undo, resign, next and rematch commands. Clock and departure
commands are main-only. Each action carries the current round; moves also carry the current ply. Scripts reject invalid
actors and stale actions. Peers retry requests and replay missing ordered events; no huge snapshots are sent.

`tabletop.source.js` imports exactly pinned chess.js, connect-four and tic-tac-toe-minimax rule code. Run
`npm run build:games` after editing it and commit both the source and generated `tabletop.js`. The generated file is
the exact Git blob checked by the existing publisher/download verifier. Tests rebuild and compare it byte-for-byte.
Its word list and localized strings come from `i18n.ts`; Chinese drawing words stay the same for English and Chinese
clients. Activation smoke-checks session starts as well as local stages. Rule, word-list, media and compatible view-data
changes then hot-update without restart. Affected active matches end before the new generation starts.

The first grid/canvas/session-capable host requires an installer update on every participant. New surface components,
arbitrary React pages, keyboard hooks, permissions or privileged APIs are still installer-level changes. Arbitrary
interfaces cannot be added just by downloading JS. Session replay is for casual rooms, not anti-cheat: the shared key
and deterministic word selection do not hide answers from modified clients. The organizer leaving ends the match.

After `npm run build`, run `npx electron tools/verify-games.mjs` for an isolated Electron run through the talent circuit
and all five catalog entries at three sizes, using the real game manager, preload and QuickJS workers. It checks
visible canvas pixels, plays board moves and completes talent results. It uses a virtual renderer clock and no
external room, settings or input hooks. Reports and screenshots go into ignored `out/verification/`. This does not
replace a manual real-app focus/input check or a two-machine LAN/relay check.

`npx electron tools/verify-web-game.mjs` is an optional legacy live-network check of the sandboxed Foony window. It
uses a separate test profile, opens the Chinese game homepage without joining a room, checks that application bridges
are absent, and writes its screenshot and page report under `out/verification`. It does not play a multiplayer round.
