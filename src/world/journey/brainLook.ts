// The cinematic look of the whole brain at the entrance to the world.
//
// MEASURED: the shape (one volunteer's MRI-derived surface from the atlas) and the region each vertex belongs to (the
// atlas's own label volume). Both are used unchanged, so picking still returns real atlas structures.
// RENDERING ONLY: everything this file adds. Nothing here is histology, blood supply or activity.
//
// What the diagnosis against the reference still found, and what this shader does about each point:
//   · the old look used one saturated pink everywhere      → a dusty mauve albedo; colour now comes from the LIGHTS:
//                                                             a cool lavender key from the upper left, a warm
//                                                             magenta light from the right, as in the still;
//   · sulci read as shallow dents (occlusion is baked per   → a concavity field computed from the mesh itself
//     vertex at low frequency; nothing marks the fundus)       (curvatureField) draws the thin dark line at the bottom
//                                                             of each fold and lifts the crowns slightly;
//   · tight specular sparkle made it look like plastic       → two broad satin lobes only; no tight highlight;
//   · normals are 8-bit and the surface is smoothed          → adequate for broad lobes (checked: no banding at the
//                                                             framing used); fine relief is a procedural bump that
//                                                             fades with distance.
// Still different from the still: no true subsurface scattering, no cast shadows between folds, no depth of field on
// the geometry itself (only a soft blur of the frame's edges in CSS), and the sulci of this real surface are
// shallower and more irregular than those of the sculpted model in the still.
import { BufferAttribute, Color, FrontSide, ShaderMaterial, Vector3, type BufferGeometry } from 'three';
import type { Adjacency } from '../../atlas/surfaceFields';

/**
 * Per vertex: how concave (x) and how convex (y) the surface is there, 0…255, from the mesh alone: the offset of a
 * vertex from the mean of its neighbours, along its normal, relaxed twice. Pure function of the geometry.
 */
export function curvatureField(position: ArrayLike<number>, normal: (v: number, k: 0 | 1 | 2) => number, adj: Adjacency, scaleMm = 0.11): Uint8Array {
  const n = position.length / 3, h = new Float32Array(n), tmp = new Float32Array(n), { start, list } = adj;
  for (let v = 0; v < n; v++) {
    const a = start[v], b = start[v + 1];
    if (b === a) continue;
    let mx = 0, my = 0, mz = 0;
    for (let i = a; i < b; i++) { const w = list[i] * 3; mx += position[w]; my += position[w + 1]; mz += position[w + 2]; }
    const k = 1 / (b - a);
    h[v] = (mx * k - position[v * 3]) * normal(v, 0) + (my * k - position[v * 3 + 1]) * normal(v, 1) + (mz * k - position[v * 3 + 2]) * normal(v, 2);
  }
  let src = h, dst = tmp;
  for (let pass = 0; pass < 2; pass++) {
    for (let v = 0; v < n; v++) {
      const a = start[v], b = start[v + 1];
      if (b === a) { dst[v] = src[v]; continue; }
      let s = 0;
      for (let i = a; i < b; i++) s += src[list[i]];
      dst[v] = 0.5 * src[v] + 0.5 * (s / (b - a));
    }
    [src, dst] = [dst, src];
  }
  const out = new Uint8Array(n * 2);
  for (let v = 0; v < n; v++) {
    const c = src[v] / scaleMm;                       // > 0 in a fold, < 0 on a crown (normals point out of the tissue)
    out[v * 2] = Math.round(255 * Math.max(0, Math.min(1, c)));
    out[v * 2 + 1] = Math.round(255 * Math.max(0, Math.min(1, -c)));
  }
  return out;
}

/** Adds the attributes this look needs to the shared specimen geometry (once). Nothing the classic view uses is touched. */
export function prepareGeometry(g: BufferGeometry, adj: Adjacency): void {
  if (g.getAttribute('aCurv')) return;
  const pos = g.getAttribute('position'), nrm = g.getAttribute('normal');
  const curv = curvatureField(pos.array as ArrayLike<number>, (v, k) => (k === 0 ? nrm.getX(v) : k === 1 ? nrm.getY(v) : nrm.getZ(v)), adj);
  g.setAttribute('aCurv', new BufferAttribute(curv, 2, true));
  g.setAttribute('aWSel', new BufferAttribute(new Uint8Array(pos.count), 1, true));
  g.setAttribute('aWEntry', new BufferAttribute(new Uint8Array(pos.count), 1, true));
}

