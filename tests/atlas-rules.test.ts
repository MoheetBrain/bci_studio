// Display / picking rules (src/atlas/visibility.ts): hidden things are never picked, see-through things never steal a
// pick, the cut plane limits picks to the kept side, and the display transform is an exact, invertible rotation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayToRasMm, effective, keptByClip, rasMmToDisplay, resolvePick, FADED_OPACITY, PICK_OPACITY_THRESHOLD, type DisplayState } from '../src/atlas/visibility.ts';

const base = (): DisplayState => ({
  hemi: { left: true, right: true, midline: true },
  tissueOn: { cortex: true, sulcus: true, 'white-matter': true, cerebellum: true, brainstem: true, diencephalon: true, 'basal-nuclei': true, 'medial-temporal': true, commissure: true, ventricle: true },
  vis: {}, cortexOpacity: 1, selected: new Set(),
});
const gyrus = { id: 'left_precentral_gyrus', hemisphere: 'left', tissue: 'cortex' } as const;
const thal = { id: 'left_thalamic_nucleus', hemisphere: 'left', tissue: 'diencephalon' } as const;

test('default: everything visible, opaque and pickable', () => {
  assert.deepEqual(effective(gyrus, base()), { visible: true, opacity: 1, pickable: true });
});

test('hidden structure is neither drawn nor pickable', () => {
  const d = base(); d.vis[gyrus.id] = 'hidden';
  assert.deepEqual(effective(gyrus, d), { visible: false, opacity: 0, pickable: false });
});

test('hemisphere toggle hides only that side', () => {
  const d = base(); d.hemi.left = false;
  assert.equal(effective(gyrus, d).visible, false);
  assert.equal(effective({ id: 'r', hemisphere: 'right', tissue: 'cortex' }, d).visible, true);
  assert.equal(effective({ id: 'm', hemisphere: 'midline', tissue: 'commissure' }, d).visible, true);
});

test('layer toggle hides the tissue class', () => {
  const d = base(); d.tissueOn.cortex = false;
  assert.equal(effective(gyrus, d).visible, false);
  assert.equal(effective(thal, d).visible, true);
});

test('faded context is drawn but never pickable', () => {
  const d = base(); d.vis[gyrus.id] = 'faded';
  const e = effective(gyrus, d);
  assert.equal(e.visible, true);
  assert.equal(e.opacity, FADED_OPACITY);
  assert.equal(e.pickable, false);
});

test('transparent cortex lets the pointer through; deep structures stay opaque', () => {
  const d = base(); d.cortexOpacity = 0.3;
  assert.equal(effective(gyrus, d).pickable, false);
  assert.equal(effective(gyrus, d).opacity, 0.3);
  assert.deepEqual(effective(thal, d), { visible: true, opacity: 1, pickable: true });
  d.cortexOpacity = PICK_OPACITY_THRESHOLD;
  assert.equal(effective(gyrus, d).pickable, true);
});

test('the selected structure stays opaque and pickable under a transparent cortex', () => {
  const d = base(); d.cortexOpacity = 0.1; d.selected = new Set([gyrus.id]);
  assert.deepEqual(effective(gyrus, d), { visible: true, opacity: 1, pickable: true });
});

test('fully transparent cortex is not drawn at all', () => {
  const d = base(); d.cortexOpacity = 0;
  assert.equal(effective(gyrus, d).visible, false);
});

test('non-finite opacity falls back to opaque', () => {
  const d = base(); d.cortexOpacity = Number.NaN;
  assert.equal(effective(gyrus, d).opacity, 1);
});

test('resolvePick returns the nearest hit (never something behind an opaque surface)', () => {
  const hits = [
    { id: 'behind', distance: 0.5, pointRasMm: [0, 0, 0] as const },
    { id: 'front', distance: 0.2, pointRasMm: [0, 0, 0] as const },
  ];
  assert.equal(resolvePick(hits, { axis: 'none', posMm: 0, keep: '-' })?.id, 'front');
  assert.equal(resolvePick([], { axis: 'none', posMm: 0, keep: '-' }), null);
});

test('cut plane: a hit on the removed side is skipped, the next kept hit wins', () => {
  // Sagittal cut at R = 0 keeping the left (−) side: the nearest hit lies on the removed right side.
  const hits = [
    { id: 'removed', distance: 0.1, pointRasMm: [12, 0, 0] as const },
    { id: 'kept', distance: 0.3, pointRasMm: [-8, 0, 0] as const },
  ];
  assert.equal(resolvePick(hits, { axis: 'x', posMm: 0, keep: '-' })?.id, 'kept');
  assert.equal(resolvePick(hits, { axis: 'x', posMm: 0, keep: '+' })?.id, 'removed');
  assert.equal(keptByClip([0, 30, 0], { axis: 'y', posMm: 10, keep: '+' }), true);
  assert.equal(keptByClip([0, 30, 0], { axis: 'y', posMm: 10, keep: '-' }), false);
  assert.equal(keptByClip([0, 0, -5], { axis: 'z', posMm: 0, keep: '-' }), true);
});

test('display transform: RAS mm → three.js metres is a proper rotation and inverts exactly', () => {
  // Right → +x, Superior → +y, Anterior → −z.
  assert.deepEqual(rasMmToDisplay([1000, 0, 0]).map((v) => v + 0), [1, 0, 0]);
  assert.deepEqual(rasMmToDisplay([0, 0, 1000]).map((v) => v + 0), [0, 1, 0]);
  assert.deepEqual(rasMmToDisplay([0, 1000, 0]).map((v) => v + 0), [0, 0, -1]);
  const p = [-34.66, -6.62, 34.52] as const;
  const back = displayToRasMm(rasMmToDisplay(p));
  for (let k = 0; k < 3; k++) assert.ok(Math.abs(back[k] - p[k]) < 1e-9);
  // Handedness preserved: x × y = z in both frames (R × A = S  ⇒  display(R) × display(A) = display(S)).
  const [r, a, s] = [rasMmToDisplay([1, 0, 0]), rasMmToDisplay([0, 1, 0]), rasMmToDisplay([0, 0, 1])];
  const cross = [r[1] * a[2] - r[2] * a[1], r[2] * a[0] - r[0] * a[2], r[0] * a[1] - r[1] * a[0]];
  // (display vectors are scaled by 1/1000, so the cross product of two of them is 1/1000 of the third)
  for (let k = 0; k < 3; k++) assert.ok(Math.abs(cross[k] * 1000 - s[k]) < 1e-12);
});
