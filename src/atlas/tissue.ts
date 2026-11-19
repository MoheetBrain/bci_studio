// The specimen look: one fragment shader shared by the continuous surface and by the atlas's per-structure meshes.
//
// It is a stylised, physically motivated tissue shader — wrapped diffuse light with a warm terminator (a cheap
// stand-in for subsurface scattering), baked occlusion for the folds, a cool rim, restrained wet highlights and a
// faint procedural micro-relief. All of that is RENDERING: none of it is measured (no histology, no vessels).
// The measured parts are the shape (MRI-derived) and the region ids (label volume).
//
// Lighting is done in view space with a rig that travels with the camera, so every orbit position is lit like the
// opening shot. Selection is expressed as light (a lift inside the region, a luminous border), never as a repaint.
import {
  Color, DataTexture, DoubleSide, FrontSide, LessEqualDepth, NearestFilter, NormalBlending, RGBAFormat, ShaderMaterial,
  UnsignedByteType, Vector2, Vector3, Vector4, type Plane,
} from 'three';
import type { Tissue } from './types';

export const SELECT_COLOR = '#7FE7FF';
export const HOVER_COLOR = '#FFE2B8';

/** Base / fold colours per tissue class (sRGB). The exterior shares one tissue family; inner structures differ subtly. */
export const TISSUE_TONES: Record<Tissue, { base: string; deep: string; gloss: number }> = {
  cortex: { base: '#E2A4C6', deep: '#6E2350', gloss: 1.0 },
  sulcus: { base: '#C2769F', deep: '#52173A', gloss: 0.6 },
  cerebellum: { base: '#DB9ABF', deep: '#6C1C46', gloss: 0.9 },
  brainstem: { base: '#E3AEC4', deep: '#6E2644', gloss: 0.8 },
  'white-matter': { base: '#F1D9D0', deep: '#7A4E5E', gloss: 0.5 },
  diencephalon: { base: '#C98AC0', deep: '#4A2452', gloss: 0.8 },
  'basal-nuclei': { base: '#B98ACF', deep: '#3F2456', gloss: 0.8 },
  'medial-temporal': { base: '#E0A07A', deep: '#5A2E2A', gloss: 0.8 },
  commissure: { base: '#F0DDC8', deep: '#74504C', gloss: 0.6 },
  ventricle: { base: '#7FB6E6', deep: '#1F3E6A', gloss: 1.2 },
};

const NOISE = /* glsl */ `
float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y);
  float b = mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y);
  return mix(a, b, f.z);
}`;

const VERT = /* glsl */ `
#include <common>
#include <clipping_planes_pars_vertex>
attribute float aAo;
#ifdef SPECIMEN
  attribute float aRegion;
  attribute float aFlags;
  attribute float aSelW;
  attribute vec4 aParcelA;
  attribute vec4 aParcelB;
  uniform sampler2D uState;
  uniform vec2 uHemi;
  varying vec4 vPa; varying vec4 vPb;
#else
  uniform vec4 uRegionState;
#endif
varying vec3 vN; varying vec3 vV; varying vec3 vP;
varying float vAo; varying float vSel; varying float vHov; varying float vVis; varying float vBorder;
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = -mvPosition.xyz;
  vP = position;
  vAo = aAo;
  #ifdef SPECIMEN
    vec4 st = texelFetch(uState, ivec2(int(aRegion + 0.5), 0), 0);
    vSel = aSelW; vHov = st.g; vVis = st.b; vPa = aParcelA; vPb = aParcelB;
    float side = mod(aFlags, 4.0);
    vBorder = floor(aFlags / 4.0) / 63.0;
    if (side > 0.5 && side < 1.5) vVis *= uHemi.x;
    if (side > 1.5) vVis *= uHemi.y;
  #else
    vSel = uRegionState.x; vHov = uRegionState.y; vVis = uRegionState.z; vBorder = 0.0;
  #endif
  gl_Position = projectionMatrix * mvPosition;
  #include <clipping_planes_vertex>
}`;

