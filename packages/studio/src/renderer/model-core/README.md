# MineMods model preview core

This directory hosts the portable model core used by MineMods' own Three.js viewport. The DOM-independent UV mapping and numeric animation interpolation have been extracted/adapted from the vendored Blockbench 5.1.6 source:

- `blockbench-uv.ts`: `CubePreviewController.updateUV`, `js/outliner/types/cube.js`, lines 1338–1414; mirror-aware UVs, rotations, box-UV seam padding, texture frame offsets.
- `blockbench-animation.ts`: `BoneAnimator.interpolate` in `js/animations/timeline_animators.js` lines 423–540 and `Keyframe.getLerp` in `js/animations/keyframe.js` lines 214–224; numeric linear and step channels with endpoint handling.

Both adaptations carry GPL-3.0-or-later notices. Host globals are explicit arguments; no DOM panels, full editor or hidden application is initialized. `../model-transform.ts` retains the GeckoLib-compatible coordinate/rotation conversion for parity with the exported game model. Import/export uses the existing validated portable `.bbmodel` codec in mod-core.

The complete Blockbench preview classes depend on global state (`Project`, `Preview`, `Animator`, codec registries and DOM panels), so those classes are not initialized here. The extracted subset does not include Molang, arbitrary meshes, plugins, all codecs, advanced painting or spline animation. Unsupported imported features continue to fail validation explicitly instead of being silently removed. This is a staged core extraction, not a claim of complete Blockbench compatibility.

The retained Blockbench source and GPL-3.0-or-later notices are authoritative for vendor code. See `packages/studio/vendor/blockbench/runtime/SOURCE-NOTICE.md` and the adjacent upstream `LICENSE.MD` for provenance and licensing.
