// The embodied build's rules, checked on the pure modules (no browser):
//   · the camera follows the craft from behind, is pulled in rather than put inside a cell body, and eases the same
//     way at any frame rate;
//   · whatever part of a drawn neuron is aimed at — body or any branch, from any side — resolves to that one neuron;
//     what is in front wins; a manipulation handle wins over everything; a near miss counts only when nothing is hit;
//   · a recording contact observes: placing or moving it changes that contact's samples to exactly the declared
//     function of its new position, and changes neither the other contact's samples nor any spike time; the same
//     seed gives the same noise before and after; nothing about the craft or the camera is an argument;
//   · positions are finite and inside the block whatever is asked for, and zero distance to a cell is finite;
//   · placing or moving is one step that undo takes back and redo does again; the baseline holds the circuit's causes,
//     both contact positions and the seed;
//   · a saved experiment comes back the same; a save of the previous format is read, not lost; rubbish gives defaults;
//   · the reconstructed neuron's file says where it comes from, under which licence, and that no model is attached.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { boomPose, boomPull, boundOf, chunkBody, ease, easeAngle, lookDir, pickBody, smoothDamp, type PickBody, type V3 } from '../src/world/flight.ts';
import { PART_NAMES, buildForeground, buildSkeletonCell, type SkeletonNodes } from '../src/world/morph.ts';
import { defaultSetup } from '../src/world/model/circuits.ts';
import {
  CONTACT_IDS, CONTACT_SLOT, NO_CONTACTS, PROBE_SEED, applyChange, compareSentence, contactChanges, contactPosition, contributions, keepAsBaseline, labChanges, newLab, placeContact, probeRecording, redo,
  restoreLab, saveLab, toBaseline, undo,
} from '../src/world/model/journey.ts';
import { BLOCK, EXEMPLAR, HOME, VESSEL, exemplarToScene, modelToScene, sceneToModel } from '../src/world/model/layout.ts';
import { OBS, ampAtUv, contactTrace, noiseAt, type Vec3 } from '../src/world/model/observe.ts';
import { DEFAULT_SAVED, SAVE_VERSION, readSaved } from '../src/world/model/saved.ts';

const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;
const sub = (a: readonly number[], b: readonly number[]): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const unit = (v: V3): V3 => { const n = Math.hypot(...v); return [v[0] / n, v[1] / n, v[2] / n]; };
const T_POS = newLab(0).result.run.circuit.cells.find((c) => c.id === 'T')!.pos as Vec3;

