# Desktop acceptance migration

Run `bun run build` in packages/studio first. Run all `*.spec.ts` with an explicit single-worker config; the repository default config intentionally selects startup and obsidian only. A green default run is not full-suite evidence.

The standalone CJS entry points can be run with Node from the repository root. All applications use isolated data/workspaces and MINEMODS_STUDIO_TEST=1 (hidden windows). No OS keyboard/mouse input is used. `build-share.cjs` needs MINEMODS_STUDIO_JAVA_HOME (an actual Java 21 directory) and can share MINEMODS_E2E_RUNTIME. Optional developer-client initialization stays opt-in via STUDIO_E2E_PLAYTEST=1.

Current contracts:

- studio.spec.ts: part selection/synchronization, local geometry/paint/discard, dirty navigation, Ctrl-S, failed saves, compact layout, security, gameplay/model persistence after full restart.
- native-editor.cjs: delegates to studio.spec.ts and model-core-preview.cjs, retaining their assertions rather than duplicating native Three.js tests. The removed embedded Blockbench RPC, transaction bridge and direct per-face UV fields have no replacement. UV image display does not claim UV coordinate editing works.
- recipe-gestures.cjs: Chinese names through the picker, literal registry IDs, empty slots, Ctrl-S, reopen, invalid input/save blocking and compact layout. Arbitrary free-text designs remain in project-workflow.cjs; runtime recipes must resolve to real things.
- build-share.cjs: actual Gradle JAR, recipes/loot/mining tags/Chinese names/original PNG, .minemods export/import into a fresh workspace with whole-project equality. Wait for import completion, not a preview title.
- project-workflow.cjs: qualifies an explicit legacy conception, opens it through the advanced compatibility entry, retains design recipe/behavior persistence and the actual native model canvas.
- packaged.spec.ts: migrated release entry points; still requires a freshly produced packaged executable and explicit STUDIO_E2E_PACKAGED=1. Development Electron passes do not establish app.asar identity, relocatability, exported source completeness or packaged playtest cancellation.

The protocol/structured fixtures implement the current save-sheet, glance, formal look, self-review and review stages. They do not establish that an independent AI review happened. Keep separate real independent-review evidence for an end-to-end AI experiment. Positive texture/model fixtures meet existing checks; low-quality negative cases still fail. No product quality rule was relaxed.

Round22 measured results: 21 full-suite passes and one packaged skip; standalone native-editor/recipe-gestures/build-share also executed separately. Full logs and fixture inputs are in the handoff report. Provider-key entry points were not executed. These six old file names all retain live contracts and must not be deleted wholesale.
