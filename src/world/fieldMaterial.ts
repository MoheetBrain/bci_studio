// The tissue material of the neural world: one shader for the model's cells and (dimmed) for the backdrop.
//
// Two different kinds of thing are drawn by it and they are kept apart on purpose:
//   APPEARANCE (illustrative)   a soft key light from the side of the cortical surface, a warm bounce from below, a
//                               cool rim, slight mottling and micro-relief, and a haze that takes the colour of the
//                               "sky" behind it (rosy towards the surface, indigo towards the white matter), so depth
//                               and "which way is up" can be read at a glance;
//   MODEL STATE (from snapshots) uAct  — how close a cell's membrane is to threshold (warm glow in the body),
//                                uFlash — a spike event just happened (brief bright flash),
//                                uDim  — 1: the player switched the cell off (grey + diagonal hatching, so it does not
//                                        depend on colour); 0.5: the cell's model is not the one running right now
//                                        (quietly desaturated), uSel / uHover — selection and aim (bright outline).
// The glow and the flash are an EXPLANATORY OVERLAY of model state. Tissue does not light up when a neuron fires.
// A "display cutaway" fades anything closer than a few µm to the camera, so flying into a cell body never fills the
// view with its inside. It changes what is drawn, not the tissue.
import { BackSide, Color, DoubleSide, ShaderMaterial, Vector3 } from 'three';
import { MAX_CELLS } from './runtime';

/** Haze colours by direction (sRGB hex; converted to the linear working space once). */
export const SKY = { deep: new Color('#05040C'), mid: new Color('#140C24'), top: new Color('#43213F') };
export const FOG_COLOR = SKY.mid.clone();
export const FOG_DENSITY = 0.0017;

export const TINTS: Record<string, Color> = {
  exc: new Color('#E79AB6'), inh: new Color('#9C8FE8'), input: new Color('#F1B58F'),
  near: new Color('#C3AEEF'), mid: new Color('#9A90DC'), far: new Color('#6F6CB0'),
};

/** sky(d): the colour of the haze in direction d (unit vector, +y towards the cortical surface). */
export const SKY_GLSL = /* glsl */ `
uniform vec3 uSkyDeep; uniform vec3 uSkyMid; uniform vec3 uSkyTop;
vec3 sky(vec3 d) {
  float up = smoothstep(0.0, 1.0, d.y);
  vec3 c = mix(uSkyDeep, uSkyMid, smoothstep(-0.95, 0.08, d.y));
  return mix(c, uSkyTop, up * up * (3.0 - 2.0 * up) * 0.92);
}`;
const v3 = (c: Color) => new Vector3(c.r, c.g, c.b);
export const skyUniforms = () => ({ uSkyDeep: { value: v3(SKY.deep) }, uSkyMid: { value: v3(SKY.mid) }, uSkyTop: { value: v3(SKY.top) } });

const NOISE = /* glsl */ `
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`;