// ── the player and the camera ───────────────────────────────────────────────────────────────────────────────────
test('camera: it sits behind and above the craft looking the same way; a cell body in the way pulls it in, never through; easing does not depend on the frame rate', () => {
  const boom = { dist: 62, height: 19 }, pos: V3 = [10, 20, 30], yaw = 0.7, pitch = -0.2, f = lookDir(yaw, pitch);
  const c = boomPose(pos, yaw, pitch, boom), back = sub(c.pos, pos);
  assert.ok(back[0] * f[0] + back[1] * f[1] + back[2] * f[2] < -60, 'behind the craft along its aim');
  assert.ok(c.pos[1] > pos[1], 'and above it');
  assert.equal(c.yaw, yaw); assert.equal(c.pitch, pitch);
  assert.ok(near(Math.hypot(...back), Math.hypot(boom.dist, boom.height), 1e-9), 'at the boom’s length');
  // pulled in: the same line, shorter
  const half = boomPose(pos, yaw, pitch, boom, 0.5), hb = sub(half.pos, pos);
  assert.ok(near(Math.hypot(...hb), Math.hypot(...back) / 2, 1e-9));
  // a cell body exactly where the camera would be: the boom shortens until the camera is outside it
  const blocker = [{ centre: c.pos, radius: 12 }];
  const pull = boomPull(pos, yaw, pitch, boom, blocker, 4);
  assert.ok(pull > 0 && pull <= 0.9);
  const moved = boomPose(pos, yaw, pitch, boom, pull).pos;
  assert.ok(Math.hypot(...sub(moved, c.pos)) >= 16, 'outside the body and its margin');
  assert.equal(boomPull(pos, yaw, pitch, boom, [], 4), 0, 'nothing in the way: the full boom');
  // one step of 1/30 s is the same as two of 1/60 s, for a value and for an angle (the short way round)
  assert.ok(near(ease(0, 10, 1 / 30, 0.1), ease(ease(0, 10, 1 / 60, 0.1), 10, 1 / 60, 0.1), 1e-12));
  assert.ok(near(easeAngle(3.0, -3.0, 1 / 30, 0.1), easeAngle(easeAngle(3.0, -3.0, 1 / 60, 0.1), -3.0, 1 / 60, 0.1), 1e-12));
  assert.ok(easeAngle(3.0, -3.0, 0.05, 0.1) > 3.0, 'from 3.0 to −3.0 rad it turns through π, not back through 0');
  // a move to somewhere else (to or from Inspect, a change of view): starts from rest gently, never overshoots, arrives
  let x = 0, v = 0, first = 0, top = 0, peak = 0;
  for (let i = 0; i < 240; i++) { const was = x; [x, v] = smoothDamp(x, 400, v, 0.3, 1 / 60); if (i === 0) first = x; top = Math.max(top, x); peak = Math.max(peak, x - was); }
  assert.ok(first < 4, `the first sixtieth of a second covers ${first.toFixed(2)} of 400 µm`);
  assert.ok(peak < 20, `its fastest frame covers ${peak.toFixed(1)} µm`);
  assert.ok(top <= 400 + 1e-9 && 400 - x < 0.01, 'no overshoot, and it arrives');
  // and the same at 30 frames a second, to within a few per cent along the way
  let x30 = 0, v30 = 0, x60 = 0, v60 = 0;
  for (let i = 0; i < 12; i++) [x30, v30] = smoothDamp(x30, 400, v30, 0.3, 1 / 30);
  for (let i = 0; i < 24; i++) [x60, v60] = smoothDamp(x60, 400, v60, 0.3, 1 / 60);
  assert.ok(Math.abs(x30 - x60) < 400 * 0.03, `after 0.4 s: ${x30.toFixed(1)} µm at 30 fps, ${x60.toFixed(1)} µm at 60 fps`);
});

