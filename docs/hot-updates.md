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

## Script contract

The catalog has a manifest for each script named `src/features/<id>.js`. Modules have stable IDs, bilingual
names, settings, text and actions, and explicit capabilities: `timers`, `storage`, `overlay`, `audio`, `room.receive`
and `room.send`. New schema fields default through `moduleValues`. No module release number is needed.
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
