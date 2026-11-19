// Display / picking rules (src/atlas/visibility.ts): what is drawn as the continuous surface, what as its own model,
// what can be picked, how the cut plane limits picks, and that the display transform is an exact rotation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  displayToRasMm, keptByClip, plan, rasMmToDisplay, regionAt, resolvePick, shellMode, type DisplayState,
} from '../src/atlas/visibility.ts';

const gyrus = { id: 'left_precentral_gyrus', hemisphere: 'left', tissue: 'cortex' } as const;
const gyrusR = { id: 'right_precentral_gyrus', hemisphere: 'right', tissue: 'cortex' } as const;
const thal = { id: 'left_thalamus', hemisphere: 'left', tissue: 'diencephalon' } as const;
const hippo = { id: 'left_hippocampus', hemisphere: 'left', tissue: 'medial-temporal' } as const;
const white = { id: 'left_cerebral_white_matter', hemisphere: 'left', tissue: 'white-matter' } as const;

const base = (over: Partial<DisplayState> = {}): DisplayState => ({
  viewMode: 'solid', focus: 'none', hemi: { left: true, right: true, midline: true }, hidden: new Set(), selected: new Set(),
  // the hippocampus owns a few vertices on the medial wall, but it is not an outer structure
  onSurface: new Set([gyrus.id, gyrusR.id, hippo.id]), exposed: new Set([gyrus.id, gyrusR.id]),
  ...over,
});

test('default: one solid surface; surface regions are picked on it, nothing else is drawn', () => {
  const d = base();
  assert.equal(shellMode(d), 'solid');
  assert.deepEqual(plan(gyrus, d), { visible: true, surface: true, mesh: false, pickable: true });
  assert.deepEqual(plan(thal, d), { visible: true, surface: false, mesh: false, pickable: false });
});

test('selecting an outer region keeps the surface solid', () => {
  const d = base({ selected: new Set([gyrus.id]) });
  assert.equal(shellMode(d), 'solid');
  assert.equal(plan(gyrus, d).surface, true);
  assert.equal(plan(gyrus, d).mesh, false);
});

test('selecting something beneath the surface makes the shell see-through and draws that structure as a solid body', () => {
  const d = base({ selected: new Set([thal.id]) });
  assert.equal(shellMode(d), 'ghost');
  assert.deepEqual(plan(thal, d), { visible: true, surface: false, mesh: true, pickable: true });
  // the see-through shell never takes a click
  assert.equal(plan(gyrus, d).pickable, false);
});

test('a deep structure with a few hidden surface vertices still counts as beneath the surface', () => {
  const d = base({ selected: new Set([hippo.id]) });
  assert.equal(shellMode(d), 'ghost');
  assert.equal(plan(hippo, d).mesh, true);
});

test('a group that includes an outer region stays on the solid surface', () => {
  assert.equal(shellMode(base({ selected: new Set([gyrus.id, white.id]) })), 'solid');
});

test('X-ray: see-through shell, the inner bodies are drawn and pickable, the cortex is not', () => {
  const d = base({ viewMode: 'xray' });
  assert.equal(shellMode(d), 'ghost');
  assert.equal(plan(thal, d).mesh, true);
  assert.equal(plan(hippo, d).mesh, true);
  assert.equal(plan(gyrus, d).pickable, false);
  assert.equal(plan(white, d).mesh, false, 'white matter would hide everything inside it');
});

test('in context: the selected region is drawn as its own body inside the see-through shell', () => {
  const d = base({ selected: new Set([gyrus.id]), focus: 'context' });
  assert.equal(shellMode(d), 'ghost');
  assert.equal(plan(gyrus, d).mesh, true);
  assert.equal(plan(thal, d).mesh, false);
});

test('isolate: no shell at all, only the selection', () => {
  const d = base({ selected: new Set([gyrus.id]), focus: 'isolate' });
  assert.equal(shellMode(d), 'hidden');
  assert.deepEqual(plan(gyrus, d), { visible: true, surface: false, mesh: true, pickable: true });
  assert.equal(plan(gyrusR, d).pickable, false);
  // isolating with nothing selected does nothing
  assert.equal(shellMode(base({ focus: 'isolate' })), 'solid');
});

test('slice: the surface stays solid and no separate bodies are drawn (the cut face shows the MRI instead)', () => {
  const d = base({ viewMode: 'slice', selected: new Set([thal.id]) });
  assert.equal(shellMode(d), 'solid');
  assert.equal(plan(thal, d).mesh, false);
  assert.equal(plan(gyrus, d).surface, true);
});

test('hidden structures and switched-off hemispheres are neither drawn nor pickable', () => {
  assert.deepEqual(plan(gyrus, base({ hidden: new Set([gyrus.id]) })), { visible: false, surface: false, mesh: false, pickable: false });
  const d = base({ hemi: { left: false, right: true, midline: true } });
  assert.equal(plan(gyrus, d).visible, false);
  assert.equal(plan(gyrusR, d).visible, true);
  assert.equal(plan({ id: 'm', hemisphere: 'midline', tissue: 'commissure' }, d).visible, true);
});

test('resolvePick returns the nearest pickable hit; an unlabelled opaque surface blocks what is behind it', () => {
  const none = { axis: 'none', posMm: 0, keep: '-' } as const;
  const hits = [
    { id: 'behind', distance: 0.5, pointRasMm: [0, 0, 0] as const },
    { id: 'front', distance: 0.2, pointRasMm: [0, 0, 0] as const },
  ];
  assert.equal(resolvePick(hits, none)?.id, 'front');
  assert.equal(resolvePick([], none), null);
  // a region that is not drawn lets the ray through
  assert.equal(resolvePick(hits, none, (id) => id !== 'front')?.id, 'behind');
  // id '' = opaque surface without a region: nothing behind it may be picked, and it is not selectable itself
  assert.equal(resolvePick([{ id: '', distance: 0.1, pointRasMm: [0, 0, 0] }, ...hits], none), null);
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

test('regionAt reads the voxel that contains a RAS point and returns nothing outside the volume', () => {
  const dims = [3, 2, 2], originMm = [-1, 10, 100];
  const region = new Uint8Array(12), t1 = new Uint8Array(12);
  // voxel (2, 1, 0) ↔ RAS (1, 11, 100)
  region[2 + 3 * (1 + 2 * 0)] = 42; t1[2 + 3 * (1 + 2 * 0)] = 200;
  const vol = { dims, originMm, region, t1 };
  assert.deepEqual(regionAt(vol, [1.2, 10.8, 100.3]), { region: 42, t1: 200 });
  assert.deepEqual(regionAt(vol, [0, 10, 100]), { region: 0, t1: 0 });
  assert.deepEqual(regionAt(vol, [5, 10, 100]), { region: 0, t1: 0 });
  assert.deepEqual(regionAt(vol, [1, 11, 99.2]), { region: 0, t1: 0 });
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