const VERT = /* glsl */ `
attribute float aCell; attribute float aKind; attribute float aAlong; attribute float aTip;
uniform float uAct[${MAX_CELLS}]; uniform float uFlash[${MAX_CELLS}]; uniform float uDim[${MAX_CELLS}]; uniform vec3 uTint[${MAX_CELLS}];
uniform float uSel; uniform float uHover; uniform float uBackdrop;
varying vec3 vN; varying vec3 vW; varying vec3 vTint; varying float vAct; varying float vFlash; varying float vDim; varying float vMark; varying float vKind; varying float vAlong; varying float vTip;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vKind = aKind; vAlong = aAlong; vTip = aTip;
  if (uBackdrop > 0.5) { vAct = 0.0; vFlash = 0.0; vDim = 0.0; vMark = 0.0; vTint = vec3(0.30, 0.20, 0.36); }
  else {
    int i = int(aCell + 0.5);
    vAct = uAct[i]; vFlash = uFlash[i]; vDim = uDim[i]; vTint = uTint[i];
    vMark = abs(aCell - uSel) < 0.5 ? 1.0 : (abs(aCell - uHover) < 0.5 ? 0.45 : 0.0);
  }
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAG = /* glsl */ `
uniform float uFogDensity; uniform float uFadeNear; uniform float uFadeFar; uniform float uBackdrop;
varying vec3 vN; varying vec3 vW; varying vec3 vTint; varying float vAct; varying float vFlash; varying float vDim; varying float vMark; varying float vKind; varying float vAlong; varying float vTip;
${SKY_GLSL}
${NOISE}
void main() {
  vec3 V = cameraPosition - vW; float dist = length(V); V /= dist;
  float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  // display cutaway: dithered fade of whatever is right in front of the lens
  if (smoothstep(uFadeNear, uFadeFar, dist) < dither) discard;
  // the last stretch of a branch thins out into the haze instead of ending in a cut
  if (vTip > 0.0 && 1.0 - smoothstep(0.55, 1.0, vTip) < dither * 0.999) discard;
  vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;
  // micro-relief on bodies and thick trunks (rendering only), fading out before it could shimmer
  float px = length(fwidth(vW));
  float relief = (1.0 - smoothstep(0.35, 1.3, px)) * (1.0 - uBackdrop) * (1.0 - smoothstep(0.0, 0.5, vAlong));
  if (relief > 0.01) {
    float e = 0.9;
    vec3 g = vec3(noise(vW * 0.9 + vec3(e, 0, 0)) - noise(vW * 0.9 - vec3(e, 0, 0)), noise(vW * 0.9 + vec3(0, e, 0)) - noise(vW * 0.9 - vec3(0, e, 0)), noise(vW * 0.9 + vec3(0, 0, e)) - noise(vW * 0.9 - vec3(0, 0, e)));
    N = normalize(N - (g - dot(g, N) * N) * 0.55 * relief);
  }
  float mott = noise(vW * 0.21) * 0.62 + noise(vW * 0.83) * 0.38;
  vec3 base = vTint * (0.78 + 0.36 * mott);
  if (vKind > 1.5) base = mix(base, vec3(0.62, 0.60, 0.82), 0.4);
  // the body is denser than its branches; where a branch leaves the body it sits in the body's shade
  float thin = step(0.5, vKind);
  float root = thin * (1.0 - smoothstep(0.03, 0.16, vAlong));
  base *= 1.0 - 0.22 * root;

  // key: from the side of the cortical surface, wrapped so that small round things do not go black behind
  vec3 L = normalize(vec3(-0.42, 0.82, 0.38));
  float nl = dot(N, L), wrap = clamp((nl + 0.6) / 1.6, 0.0, 1.0);
  vec3 key = vec3(1.0, 0.93, 0.95) * wrap * wrap * 1.32;
  // ambient: whatever the haze looks like in the direction the surface faces
  vec3 amb = sky(N) * 4.6 + vec3(0.035, 0.03, 0.06);
  // warm bounce from below and behind
  float nb = clamp(dot(N, normalize(vec3(0.5, -0.78, -0.36))) * 0.5 + 0.5, 0.0, 1.0);
  vec3 col = base * (key + amb) + base * vec3(1.0, 0.36, 0.46) * nb * nb * (0.20 + 0.14 * thin);
  // light that has passed through thin tissue: branches glow a little where they turn away from the key
  col += base * vec3(1.0, 0.48, 0.56) * clamp(0.25 - nl * 0.5, 0.0, 1.0) * 0.22 * thin;
  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.4);
  col += mix(vec3(0.36, 0.58, 0.98), vec3(0.98, 0.50, 0.66), clamp(N.x * 0.5 + 0.5 - N.y * 0.3, 0.0, 1.0)) * fres * (0.46 - 0.26 * uBackdrop);
  vec3 H = normalize(L + V);
  float nh = max(dot(N, H), 0.0);
  col += vec3(1.0, 0.96, 1.0) * (pow(nh, 14.0) * 0.10 + pow(nh, 70.0) * 0.14) * (1.0 - uBackdrop) * smoothstep(0.0, 0.3, nl);

  // model state (an overlay; see the header)
  float body = mix(1.0, 0.20, smoothstep(0.0, 0.55, vAlong));
  col += vec3(1.0, 0.62, 0.30) * vAct * 0.66 * body;
  col += vec3(1.0, 0.93, 0.78) * vFlash * (1.7 * body + 0.10);
  if (vDim > 0.75) {
    float g = dot(col, vec3(0.30, 0.50, 0.20));
    col = mix(vec3(g), col, 0.12) * (0.42 + 0.30 * step(0.5, fract((gl_FragCoord.x + gl_FragCoord.y) / 9.0)));
  } else if (vDim > 0.0) {
    float g = dot(col, vec3(0.30, 0.50, 0.20));
    col = mix(col, vec3(g) * vec3(0.92, 0.94, 1.08), vDim * 0.9) * (1.0 - 0.36 * vDim);
  }
  col += vec3(0.72, 0.95, 1.0) * (fres * 1.5 + 0.05) * vMark;
  col = 1.0 - exp(-col * 1.18);
  // haze: the model's own cells stay clearer than the backdrop at the same distance
  float fog = clamp(1.0 - exp(-uFogDensity * (0.5 + 1.25 * uBackdrop) * dist), 0.0, 1.0);
  col = mix(col, sky(-V), fog);
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
      uFogDensity: { value: FOG_DENSITY }, uFadeNear: { value: 3 }, uFadeFar: { value: 13 }, ...skyUniforms(),
    },
  });
}