// ── pointing at things ──────────────────────────────────────────────────────────────────────────────────────────
function bodyOf(kind: PickBody['kind'], id: string, proxy: { segs: Float32Array; parts: Uint8Array }, centre: V3, radius: number): PickBody {
  return { kind, id, centre, radius, spherePart: 'cell body', segs: proxy.segs, parts: proxy.parts, partNames: PART_NAMES, chunks: chunkBody(proxy.segs), bound: boundOf(proxy.segs, centre, radius) };
}
test('pointing: the body and every branch of a neuron resolve to that neuron, from any side, with the part named; what is in front wins', () => {
  const cells = [
    { id: 'N1', label: 'one', pos: [0, 0, 0] as V3, radius: 9, tint: 'exc' as const, shape: 'pyramidal' as const },
    { id: 'N2', label: 'two', pos: [400, 60, -300] as V3, radius: 8, tint: 'inh' as const, shape: 'multipolar' as const },
  ];
  const { proxies } = buildForeground(cells);
  const n1 = bodyOf('cell', 'N1', proxies[0], cells[0].pos, cells[0].radius), n2 = bodyOf('context', 'N2', proxies[1], cells[1].pos, cells[1].radius);
  assert.ok(n1.segs!.length / 7 > 40, 'the neuron has many branch segments to point at');
  // alone in the scene: from three viewpoints, aim at the middle of every 9th branch segment, and at the body
  const names = new Set<string>();
  for (const eye of [[260, 40, 300], [-320, 140, -90], [30, -260, 220]] as V3[]) {
    const s = n1.segs!;
    for (let i = 0; i < s.length / 7; i += 9) {
      const mid: V3 = [(s[i * 7] + s[i * 7 + 3]) / 2, (s[i * 7 + 1] + s[i * 7 + 4]) / 2, (s[i * 7 + 2] + s[i * 7 + 5]) / 2];
      const hit = pickBody(eye, unit(sub(mid, eye)), [n1]);
      assert.ok(hit && hit.id === 'N1' && hit.kind === 'cell' && hit.exact, `segment ${i} from ${eye}: its neuron`);
      assert.ok((PART_NAMES as readonly string[]).includes(hit!.part), `a named part (${hit!.part})`);
      names.add(hit!.part);
    }
    const body = pickBody(eye, unit(sub(cells[0].pos, eye)), [n1]);
    assert.ok(body && body.id === 'N1');
  }
  assert.ok(names.size >= 3, `several different parts were pointed at: ${[...names].join(', ')}`);
  // straight at the body from where no branch is in the way: it is called the cell body
  assert.equal(pickBody([0, 0, 60], [0, 0, -1], [n1])?.part === 'cell body' || pickBody([60, 0, 0], [-1, 0, 0], [n1])?.part === 'cell body', true);
  // a context neuron is reported as what it is
  assert.equal(pickBody([400, 60, -200], [0, 0, -1], [n1, n2])?.kind, 'context');
  // occlusion: something nearer on the same ray is what is picked — whichever order the scene lists them in
  const eye: V3 = [0, 0, 300], d: V3 = [0, 0, -1];
  const front: PickBody = { kind: 'context', id: 'front', centre: [0, 0, 150], radius: 10, bound: { c: [0, 0, 150], r: 10 } };
  assert.equal(pickBody(eye, d, [n1, front])?.id, 'front');
  assert.equal(pickBody(eye, d, [front, n1])?.id, 'front');
  assert.ok(near(pickBody(eye, d, [front, n1])!.t, 140, 1e-6), 'at its surface');
  // the player's craft is never in the list: nothing of the player can be in the way of the aim
  // a manipulation handle wins over everything, even from behind a body
  const handle: PickBody = { kind: 'handle', id: 'P1:x', segs: Float32Array.of(-20, 0, -50, 20, 0, -50, 1.5), bound: { c: [0, 0, -50], r: 22 } };
  assert.equal(pickBody(eye, d, [n1, front, handle])?.kind, 'handle');
  // a near miss counts only when nothing at all is hit
  const thin: PickBody = { kind: 'landmark', id: 'thin', segs: Float32Array.of(-50, 0.9, 100, 50, 0.9, 100, 0.5), bound: { c: [0, 0.9, 100], r: 51 } };
  const miss = pickBody(eye, d, [thin], Infinity, 0.006);
  assert.ok(miss && miss.id === 'thin' && !miss.exact, '0.4 µm past a thin thing at 200 µm is within five pixels');
  assert.equal(pickBody(eye, d, [thin], Infinity, 0.0005), null, 'but not within half a pixel');
  assert.equal(pickBody(eye, d, [thin, n1])?.id, 'N1', 'and never instead of something that is really hit');
  assert.equal(pickBody(eye, [0, 1, 0], [n1, n2, front, thin]), null, 'aiming at nothing picks nothing');
});

