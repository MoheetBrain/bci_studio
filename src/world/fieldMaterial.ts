// The tissue material of the neural world: one shader for the model's cells and (dimmed) for the backdrop.
//
// Two different kinds of thing are drawn by it and they are kept apart on purpose:
//   APPEARANCE (illustrative)   soft key light, lavender sky fill, cool rim, slight mottling, depth haze;
//   MODEL STATE (from snapshots) uAct  — how close a cell's membrane is to threshold (warm glow in the body),
//                                uFlash — a spike event just happened (brief bright flash),
//                                uDim  — the player switched the cell off (grey + diagonal hatching, so it does not
//                                        depend on colour), uSel / uHover — selection and aim (bright outline).
// A "display cutaway" fades anything closer than a few µm to the camera, so flying into a cell body never fills the
// view with its inside. It changes what is drawn, not the tissue.
import { Color, DoubleSide, ShaderMaterial, Vector3 } from 'three';
import { MAX_CELLS } from './runtime';

export const FOG_COLOR = new Color('#0B0817');
export const FOG_DENSITY = 0.0017;

export const TINTS: Record<string, Color> = {
  exc: new Color('#E79AB6'), inh: new Color('#9C8FE8'), input: new Color('#F1B58F'),
  near: new Color('#F29BC0'), mid: new Color('#B79AE6'), far: new Color('#7F78B8'),
};

const VERT = /* glsl */ `
attribute float aCell; attribute float aKind; attribute float aAlong;
uniform float uAct[${MAX_CELLS}]; uniform float uFlash[${MAX_CELLS}]; uniform float uDim[${MAX_CELLS}]; uniform vec3 uTint[${MAX_CELLS}];
uniform float uSel; uniform float uHover; uniform float uBackdrop;
varying vec3 vN; varying vec3 vW; varying vec3 vTint; varying float vAct; varying float vFlash; varying float vDim; varying float vMark; varying float vKind; varying float vAlong;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vKind = aKind; vAlong = aAlong;
  if (uBackdrop > 0.5) { vAct = 0.0; vFlash = 0.0; vDim = 0.0; vMark = 0.0; vTint = vec3(0.19, 0.15, 0.30); }
  else {
    int i = int(aCell + 0.5);
    vAct = uAct[i]; vFlash = uFlash[i]; vDim = uDim[i]; vTint = uTint[i];
    vMark = abs(aCell - uSel) < 0.5 ? 1.0 : (abs(aCell - uHover) < 0.5 ? 0.45 : 0.0);
  }
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAG = /* glsl */ `
uniform vec3 uFogColor; uniform float uFogDensity; uniform float uFadeNear; uniform float uFadeFar; uniform float uBackdrop;
varying vec3 vN; varying vec3 vW; varying vec3 vTint; varying float vAct; varying float vFlash; varying float vDim; varying float vMark; varying float vKind; varying float vAlong;
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
void main() {
  vec3 V = cameraPosition - vW; float dist = length(V); V /= dist;
  // display cutaway: dithered fade of whatever is right in front of the lens
  float keep = smoothstep(uFadeNear, uFadeFar, dist);
  float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  if (keep < dither) discard;
  vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;
  float mott = noise(vW * 0.21) * 0.62 + noise(vW * 0.83) * 0.38;
  vec3 base = vTint * (0.80 + 0.34 * mott);
  if (vKind > 1.5) base = mix(base, vec3(0.62, 0.60, 0.82), 0.4);
  vec3 L = normalize(vec3(-0.46, 0.80, 0.39));
  float nl = dot(N, L), wrap = clamp((nl + 0.55) / 1.55, 0.0, 1.0);
  vec3 key = vec3(1.0, 0.92, 0.88) * wrap * wrap * 1.25;
  vec3 sky = mix(vec3(0.09, 0.06, 0.19), vec3(0.40, 0.33, 0.56), N.y * 0.5 + 0.5);
  float thin = step(0.5, vKind);
  vec3 col = base * (key + sky) + base * vec3(1.0, 0.52, 0.60) * clamp(0.3 - nl * 0.5, 0.0, 1.0) * (0.10 + 0.22 * thin);
  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.6);
  col += vec3(0.30, 0.56, 0.92) * fres * (0.50 - 0.28 * uBackdrop);
  col += vec3(1.0) * pow(max(dot(N, normalize(L + V)), 0.0), 46.0) * 0.16 * (1.0 - uBackdrop);
  // model state
  float body = mix(1.0, 0.22, smoothstep(0.0, 0.55, vAlong));
  col += vec3(1.0, 0.66, 0.36) * vAct * 0.62 * body;
  col += vec3(1.0, 0.94, 0.80) * vFlash * (1.7 * body + 0.3);
  if (vDim > 0.5) {
    float g = dot(col, vec3(0.30, 0.50, 0.20));
    col = mix(vec3(g), col, 0.12) * (0.42 + 0.30 * step(0.5, fract((gl_FragCoord.x + gl_FragCoord.y) / 9.0)));
  }
  col += vec3(0.72, 0.95, 1.0) * (fres * 1.5 + 0.05) * vMark;
  col = 1.0 - exp(-col * 1.22);
  // the model's own cells stay clearer than the backdrop at the same distance
  col = mix(col, uFogColor, clamp(1.0 - exp(-uFogDensity * (0.5 + 1.25 * uBackdrop) * dist), 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

export function makeFieldMaterial(backdrop: boolean): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, side: DoubleSide, toneMapped: false,
    uniforms: {
      uAct: { value: new Float32Array(MAX_CELLS) }, uFlash: { value: new Float32Array(MAX_CELLS) }, uDim: { value: new Float32Array(MAX_CELLS) },
      uTint: { value: Array.from({ length: MAX_CELLS }, () => new Vector3(0.8, 0.5, 0.6)) },
      uSel: { value: -9 }, uHover: { value: -9 }, uBackdrop: { value: backdrop ? 1 : 0 },
      uFogColor: { value: FOG_COLOR.clone() }, uFogDensity: { value: FOG_DENSITY }, uFadeNear: { value: 3 }, uFadeFar: { value: 13 },
    },
  });
}
