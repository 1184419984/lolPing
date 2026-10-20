# Tabletop Media Provenance

The maintainer reports permission for personal use of the Foony media below. This is not a grant of redistribution
rights and does not relicense the media under lolPing's MIT license. Review the actual authorization before publishing
an installer or Hot Features bundle containing these assets. No commit or remote publication is performed by import.

The files were copied byte-for-byte from the ignored authorized snapshot
`vendor/foony/snapshots/2026-10-16T06-27-28-133Z/site/img/games/`. They are used only as local catalog icons.

| Local File | Original Path On foony.com | SHA-256 |
| --- | --- | --- |
| `src/features/assets/tabletop/paintjob.webp` | `/img/games/paintjob/icon.webp` | `a6d8700ef0ec3095131d8999b0c40b3b6a269e925b922cd84efbbdd6e0a5a649` |
| `src/features/assets/tabletop/tictactoe.webp` | `/img/games/tic-tac-toe/icon.webp` | `bec6be93e9a4c059f3f25bcafe766895e2cb39e9b07a8586dec03a39306c784f` |
| `src/features/assets/tabletop/connectfour.webp` | `/img/games/4-in-a-row-connect/icon.webp` | `de390b212b49993d8dd39455f6cd3e79eb1df4b0245c8033012e0b4c40ab9dc6` |
| `src/features/assets/tabletop/chess.webp` | `/img/games/chess/icon.webp` | `7a1a78c22b1b5c59ee067ad9a5ec685123c56baeb1353e16eaf3249aad481b7f` |

The local rule scripts and renderer are separate implementations, not Foony's original source project or backend.
The generated `tabletop.js` includes chess.js (BSD-2-Clause), connect-four (MIT), tic-tac-toe-minimax (ISC), and the
browser events shim (MIT). Copyright/license notices emitted by their bundles must remain intact. Full dependency
license texts are recorded in `tabletop-licenses.txt`; `build:games` embeds them into its generated output.