// ── the recording contacts ──────────────────────────────────────────────────────────────────────────────────────
test('a contact observes: moving P1 gives exactly the declared function of its new position; P2 and every spike time stay the same; the noise is the same noise', () => {
  // a run in which the target fires, so that there is something to record
  let lab = applyChange(newLab(0), { bMs: 14 });
  assert.ok(lab.result.firedMs != null);
  const a: Vec3 = [T_POS[0] + 40, T_POS[1], T_POS[2]], b: Vec3 = [T_POS[0] - 180, T_POS[1] + 40, T_POS[2] + 60], a2: Vec3 = [T_POS[0] + 18, T_POS[1], T_POS[2]];
  lab = placeContact(placeContact(lab, 'P1', a), 'P2', b);
  const run = lab.result.run, spikes = JSON.stringify(run.spikes), digest = lab.result.digest;
  const p1 = probeRecording(run, lab.contacts.P1!, lab.seed, CONTACT_SLOT.P1), p2 = probeRecording(run, lab.contacts.P2!, lab.seed, CONTACT_SLOT.P2);
  const moved = placeContact(lab, 'P1', a2);
  // the circuit: the very same run object, the same fingerprint, the same spike times
  assert.equal(moved.result, lab.result); assert.equal(moved.result.digest, digest); assert.equal(JSON.stringify(moved.result.run.spikes), spikes);
  assert.deepEqual(moved.contacts.P2, b, 'P2 is where it was');
  const q1 = probeRecording(moved.result.run, moved.contacts.P1!, moved.seed, CONTACT_SLOT.P1), q2 = probeRecording(moved.result.run, moved.contacts.P2!, moved.seed, CONTACT_SLOT.P2);
  assert.deepEqual(q2.trace, p2.trace, 'P2’s samples are identical, sample by sample');
  assert.deepEqual(q2.events, p2.events);
  // P1 at its new place = Σ_cells a(distance) · Σ_spikes h(t − t_spike) + noise(seed, P1, sample): the declared generator, evaluated independently
  const cells = run.circuit.cells.map((c) => c.pos as Vec3), n = run.nSteps + 1;
  const signal = (at: Vec3) => contactTrace({ cells, spikes: run.spikes, placements: [{ atStep: 0, pos: at }], seed: 0, slot: 0, fromStep: 0, n, dtMs: run.dt, noNoise: true });
  const sNew = signal(a2), sOld = signal(a);
  let worst = 0, changed = 0, noiseDiff = 0;
  for (let i = 0; i < n; i++) {
    const want = sNew[i] + OBS.noiseUv * noiseAt(moved.seed, CONTACT_SLOT.P1, i);
    worst = Math.max(worst, Math.abs(q1.trace[i] - want));
    if (q1.trace[i] !== p1.trace[i]) changed++;
    noiseDiff = Math.max(noiseDiff, Math.abs((q1.trace[i] - sNew[i]) - (p1.trace[i] - sOld[i])));
  }
  assert.ok(worst < 1e-3, `every sample is the declared function of the new position (worst difference ${worst} µV)`);
  assert.ok(changed > 20, 'and it really differs from the recording at the old position');
  assert.ok(noiseDiff < 1e-3, 'what is left after taking the spikes’ part away is the same noise before and after the move');
  // nearer means larger, by the 1/distance rule — read from the generator’s own numbers
  assert.ok(near(q1.ampsUv.T, ampAtUv(18), 1e-9) && near(p1.ampsUv.T, ampAtUv(40), 1e-9) && q1.ampsUv.T > p1.ampsUv.T);
  assert.ok(q1.events.some((e) => e.cell === 'T'), 'at 18 µm the contact counts T’s spike');
  // the two contacts share the seed but not the noise
  assert.notEqual(noiseAt(lab.seed, CONTACT_SLOT.P1, 5), noiseAt(lab.seed, CONTACT_SLOT.P2, 5));
  assert.equal(lab.seed, PROBE_SEED);
  // who contributes what, by cell
  const rows = contributions(run, a2);
  assert.deepEqual(rows.map((r) => r.cell), run.circuit.cells.map((c) => c.id));
  assert.ok(near(rows.find((r) => r.cell === 'T')!.distUm, 18, 1e-9) && rows.every((r) => near(r.ampUv, ampAtUv(r.distUm))));
});