const FRAG = /* glsl */ `
#include <common>
#include <clipping_planes_pars_fragment>
uniform vec3 uBase; uniform vec3 uDeep; uniform vec3 uSss;
uniform vec3 uKeyDir; uniform vec3 uKeyCol; uniform vec3 uRimDir; uniform vec3 uRimCol; uniform vec3 uFillDir; uniform vec3 uFillCol;
uniform vec3 uSky; uniform vec3 uGround; uniform vec3 uSelCol; uniform vec3 uHovCol; uniform vec3 uInside;
uniform float uDim; uniform float uParcels; uniform float uGloss; uniform float uMicro; uniform float uExposure;
varying vec3 vN; varying vec3 vV; varying vec3 vP;
varying float vAo; varying float vSel; varying float vHov; varying float vVis; varying float vBorder;
#ifdef SPECIMEN
  varying vec4 vPa; varying vec4 vPb;
#endif
${NOISE}
vec3 bump(vec3 pos, vec3 n, float h, float k) {
  vec3 dpdx = dFdx(pos), dpdy = dFdy(pos);
  float hx = dFdx(h) * k, hy = dFdy(h) * k;
  vec3 r1 = cross(dpdy, n), r2 = cross(n, dpdx);
  float det = dot(dpdx, r1);
  return normalize(abs(det) * n - sign(det) * (hx * r1 + hy * r2));
}
void main() {
  #include <clipping_planes_fragment>
  if (vVis < 0.5) discard;
  vec3 V = normalize(vV);
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) {
    // the inside of a surface shell is not anatomy: draw it as a flat, dark, clearly non-tissue backing
    gl_FragColor = vec4(uInside * (0.55 + 0.45 * max(dot(-N, V), 0.0)), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    return;
  }
  // micro-relief and mottling (rendering only). Heights are in mm, view space is in metres; every octave fades out
  // before it can alias, so the surface reads as satin from afar and gains grain only when the camera is close.
  float px = length(fwidth(vP));
  float f1 = 1.0 - smoothstep(0.10, 0.32, px * 0.5);
  float f2 = 1.0 - smoothstep(0.10, 0.32, px * 1.9);
  float fine = vnoise(vP * 0.5) * 0.7 * f1 + vnoise(vP * 1.9) * 0.3 * f2;
  float blot = vnoise(vP * 0.16 + 11.0);
  N = bump(-vV, N, fine, uMicro * 0.001);

  float ao = clamp(vAo, 0.0, 1.0);
  float fold = smoothstep(0.06, 0.58, ao);                 // 0 deep in a fold, 1 on a crown
  vec3 albedo = mix(uDeep, uBase, fold);
  albedo *= 0.95 + 0.10 * blot;
  albedo = mix(albedo, albedo * vec3(0.86, 0.90, 1.14), smoothstep(0.45, 0.95, vnoise(vP * 0.045 + 3.7)) * 0.45);   // lavender drift

  // key: wrapped diffuse; the wrap zone is tinted warm (light that has travelled through tissue)
  float ndl = dot(N, uKeyDir);
  float wrap = 0.36;
  float d = clamp((ndl + wrap) / (1.0 + wrap), 0.0, 1.0);
  vec3 col = albedo * uKeyCol * (d * d) * mix(0.22, 1.0, ao);
  float term = smoothstep(-0.55, 0.05, ndl) * (1.0 - smoothstep(0.05, 0.75, ndl));
  col += albedo * uSss * term * (0.45 + 0.55 * ao);

  // fill and hemispheric ambient, both shadowed by the baked occlusion (tinted, so folds go crimson rather than black)
  float nf = clamp(dot(N, uFillDir) * 0.5 + 0.5, 0.0, 1.0);
  col += albedo * uFillCol * nf * nf * mix(0.45, 1.0, ao);
  col += albedo * mix(uGround, uSky, smoothstep(-0.6, 0.9, N.y)) * (0.30 + 0.70 * ao * ao);
  // the side turned away from the key cools towards lavender
  float away = smoothstep(0.15, -0.65, ndl) * clamp(-N.x * 0.6 + 0.55, 0.0, 1.0);
  col += albedo * vec3(0.34, 0.40, 1.0) * away * 0.34 * ao;

  // cool rim
  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.6);
  float rimSide = clamp(dot(N, uRimDir) * 0.70 + 0.42, 0.0, 1.0);
  col += uRimCol * fres * rimSide * smoothstep(0.12, 0.62, ao);

  // highlights: a broad satin lobe and a small wet one, both occluded in folds
  vec3 H = normalize(uKeyDir + V);
  float nh = max(dot(N, H), 0.0);
  float lit = smoothstep(0.0, 0.25, ndl);
  col += uKeyCol * vec3(0.90, 0.90, 1.0) * (pow(nh, 9.0) * 0.14 + pow(nh, 56.0) * 0.15 + pow(nh, 260.0) * 0.20) * uGloss * ao * lit;
  vec3 H2 = normalize(uRimDir + V);
  col += uRimCol * pow(max(dot(N, H2), 0.0), 40.0) * 0.20 * uGloss * ao;

  // selection and hover as light: the rest of the brain recedes, the region keeps its colour, and its border is the
  // 0.5 contour of a smoothed selection field — a clean line with a soft glow just inside it
  #ifdef SPECIMEN
    float sel = smoothstep(0.40, 0.60, vSel);
    float selEdge = 1.0 - smoothstep(0.6, 1.9, abs(vSel - 0.5) / max(fwidth(vSel), 1e-5));
    float selGlow = smoothstep(0.30, 0.55, vSel) * (1.0 - smoothstep(0.55, 0.98, vSel));
  #else
    float sel = clamp(vSel, 0.0, 1.0), selEdge = 0.0, selGlow = 0.0;
  #endif
  float hov = clamp(vHov, 0.0, 1.0);
  float dim = uDim * (1.0 - sel);
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, vec3(lum) * vec3(0.74, 0.78, 1.04), dim * 0.50) * mix(1.0, 0.56, dim);
  col *= 1.0 + 0.12 * sel + 0.10 * hov * (1.0 - sel);
  col += uSelCol * (selGlow * 0.16 + sel * fres * 0.30);
  col = mix(col, uSelCol * 1.15, selEdge * 0.85);
  float band = smoothstep(0.08, 0.85, vBorder);
  float rimH = band * smoothstep(0.02, 0.45, hov) * (1.0 - sel);
  col += uHovCol * (rimH * rimH * 0.40 + hov * (1.0 - sel) * (0.05 + fres * 0.36));

  // region borders: where the two strongest class fields meet. The tint only tells neighbours apart.
  #ifdef SPECIMEN
    float m1 = 0.0, m2 = 0.0, cls = 0.0;
    #define TOP(x, i) if (x > m1) { m2 = m1; m1 = x; cls = i; } else if (x > m2) { m2 = x; }
    TOP(vPa.x, 0.0) TOP(vPa.y, 1.0) TOP(vPa.z, 2.0) TOP(vPa.w, 3.0) TOP(vPb.x, 4.0) TOP(vPb.y, 5.0) TOP(vPb.z, 6.0) TOP(vPb.w, 7.0)
    float gap = m1 - m2;
    float line = (1.0 - smoothstep(0.5, 1.7, gap / max(fwidth(gap), 1e-5))) * uParcels * step(0.01, m1);
    vec3 tint = 0.5 + 0.5 * cos(6.2832 * (cls * 0.125 + vec3(0.02, 0.36, 0.69)));
    col *= mix(vec3(1.0), 0.72 + 0.56 * tint, 0.42 * uParcels * (1.0 - sel));
    col = mix(col, vec3(0.90, 0.96, 1.0), line * 0.62 * (1.0 - 0.7 * sel));
  #endif

  gl_FragColor = vec4(col * uExposure, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const GHOST_FRAG = /* glsl */ `
