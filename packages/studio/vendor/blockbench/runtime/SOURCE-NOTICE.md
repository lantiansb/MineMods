# MineMods Blockbench runtime source notice

This directory contains an offline web build of Blockbench 5.1.6 from
`JannisX11/blockbench`, commit
`794e964e966b6783b4e9b98ecbdda5152c0620cc`. The upstream source tree and its
GPL-3.0-or-later license are retained at `../source/blockbench-5.1.6/` and
`LICENSE.MD` is retained beside this notice.

The following packaged files are built from that upstream source without
changing Blockbench's license or third-party notices:

- `dist/bundle.js`, `dist/bundle.js.map`, `css/`, `font/`, `lib/`, `assets/`,
  `favicon.png`, `icon_full.png`, `manifest.webmanifest`, and the upstream
  portions of `index.html`.
- The upstream source additions used to produce the bundle are listed here so
  the generated artifact has a reviewable source boundary:
  `js/io/codec.js` exposes the existing `Codecs` registry as
  `window.BlockbenchCodecs`; `js/boot_loader.js` skips service-worker,
  analytics and installation work for the localhost runtime;
  `js/interface/start_screen.js` skips the news request in that runtime; and
  `js/plugin_loader.ts` skips plugin-index and plugin-statistics requests.

The following are MineMods local additions or packaging adaptations, not
upstream Blockbench source:

- `minemods-bridge.js` is the packaged source of the narrow
  `minemods:blockbench:v1` parent bridge. It validates the session, nonce,
  origin and fixed command vocabulary, serializes native snapshots, queues
  commands, waits for texture readiness, rolls back failed batches, and sends
  the parent a Ctrl/Cmd-S save request. It has no arbitrary JavaScript,
  filesystem, or network command.
- `minemods-bootstrap.js` contains the local error handling, theme bootstrap,
  factory-reset helper, static loading/title-bar event listeners, and the
  Chinese (`zh`) default language preference.
- `minemods-browser-check.js` is the externalized browser readiness check. It
  runs after the formal Blockbench module has loaded and checks the stylesheet
  and `setup_successful` state before hiding the loading error UI.
- `minemods-shell.css` styles the host chrome in the graphite/copper palette,
  including the system font and UI controls only; it does not alter Minecraft
  source textures, UVs, or model materials.
- `index.html` references those local scripts and replaces the upstream inline
  startup checks and inline handlers so the host can apply its local CSP.

The bridge's native integration details are also local packaging behavior: its
camera reset uses Blockbench's native preview angle preset, preview background
rendering stays enabled for host-side updates, and document dirty/undo/redo
events are reported to the host. The host owns persistence and unload
confirmation; the embedded app's independent `beforeunload` prompt is disabled
so the parent can confirm a save before closing or navigating away.

The local files are distributed as part of the MineMods host integration. The
upstream Blockbench source, its GPL license, and all retained dependency notices
remain authoritative for the upstream portions of this runtime.