const VERT = /* glsl */ `
attribute float aAo; attribute float aRegion; attribute vec2 aCurv; attribute float aWSel; attribute float aWEntry;
uniform float uHover;
varying vec3 vN; varying vec3 vV; varying vec3 vP; varying float vAo; varying vec2 vCurv; varying float vSel; varying float vHov; varying float vEntry;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal); vV = -mv.xyz; vP = position; vAo = aAo; vCurv = aCurv; vSel = aWSel;
  vHov = abs(aRegion - uHover) < 0.5 ? 1.0 : 0.0;
  vEntry = aWEntry;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform vec3 uBase; uniform vec3 uDeep; uniform vec3 uKeyDir; uniform vec3 uKeyCol; uniform vec3 uWarmDir; uniform vec3 uWarmCol; uniform vec3 uCoolCol;
uniform vec3 uSelCol; uniform vec3 uHovCol; uniform vec3 uEntryCol; uniform float uDim; uniform float uPulse; uniform float uExposure; uniform float uEntryOn;
varying vec3 vN; varying vec3 vV; varying vec3 vP; varying float vAo; varying vec2 vCurv; varying float vSel; varying float vHov; varying float vEntry;
float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y);
  float b = mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y);
  return mix(a, b, f.z);
}
vec3 bump(vec3 pos, vec3 n, float h, float k) {
  vec3 dpdx = dFdx(pos), dpdy = dFdy(pos);
  float hx = dFdx(h) * k, hy = dFdy(h) * k;
  vec3 r1 = cross(dpdy, n), r2 = cross(n, dpdx);
  float det = dot(dpdx, r1);
  return normalize(abs(det) * n - sign(det) * (hx * r1 + hy * r2));
}
void main() {
  vec3 V = normalize(vV), N = normalize(vN);
  if (!gl_FrontFacing) { gl_FragColor = vec4(0.012, 0.008, 0.02, 1.0); return; }
  // fine relief, fading out with distance so that it never shimmers (vP is in mm)
  float px = length(fwidth(vP));
  float f1 = 1.0 - smoothstep(0.10, 0.34, px * 0.55);
  N = bump(-vV, N, vnoise(vP * 0.55) * 0.7 + vnoise(vP * 1.7) * 0.3, 0.00013 * f1);

  float ao = clamp(vAo, 0.0, 1.0);
  float fold = smoothstep(0.10, 0.72, ao);                       // 0 deep in a fold … 1 on a crown
  float crease = smoothstep(0.30, 0.92, vCurv.x) * (1.0 - 0.55 * fold);   // the thin line along the bottom of a fold
  float crown = smoothstep(0.25, 0.95, vCurv.y);
  vec3 albedo = mix(uDeep, uBase, fold);
  albedo *= 0.93 + 0.12 * vnoise(vP * 0.15 + 11.0);
  albedo = mix(albedo, albedo * vec3(0.90, 0.92, 1.10), smoothstep(0.45, 0.95, vnoise(vP * 0.043 + 3.7)) * 0.4);
  albedo *= 1.0 + 0.07 * crown;
  float occl = mix(0.07, 1.0, pow(ao, 2.3)) * mix(1.0, 0.16, crease);

  // key: cool, from the upper left; wrapped, with a warm terminator (light that has passed through tissue)
  float ndl = dot(N, uKeyDir);
  float kd = clamp((ndl + 0.22) / 1.22, 0.0, 1.0);
  vec3 col = albedo * uKeyCol * kd * kd * occl;
  float term = smoothstep(-0.5, 0.05, ndl) * (1.0 - smoothstep(0.05, 0.7, ndl));
  col += albedo * vec3(1.0, 0.30, 0.42) * term * 0.16 * (0.4 + 0.6 * ao);
  // warm light from the right: the magenta side of the reference
  float nw = clamp(dot(N, uWarmDir) * 0.56 + 0.44, 0.0, 1.0);
  col += albedo * uWarmCol * pow(nw, 4.0) * mix(0.22, 1.0, ao * ao) * mix(1.0, 0.35, crease);
  // ambient: cool from above, deep plum from below; folds keep a little colour instead of going black
  col += albedo * mix(vec3(0.060, 0.018, 0.050), vec3(0.105, 0.115, 0.215), smoothstep(-0.7, 0.9, N.y)) * (0.14 + 0.86 * ao * ao) * mix(1.0, 0.4, crease) * 0.85;
  // rims: cool on the key side, warm on the far side
  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.8);
  float side = clamp(N.x * 0.5 + 0.5, 0.0, 1.0);
  col += mix(uCoolCol, uWarmCol * 1.5, side) * fres * smoothstep(0.10, 0.6, ao) * 0.42;
  // satin: two broad lobes, no tight highlight
  vec3 H = normalize(uKeyDir + V);
  float nh = max(dot(N, H), 0.0);
  col += uKeyCol * (pow(nh, 7.0) * 0.050 + pow(nh, 30.0) * 0.085) * ao * smoothstep(0.0, 0.3, ndl) * (1.0 - crease);
  vec3 H2 = normalize(uWarmDir + V);
  col += uWarmCol * pow(max(dot(N, H2), 0.0), 16.0) * 0.10 * ao;

  // selection, hover and the way in — all as light on the tissue, never a repaint
  float sel = smoothstep(0.40, 0.60, vSel);
  float selEdge = 1.0 - smoothstep(0.6, 1.9, abs(vSel - 0.5) / max(fwidth(vSel), 1e-5));
  float dim = uDim * (1.0 - sel);
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, vec3(lum) * vec3(0.78, 0.80, 1.02), dim * 0.45) * mix(1.0, 0.62, dim);
  col *= 1.0 + 0.10 * sel + 0.16 * vHov * (1.0 - sel);
  col += uHovCol * vHov * (1.0 - sel) * (0.03 + fres * 0.30);
  col += uSelCol * sel * fres * 0.28;
  col = mix(col, uSelCol * 1.1, selEdge * 0.8);
  // the way in: a thin warm contour around the region and the faintest lift inside it
  float wayIn = smoothstep(0.40, 0.60, vEntry) * uEntryOn * (1.0 - sel);
  float wayEdge = (1.0 - smoothstep(0.7, 2.2, abs(vEntry - 0.5) / max(fwidth(vEntry), 1e-5))) * uEntryOn * (1.0 - sel);
  float wayGlow = smoothstep(0.22, 0.5, vEntry) * (1.0 - smoothstep(0.5, 0.95, vEntry)) * uEntryOn * (1.0 - sel);
  col += uEntryCol * (wayIn * (0.020 + 0.022 * uPulse) + wayGlow * (0.045 + 0.06 * uPulse)) * (0.35 + 0.65 * ao);
  col = mix(col, uEntryCol * (0.5 + 0.2 * uPulse), wayEdge * 0.5 * smoothstep(0.15, 0.5, ao));

  gl_FragColor = vec4(col * uExposure, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const v3 = (hex: string, k = 1) => { const c = new Color(hex); return new Vector3(c.r * k, c.g * k, c.b * k); };

export function makeBrainMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    name: 'world-brain', vertexShader: VERT, fragmentShader: FRAG, side: FrontSide,
    uniforms: {
      uBase: { value: v3('#D2A3BC') }, uDeep: { value: v3('#3A1330') },
      // view space: +x right, +y up, +z towards the viewer — the rig travels with the camera
      uKeyDir: { value: new Vector3(-0.58, 0.66, 0.48).normalize() }, uKeyCol: { value: v3('#E2E2FF', 1.42) },
      uWarmDir: { value: new Vector3(0.93, -0.16, 0.16).normalize() }, uWarmCol: { value: v3('#FF345C', 0.95) },
      uCoolCol: { value: v3('#6D93FF', 1.25) },
      uSelCol: { value: v3('#7FE7FF') }, uHovCol: { value: v3('#FFE2B8') }, uEntryCol: { value: v3('#FFB45E', 2.2) },
      uHover: { value: -9 }, uEntryOn: { value: 1 }, uDim: { value: 0 }, uPulse: { value: 0 }, uExposure: { value: 1.0 },
    },
  });
}