#include <common>
#include <clipping_planes_pars_fragment>
uniform vec3 uGhostA; uniform vec3 uGhostB; uniform vec3 uSelCol; uniform vec3 uHovCol; uniform float uStrength;
varying vec3 vN; varying vec3 vV; varying vec3 vP;
varying float vAo; varying float vSel; varying float vHov; varying float vVis; varying float vBorder;
void main() {
  #include <clipping_planes_fragment>
  if (vVis < 0.5) discard;
  // one layer of glass (a depth pre-pass keeps only the nearest surface): rim light on the crowns, folds stay dark
  float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
  float a = (0.035 + 0.50 * fres) * (0.30 + 0.70 * smoothstep(0.15, 0.75, vAo)) * uStrength;
  vec3 c = mix(uGhostA, uGhostB, fres);
  c = mix(c, uSelCol, clamp(vSel, 0.0, 1.0) * 0.7);
  a = max(a, clamp(vSel, 0.0, 1.0) * 0.16);
  c = mix(c, uHovCol, clamp(vHov, 0.0, 1.0) * 0.5);
  gl_FragColor = vec4(c * a, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const lin = (hex: string) => new Color(hex);            // three converts sRGB hex to linear working space
const v3 = (c: Color) => new Vector3(c.r, c.g, c.b);

/** Camera-relative light rig (view space: +x right, +y up, +z towards the viewer). */
export const RIG = {
  keyDir: new Vector3(-0.52, 0.62, 0.58).normalize(),
  keyCol: v3(lin('#F4EEFF')).multiplyScalar(1.55),
  rimDir: new Vector3(-0.82, 0.28, -0.50).normalize(),
  rimCol: v3(lin('#62BCFF')).multiplyScalar(1.7),
  fillDir: new Vector3(0.86, -0.30, 0.42).normalize(),
  fillCol: v3(lin('#F04A86')).multiplyScalar(0.25),
  sky: v3(lin('#7C8AF0')).multiplyScalar(0.36),
  ground: v3(lin('#8A2452')).multiplyScalar(0.22),
  sss: v3(lin('#FF4470')).multiplyScalar(0.20),
  inside: v3(lin('#150B1E')),
};

function baseUniforms(tone: { base: string; deep: string; gloss: number }) {
  return {
    uBase: { value: v3(lin(tone.base)) }, uDeep: { value: v3(lin(tone.deep)) }, uSss: { value: RIG.sss },
    uKeyDir: { value: RIG.keyDir }, uKeyCol: { value: RIG.keyCol }, uRimDir: { value: RIG.rimDir }, uRimCol: { value: RIG.rimCol },
    uFillDir: { value: RIG.fillDir }, uFillCol: { value: RIG.fillCol }, uSky: { value: RIG.sky }, uGround: { value: RIG.ground },
    uSelCol: { value: v3(lin(SELECT_COLOR)) }, uHovCol: { value: v3(lin(HOVER_COLOR)) }, uInside: { value: RIG.inside },
    uDim: { value: 0 }, uParcels: { value: 0 }, uGloss: { value: tone.gloss }, uMicro: { value: 0.16 }, uExposure: { value: 1.0 },
  };
}

/** One RGBA texel per structure index: R selected, G hovered, B visible. Index 0 = "no region". */
export function makeStateTexture(): DataTexture {
  const data = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) data[i * 4 + 2] = 255;
  const t = new DataTexture(data, 256, 1, RGBAFormat, UnsignedByteType);
  t.minFilter = NearestFilter; t.magFilter = NearestFilter; t.generateMipmaps = false; t.needsUpdate = true;
  return t;
}

export function specimenMaterial(state: DataTexture): ShaderMaterial {
  return new ShaderMaterial({
    name: 'tissue-specimen', defines: { SPECIMEN: '' }, vertexShader: VERT, fragmentShader: FRAG, clipping: true, side: FrontSide,
    uniforms: { ...baseUniforms(TISSUE_TONES.cortex), uState: { value: state }, uHemi: { value: new Vector2(1, 1) } },
  });
}

export function ghostMaterial(state: DataTexture): ShaderMaterial {
  return new ShaderMaterial({
    name: 'tissue-ghost', defines: { SPECIMEN: '' }, vertexShader: VERT, fragmentShader: GHOST_FRAG, clipping: true, side: FrontSide,
    transparent: true, depthWrite: false, depthFunc: LessEqualDepth, blending: NormalBlending, premultipliedAlpha: true,
    uniforms: {
      uState: { value: state }, uHemi: { value: new Vector2(1, 1) }, uStrength: { value: 1 },
      uGhostA: { value: v3(lin('#3B4FA8')) }, uGhostB: { value: v3(lin('#B9D4FF')) },
      uSelCol: { value: v3(lin(SELECT_COLOR)) }, uHovCol: { value: v3(lin(HOVER_COLOR)) },
    },
  });
}

/**
 * Depth-only twin of the ghost shell. Drawn just before it, it leaves the nearest layer of the surface in the depth
 * buffer, so the see-through shell is one clean sheet of glass instead of dozens of overlapping fold walls.
 */
export function ghostDepthMaterial(ghost: ShaderMaterial): ShaderMaterial {
  return new ShaderMaterial({
    name: 'tissue-ghost-depth', defines: { SPECIMEN: '' }, vertexShader: VERT, fragmentShader: GHOST_FRAG, clipping: true, side: FrontSide,
    transparent: true, depthWrite: true, colorWrite: false, uniforms: ghost.uniforms,
  });
}

/** Material for one atlas structure mesh (region state as a uniform). */
export function structureMaterial(tissue: Tissue): ShaderMaterial {
  return new ShaderMaterial({
    name: 'tissue-structure', vertexShader: VERT, fragmentShader: FRAG, clipping: true, side: FrontSide,
    uniforms: { ...baseUniforms(TISSUE_TONES[tissue]), uRegionState: { value: new Vector4(0, 0, 1, 0) } },
  });
}

export function setClip(m: ShaderMaterial, plane: Plane | null) {
  const had = (m.clippingPlanes?.length ?? 0) > 0;
  m.clippingPlanes = plane ? [plane] : [];
  const side = plane && !m.name.startsWith('tissue-ghost') ? DoubleSide : FrontSide;
  if (had !== !!plane || m.side !== side) { m.side = side; m.needsUpdate = true; }
}

// ── the MRI on the cut face ─────────────────────────────────────────────────────────────────────────────────────
export const SLICE_VERT = /* glsl */ `
varying vec3 vRas;
void main() { vRas = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

export const SLICE_FRAG = /* glsl */ `
precision highp sampler3D;
uniform sampler3D uT1; uniform sampler3D uRegion; uniform sampler2D uState;
uniform vec3 uOrigin; uniform vec3 uDims; uniform vec3 uSelCol; uniform vec3 uHovCol; uniform float uDim;
varying vec3 vRas;
void main() {
  vec3 uvw = (vRas - uOrigin + 0.5) / uDims;
  if (any(lessThan(uvw, vec3(0.0))) || any(greaterThan(uvw, vec3(1.0)))) discard;
  float t = texture(uT1, uvw).r;
  float alpha = smoothstep(0.006, 0.05, t);
  if (alpha < 0.01) discard;
  float id = floor(texture(uRegion, uvw).r * 255.0 + 0.5);
  vec4 st = texelFetch(uState, ivec2(int(id), 0), 0);
  float g = pow(clamp(t * 1.12, 0.0, 1.0), 0.92);
  vec3 col = vec3(g) * vec3(0.93, 0.95, 1.0);
  col = mix(col, col * 0.55, uDim * (1.0 - st.r));
  col = mix(col, mix(col, uSelCol, 0.45) + uSelCol * 0.08, st.r);
  col = mix(col, mix(col, uHovCol, 0.35), st.g * (1.0 - st.r));
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
}`;