/** The inside of a very large sphere, coloured by direction: what the haze fades into. */
export function makeSkyMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    side: BackSide, depthWrite: false, toneMapped: false, fog: false, uniforms: skyUniforms(),
    vertexShader: /* glsl */ `varying vec3 vD; void main() { vD = normalize(position); vec4 p = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: /* glsl */ `varying vec3 vD; ${SKY_GLSL}
      float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() { vec3 c = sky(normalize(vD)); c += (h2(gl_FragCoord.xy) - 0.5) * 0.0035; gl_FragColor = vec4(c, 1.0);
      #include <colorspace_fragment>
      }`,
  });
}

/** Fine fibres and drifting specks between the cells: scenery that gives the space a grain. No model is in them. */
export function makeHazeMaterial(points: boolean): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true, depthWrite: false, toneMapped: false, fog: false,
    uniforms: { uFogDensity: { value: FOG_DENSITY }, uTime: { value: 0 }, uScale: { value: 600 }, ...skyUniforms() },
    vertexShader: /* glsl */ `
      attribute float aSeed; uniform float uTime; uniform float uScale; varying float vDist; varying float vSeed; varying vec3 vDir;
      void main() {
        vec3 p = position;
        ${points ? 'p += vec3(sin(uTime * 0.11 + aSeed * 40.0), cos(uTime * 0.09 + aSeed * 71.0), sin(uTime * 0.07 + aSeed * 13.0)) * 5.0;' : ''}
        vec4 mv = viewMatrix * modelMatrix * vec4(p, 1.0);
        vDist = length(mv.xyz); vSeed = aSeed; vDir = normalize((modelMatrix * vec4(p, 1.0)).xyz - cameraPosition);
        gl_Position = projectionMatrix * mv;
        ${points ? 'gl_PointSize = clamp((1.1 + 2.2 * aSeed) * uScale / vDist, 1.0, 7.0);' : ''}
      }`,
    fragmentShader: /* glsl */ `
      uniform float uFogDensity; varying float vDist; varying float vSeed; varying vec3 vDir;
      ${SKY_GLSL}
      void main() {
        float a = ${points ? '(1.0 - smoothstep(0.15, 0.5, length(gl_PointCoord - 0.5))) * 0.34' : '0.16 + 0.22 * vSeed'};
        a *= exp(-uFogDensity * 1.5 * vDist) * smoothstep(6.0, 40.0, vDist);
        vec3 c = mix(vec3(0.74, 0.56, 0.86), vec3(0.98, 0.72, 0.80), vSeed) * ${points ? '1.0' : '0.62'};
        gl_FragColor = vec4(mix(c, sky(vDir), 0.35), a);
        #include <colorspace_fragment>
      }`,
  });
}

/** Soft discs that swell briefly where a model cell has just fired. An overlay of model state, drawn over the scene. */
export function makeHaloMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: true, toneMapped: false, fog: false,
    uniforms: { uFlash: { value: new Float32Array(MAX_CELLS) }, uScale: { value: 600 } },
    vertexShader: /* glsl */ `
      attribute float aIdx; attribute float aRadius; uniform float uFlash[${MAX_CELLS}]; uniform float uScale; varying float vF;
      void main() {
        vF = uFlash[int(aIdx + 0.5)];
        vec4 mv = viewMatrix * modelMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = vF > 0.01 ? clamp(aRadius * (3.2 + 4.2 * (1.0 - vF)) * uScale / -mv.z, 3.0, 220.0) : 0.0;
      }`,
    fragmentShader: /* glsl */ `
      varying float vF;
      void main() {
        if (vF <= 0.01) discard;
        float r = length(gl_PointCoord - 0.5) * 2.0, a = (1.0 - smoothstep(0.0, 1.0, r)); a = a * a * vF * 0.55;
        gl_FragColor = vec4(vec3(1.0, 0.80, 0.52) * a, a);
        #include <colorspace_fragment>
      }`,
    blending: 2 /* AdditiveBlending */, premultipliedAlpha: true,
  });
}