test('where a contact can be: always a finite place inside the block; zero distance to a cell is finite; nothing of the craft or camera is part of the experiment', () => {
  assert.deepEqual(contactPosition([1.26, -2.34, 3.449], BLOCK), [1.3, -2.3, 3.4], 'rounded to a tenth of a micrometre');
  assert.deepEqual(contactPosition([1e9, -1e9, 0], BLOCK), [BLOCK.max[0], BLOCK.min[1], 0], 'held at the block’s edge');
  for (const bad of [[NaN, 0, 0], [0, Infinity, 0], [1, 2], null, undefined, ['a', 0, 0] as unknown as number[]]) assert.equal(contactPosition(bad as number[] | null, BLOCK), null);
  // exactly on a cell body: the distance floor of the declared rule applies; every sample is a number
  let lab = applyChange(newLab(0), { bMs: 14 });
  lab = placeContact(lab, 'P1', T_POS);
  const rec = probeRecording(lab.result.run, lab.contacts.P1!, lab.seed, CONTACT_SLOT.P1);
  assert.ok(rec.trace.every(Number.isFinite));
  assert.ok(near(rec.ampsUv.T, (OBS.refAmpUv * OBS.refDistUm) / OBS.minDistUm, 1e-9), 'the largest size the rule gives');
  // at a corner of the block
  const corner = placeContact(lab, 'P2', contactPosition([1e9, 1e9, 1e9], BLOCK));
  assert.ok(probeRecording(corner.result.run, corner.contacts.P2!, corner.seed, CONTACT_SLOT.P2).trace.every(Number.isFinite));
  // placing something that is not a position changes nothing
  assert.equal(placeContact(lab, 'P1', lab.contacts.P1), lab);
  // the experiment has no place for a pose: what is saved of it holds causes, contacts and a seed — nothing else
  const saved = JSON.parse(JSON.stringify(saveLab(corner)));
  assert.deepEqual(Object.keys(saved).sort(), ['baseline', 'history', 'seed']);
  assert.deepEqual(Object.keys(saved.history[0]).sort(), ['contacts', 'label', 'setup']);
  assert.ok(!/pose|yaw|pitch|camera|craft/i.test(JSON.stringify(saved)));
  // model coordinates and scene coordinates are the same numbers here, and the two transforms undo each other
  const p: V3 = [12.5, -7, 300];
  assert.deepEqual(sceneToModel(modelToScene(p)), p); assert.deepEqual(modelToScene(p), p);
  assert.deepEqual([...CONTACT_IDS], ['P1', 'P2']);
});

test('history: placing or moving a contact is one step; undo takes it back and redo does it again; the baseline holds causes, both positions and the seed', () => {
  const a: Vec3 = [60, 0, 5], a2: Vec3 = [40, 0, 5], b: Vec3 = [-150, 30, 60];
  let lab = newLab(0);
  assert.deepEqual(lab.contacts, NO_CONTACTS); assert.deepEqual(lab.baselineContacts, NO_CONTACTS);
  lab = placeContact(lab, 'P1', a);
  assert.equal(lab.history.length, 2); assert.match(lab.history[1].label, /^P1 placed/);
  lab = placeContact(lab, 'P2', b);
  lab = placeContact(lab, 'P1', a2);
  assert.equal(lab.history.length, 4); assert.match(lab.history[3].label, /^P1 moved 20 µm/);
  // undo: P1 is back where it was placed, P2 untouched; redo: moved again
  let u = undo(lab);
  assert.deepEqual(u.contacts, { P1: a, P2: b }); assert.equal(u.history.length, 3); assert.equal(u.future.length, 1); assert.equal(u.result, lab.result, 'no run was recomputed for a contact');
  const r = redo(u);
  assert.deepEqual(r.contacts, { P1: a2, P2: b }); assert.equal(r.future.length, 0); assert.equal(redo(r), r, 'nothing more to redo');
  u = undo(undo(u));
  assert.deepEqual(u.contacts, NO_CONTACTS); assert.equal(u.future.length, 3);
  // a new step after undoing forgets what was undone
  assert.equal(placeContact(u, 'P2', b).future.length, 0);
  // undo and redo across a change of cause: the run comes back with the same fingerprint
  const fired = applyChange(lab, { bMs: 14 }), d = fired.result.digest;
  assert.notEqual(d, lab.result.digest);
  assert.equal(undo(fired).result.digest, lab.result.digest); assert.equal(redo(undo(fired)).result.digest, d);
  assert.deepEqual(redo(undo(fired)).contacts, lab.contacts, 'and the contacts are where they were');
  // the baseline: causes + both contact positions + seed
  assert.deepEqual(labChanges(lab).map((c) => c.key), ['contact:P1', 'contact:P2']);
  const kept = keepAsBaseline(fired);
  assert.equal(labChanges(kept).length, 0); assert.equal(compareSentence(kept), 'This is the baseline run.');
  assert.deepEqual(kept.baselineContacts, fired.contacts); assert.equal(kept.baseline.digest, d); assert.equal(kept.seed, PROBE_SEED);
  const later = placeContact(applyChange(kept, { bMs: 30 }), 'P1', [80, 0, 5]);
  assert.deepEqual(labChanges(later).map((c) => c.key), ['bMs', 'contact:P1']);
  assert.match(compareSentence(later), /P1 moved 40 µm/);
  const back = toBaseline(later);
  assert.equal(back.result.digest, d); assert.deepEqual(back.contacts, kept.baselineContacts); assert.equal(labChanges(back).length, 0);
  assert.equal(back.history.length, later.history.length + 1, 'going back is itself one step');
  assert.deepEqual(undo(back).contacts, later.contacts, 'which undo takes back');
  // moving only a contact against the baseline: the sentence says the spikes are the same ones
  const onlyMoved = placeContact(kept, 'P1', [80, 0, 5]);
  assert.match(compareSentence(onlyMoved), /the circuit’s spikes are the same ones as in the baseline — only what P1 records of them differs/);
  assert.deepEqual(contactChanges(kept.contacts, onlyMoved.contacts).map((c) => c.where), ['P1']);
  // removing a contact is a step too
  assert.equal(placeContact(onlyMoved, 'P2', null).contacts.P2, null);
});

