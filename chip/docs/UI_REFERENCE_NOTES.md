# UI reference notes (studio refresh, 2026-10-21)

One short discovery pass over the five suggested repositories, by targeted reads of specific files at a pinned
revision through the GitHub API. Nothing was cloned, installed or executed. All items below are
**independently implemented inspiration** unless marked *adapted code*. No code, assets, branding, keys or
telemetry were copied.

| Repository @ revision | Licence | Files examined | Useful pattern | Decision | Why |
|---|---|---|---|---|---|
| OpenLegged/URDF-Studio @ `23b96e2f3d5b` | Apache-2.0 | `src/app/hooks/useSelectionActiveComponentSync.ts`; feature directory listing (`robot-tree`, `property-editor`, `urdf-viewer`); `src/features/property-editor/components/InlineDimensionInputRow.tsx` (name only) | One canonical selection store that other stores subscribe to, so tree, viewport and inspector never disagree; property editor with per-field provenance | **Adopted (inspiration):** `useScene.selectedId` stays the single selection; the tree, 3D picking, breadcrumb and inspector all read it. The Size & Scale panel shows per-dimension provenance | Our tree/viewport/inspector already shared one id; the pattern confirmed we should route lessons and the breadcrumb through it too, not through local state |
| tscircuit/3d-viewer @ `bd6e37735890` | MIT | `src/contexts/SchematicNavigationContext.tsx`, `src/utils/pick-schematic-component.ts`, `src/utils/camera-session-storage.ts`, `src/reference-objects/fit-camera-to-bounds.ts` | (a) `onViewSchematicComponent`: pick in 3D → navigate to the same component in the schematic, by walking `userData` ids up the parent chain and never picking through occluders; (b) camera session memory keyed by scope; (c) fit-to-bounds using the limiting FOV | **Adopted (inspiration):** "Open in circuit" action from any RTL block keeps one component id across 3D, block diagram and gate view; camera pose per level is remembered so Back does not lose the view; Fit uses the existing bounds framing | Same identity across views is exactly the confusion the founder reported; the camera memory fixes "Back loses my camera" |
| kovacsv/Online3DViewer @ `d025663dcdd1` | MIT | `source/engine/viewer/navigation.js` (mouse/touch interaction), `source/website/sidebardetailspanel.js`, `source/website/toolbar.js` (name) | Details panel that lists size with an explicit **unit**, and says "Unknown" when the model has none; small toolbar with Fit/Up-vector/orientation controls | **Adopted (inspiration):** Size & Scale panel states units and provenance (KNOWN / TARGET / ILLUSTRATIVE / UNKNOWN) and disables measurements where scale is unestablished; orientation widget + Top/Front/Iso views | Honest units are the whole point of the scale panel; the orientation widget is the quickest recovery from a lost camera |
| sharpie7/circuitjs1 @ `dd47cf43a1ba` | GPL-2.0 | `README.md` only | Teaching principle: change one control, watch one scope trace react immediately | **Adopted as a principle only.** Nothing viewed beyond the README; no code copied, embedded or bundled (GPL) | Our lessons bind one existing control (threshold, noise, mode) to one visible plot or 3D consequence |
| wokwi/wokwi-elements @ `72d8b5b1f472` | MIT | `README.md`, `LICENSE`, element list | Approachable part presentation: each element is just a presentation, with the simulator kept separate | **Rejected as a dependency.** Our parts are procedural Three.js meshes, not SVG web components; adding the package would bring an unused runtime | Borrowed only the clarity: one part, one plain name, status shown separately from appearance |

## What was copied vs. independently implemented
- **Copied/adapted code:** none.
- **Independently implemented from the patterns above:** camera memory per level, standard views and an
  orientation widget, pick-to-schematic navigation by component id, the provenance-tagged size panel, the
  one-control-one-consequence lessons.

## Attribution
No notices are required because no code or assets were reused. The repositories are credited here as design
references.