// ── what is remembered ──────────────────────────────────────────────────────────────────────────────────────────
test('saving: an experiment comes back the same after a reload; the previous format is read; rubbish gives the defaults', () => {
  let lab = applyChange(newLab(0), { bMs: 14 });
  lab = placeContact(placeContact(lab, 'P1', [60, 0, 5]), 'P2', [-150, 30, 60]);
  lab = placeContact(keepAsBaseline(lab), 'P1', [40, 0, 5]);
  const stored = JSON.parse(JSON.stringify({ v: 2, visited: true, beats: { explore: true, place: true }, level: 'understand', station: 'circuit', guide: true, declared: false, lab: saveLab(lab), pose: { pos: [10, 20, 30], yaw: 1, pitch: -0.1 }, viewKind: 'first', reveal: 'dense', entry: null, dragLooks: false, lookScale: 1.2 }));
  const s = readSaved(stored, null, BLOCK);
  assert.equal(s.v, SAVE_VERSION); assert.equal(s.viewKind, 'first'); assert.equal(s.reveal, 'dense'); assert.deepEqual(s.pose, { pos: [10, 20, 30], yaw: 1, pitch: -0.1 });
  const again = restoreLab(s.lab!);
  assert.equal(again.result.digest, lab.result.digest); assert.deepEqual(again.contacts, lab.contacts); assert.deepEqual(again.baselineContacts, lab.baselineContacts);
  assert.equal(again.baseline.digest, lab.baseline.digest); assert.equal(again.history.length, lab.history.length); assert.equal(again.seed, lab.seed);
  assert.deepEqual(again.history.map((h) => h.label), lab.history.map((h) => h.label));
  assert.deepEqual(labChanges(again).map((c) => c.key), ['contact:P1']);
  assert.deepEqual(undo(again).contacts, undo(lab).contacts, 'the restored history can be undone like the original');
  // the previous format: {setup, label} entries, a set-up as baseline, no contacts, a step of the route that is gone
  const v1 = { visited: true, beats: { explore: true, record: true, change: true }, level: 'inspect', station: 'array', guide: false, declared: true, history: [{ setup: defaultSetup(0), label: 'first' }, { setup: { ...defaultSetup(0), bMs: 14 }, label: 'B earlier' }], baseline: defaultSetup(0), pose: { pos: [5000, 0, 0], yaw: 0.3, pitch: 9 }, entry: { id: 'x', name: 'left precentral gyrus' }, dragLooks: true, lookScale: 1.5 };
  const m = readSaved(null, JSON.parse(JSON.stringify(v1)), BLOCK);
  assert.equal(m.v, 2); assert.equal(m.lab!.history.length, 2); assert.deepEqual(m.lab!.history[1].contacts, NO_CONTACTS); assert.deepEqual(m.lab!.baseline!.contacts, NO_CONTACTS);
  assert.deepEqual(m.beats, { explore: true, change: true }, 'the old probe step is dropped, the rest of the progress is kept');
  assert.equal(m.level, 'inspect'); assert.equal(m.station, 'array'); assert.equal(m.declared, true); assert.equal(m.guide, false); assert.equal(m.dragLooks, true);
  assert.deepEqual(m.pose!.pos, [BLOCK.max[0], 0, 0], 'a pose outside the block is brought inside'); assert.ok(Math.abs(m.pose!.pitch) <= 1.5);
  const fromV1 = restoreLab(m.lab!);
  assert.ok(fromV1.result.firedMs != null, 'the old experiment’s last run is the current one'); assert.equal(fromV1.baseline.firedMs, null);
  // a current record wins over an old one
  assert.equal(readSaved(stored, v1, BLOCK).level, 'understand');
  // rubbish: defaults, and never an exception
  for (const junk of [null, 42, 'x', [], { v: 2, lab: { history: [{ setup: { variant: 'a' } }] } }, { v: 3 }]) {
    const d = readSaved(junk, null, BLOCK);
    assert.equal(d.lab, null); assert.equal(d.viewKind, 'third'); assert.equal(d.reveal, 'explore');
  }
  assert.deepEqual(readSaved(undefined, undefined, BLOCK), { ...DEFAULT_SAVED, beats: {} });
  // a contact that was saved outside the block comes back at its edge; one that is not a position comes back unplaced
  const odd = JSON.parse(JSON.stringify(stored));
  odd.lab.history[odd.lab.history.length - 1].contacts = { P1: [99999, 0, 0], P2: ['x', 0, 0] };
  const o = readSaved(odd, null, BLOCK).lab!.history.at(-1)!.contacts;
  assert.deepEqual(o, { P1: [BLOCK.max[0], 0, 0], P2: null });
});

// ── the reconstructed neuron ────────────────────────────────────────────────────────────────────────────────────
test('the reconstructed neuron: its file says where it comes from, under which licence and what it is not; it is one tree; every branch of it points back to it', () => {
  const path = new URL('../public/world/h01-exemplar.json', import.meta.url);
  assert.ok(statSync(path).size < 1_000_000, 'a small file: one cell, simplified');
  const a = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(a.format, 'hbci-morphology/1');
  const p = a.provenance;
  assert.match(p.licence, /CC BY 4\.0/); assert.match(p.licenceUrl, /creativecommons\.org\/licenses\/by\/4\.0/);
  assert.match(p.citation, /Shapson-Coe.*Science 384.*10\.1126\/science\.adk4858/);
  assert.match(p.landingPage, /^https:\/\/h01-release\.storage\.googleapis\.com\//); assert.match(p.entrySha256, /^[0-9a-f]{64}$/); assert.equal(p.entry, `${p.segmentId}.0.swc`);
  assert.match(p.region, /temporal cortex \(not the precentral gyrus\)/); assert.equal(p.species, 'human');
  assert.ok(a.limits.some((l: string) => /No electrical model/.test(l)) && a.limits.some((l: string) => /not connected to any model cell/.test(l)));
  assert.ok(a.changes.length >= 2 && /not verified/i.test(a.labels.how));
  const n = a.nodes as SkeletonNodes, N = n.x.length;
  assert.equal(N, a.counts.nodes);
  for (const k of ['y', 'z', 'r', 'parent', 'label', 'path'] as const) assert.equal(n[k].length, N, k);
  assert.equal(n.parent[0], -1); assert.deepEqual([n.x[0], n.y[0], n.z[0]], [0, 0, 0], 'the cell body is the origin of its own frame');
  let tips = 0; const kids = new Uint16Array(N);
  for (let i = 1; i < N; i++) { assert.ok(n.parent[i] >= 0 && n.parent[i] < i, 'a parent comes before its child: one tree, no loop'); kids[n.parent[i]]++; }
  for (let i = 1; i < N; i++) if (!kids[i]) tips++;
  assert.equal(tips, a.counts.tips);
  assert.ok(n.r.every((r) => Number.isFinite(r) && r > 0) && n.label.every((l) => l >= 0 && l < a.labels.codes.length));
  assert.ok([n.x, n.y, n.z].every((v) => v.every(Number.isFinite)));
  assert.ok(Math.abs(a.counts.somaRadiusUm - 4.8) < 0.1, 'the radius its body is drawn with is the file’s own');
  // placed in the block: a rigid placement, all of it inside, its body where the layout says
  assert.deepEqual(exemplarToScene(0, 0, 0), EXEMPLAR.origin);
  const d0 = Math.hypot(n.x[500] - n.x[900], n.y[500] - n.y[900], n.z[500] - n.z[900]), q0 = exemplarToScene(n.x[500], n.y[500], n.z[500]), q1 = exemplarToScene(n.x[900], n.y[900], n.z[900]);
  assert.ok(near(Math.hypot(...sub(q0, q1)), d0, 1e-9), 'distances are kept: nothing is scaled or mirrored');
  for (let i = 0; i < N; i += 7) { const q = exemplarToScene(n.x[i], n.y[i], n.z[i]); assert.ok([0, 1, 2].every((k) => q[k] > BLOCK.min[k] && q[k] < BLOCK.max[k])); }
  assert.ok(Math.hypot(...sub(HOME.pos, EXEMPLAR.origin)) < 160, 'and the craft arrives beside it');
  assert.ok(VESSEL.trunk.length >= 3 && VESSEL.branch.length >= 3 && VESSEL.branch[0].every((v, k) => v === VESSEL.trunk[2][k]), 'the vessel forks at one of its own points');
  // drawn and pointed at: aiming at branch segments of different kinds, from two sides, gives this one neuron
  const placed: SkeletonNodes = { ...n, x: [], y: [], z: [] };
  for (let i = 0; i < N; i++) { const q = exemplarToScene(n.x[i], n.y[i], n.z[i]); placed.x.push(q[0]); placed.y.push(q[1]); placed.z.push(q[2]); }
  const built = buildSkeletonCell(placed, 29, [0, 0, 0]);
  const pos = built.geometry.getAttribute('position');
  assert.ok(pos.count > 10000);
  for (let i = 0; i < pos.count; i += 997) assert.ok(Number.isFinite(pos.getX(i)) && Number.isFinite(pos.getY(i)) && Number.isFinite(pos.getZ(i)));
  const body: PickBody = { kind: 'context', id: 'h01', centre: EXEMPLAR.origin, radius: 4.8, spherePart: 'cell body', segs: built.proxy.segs, parts: built.proxy.parts, partNames: PART_NAMES, chunks: chunkBody(built.proxy.segs), bound: boundOf(built.proxy.segs, EXEMPLAR.origin, 4.8) };
  const s = built.proxy.segs, parts = new Set<string>();
  let tried = 0, own = 0;
  for (const eye of [HOME.pos, [EXEMPLAR.origin[0] - 260, EXEMPLAR.origin[1] + 120, EXEMPLAR.origin[2] - 200] as V3]) {
    for (let i = 0; i < s.length / 7; i += 53) {
      const mid: V3 = [(s[i * 7] + s[i * 7 + 3]) / 2, (s[i * 7 + 1] + s[i * 7 + 4]) / 2, (s[i * 7 + 2] + s[i * 7 + 5]) / 2];
      const hit = pickBody(eye, unit(sub(mid, eye)), [body]);
      tried++; if (hit?.id === 'h01') { own++; parts.add(hit.part); }
    }
  }
  assert.equal(own, tried, 'every branch aimed at resolves to the neuron');
  assert.ok(parts.has('dendrite') && parts.has('axon'), `its parts are named from the data’s labels: ${[...parts].join(', ')}`);
});
