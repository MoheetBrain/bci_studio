// Screen-space selection / hover outline: the meshes of the selected (hovered) part are rendered
// into a small mask target, and a thin edge in the accent colour is composited over the frame.
// Runs after the HUD pass (priority 2) so it never changes how the scene itself is lit.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Color, DoubleSide, Mesh, MeshBasicMaterial, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial, Vector2, WebGLRenderTarget, type Object3D } from 'three';
import { useScene } from '../state/sceneStore';
import { COMPONENTS } from '../model/components';
import { OUTLINE_LAYER_HOVER, OUTLINE_LAYER_SELECTED, registry, runtime, useView } from './viewStore';
import { themeColors } from './theme';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const FRAG = /* glsl */ `
uniform sampler2D tMask;
uniform vec2 uTexel;
uniform vec3 uColor;
uniform float uHover;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(tMask, vUv);
  float sR = 0.0, sG = 0.0;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.7853981634;
    vec2 o = vec2(cos(a), sin(a)) * uTexel;
    vec4 n = texture2D(tMask, vUv + o);
    sR = max(sR, n.r);
    sG = max(sG, n.g);
  }
  float edgeSel = sR * (1.0 - c.r);
  float edgeHov = sG * (1.0 - c.g) * (1.0 - c.r) * (1.0 - sR);
  float a = max(edgeSel, edgeHov * uHover);
  if (a < 0.02) discard;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}`;

function meshesOf(id: string | null, out: Object3D[]) {
  if (!id) return;
  const root = registry.get(id);
  if (!root) return;
  const lvl = COMPONENTS[id]?.level;
  if (lvl !== 'system' && lvl !== 'package' && lvl !== 'die') return;
  if (!runtime.levelActive[lvl]) return;
  root.traverse((o) => {
    const m = o as Mesh & { isLine2?: boolean; isLineSegments2?: boolean; isSprite?: boolean };
    // fat lines (drei <Line>) carry instanced segment attributes the mask material cannot draw
    if (m.isLine2 || m.isLineSegments2 || m.isSprite) return;
    if (m.isMesh && o.visible && !o.userData.noOutline) out.push(o);
  });
}

function shown(o: Object3D): boolean {
  let p: Object3D | null = o;
  while (p) {
    if (!p.visible) return false;
    p = p.parent;
  }
  return true;
}

export function SelectionOutline() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const rt = useMemo(() => new WebGLRenderTarget(2, 2, { depthBuffer: false, stencilBuffer: false }), []);
  const maskMat = useMemo(() => new MeshBasicMaterial({ color: '#ffffff', side: DoubleSide, depthTest: false, depthWrite: false, toneMapped: false, fog: false }), []);
  const quad = useMemo(() => {
    const mat = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { tMask: { value: rt.texture }, uTexel: { value: new Vector2(1 / 512, 1 / 512) }, uColor: { value: new Color('#176B62') }, uHover: { value: 0.5 } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const s = new Scene();
    const m = new Mesh(new PlaneGeometry(2, 2), mat);
    m.frustumCulled = false;
    s.add(m);
    return { scene: s, mat, cam: new OrthographicCamera(-1, 1, 1, -1, 0, 1) };
  }, [rt]);
  const marked = useRef<Object3D[]>([]);
  const tmp = useMemo(() => ({ sel: [] as Object3D[], hov: [] as Object3D[] }), []);

  useEffect(() => () => {
    rt.dispose();
    maskMat.dispose();
    quad.mat.dispose();
  }, [rt, maskMat, quad]);

  useFrame(() => {
    // clear last frame's layer marks
    for (const o of marked.current) {
      o.layers.disable(OUTLINE_LAYER_SELECTED);
      o.layers.disable(OUTLINE_LAYER_HOVER);
    }
    marked.current.length = 0;
    if (runtime.transitionActive || useView.getState().transitioning) return;
    const s = useScene.getState();
    tmp.sel.length = 0;
    tmp.hov.length = 0;
    meshesOf(s.selectedId, tmp.sel);
    if (s.hoveredId && s.hoveredId !== s.selectedId) meshesOf(s.hoveredId, tmp.hov);
    if (tmp.sel.length === 0 && tmp.hov.length === 0) return;
    for (const o of tmp.sel) if (shown(o)) (o.layers.enable(OUTLINE_LAYER_SELECTED), marked.current.push(o));
    for (const o of tmp.hov) if (shown(o)) (o.layers.enable(OUTLINE_LAYER_HOVER), marked.current.push(o));
    if (marked.current.length === 0) return;

    const dpr = gl.getPixelRatio();
    const w = Math.max(2, Math.floor(size.width * dpr * 0.5));
    const h = Math.max(2, Math.floor(size.height * dpr * 0.5));
    if (rt.width !== w || rt.height !== h) {
      rt.setSize(w, h);
      quad.mat.uniforms.uTexel.value.set(1.5 / w, 1.5 / h);
    }
    const prevTarget = gl.getRenderTarget();
    const prevAutoClear = gl.autoClear;
    const prevBg = scene.background;
    const prevOverride = scene.overrideMaterial;
    const prevMask = camera.layers.mask;
    const prevClear = new Color();
    gl.getClearColor(prevClear);
    const prevAlpha = gl.getClearAlpha();

    scene.background = null;
    scene.overrideMaterial = maskMat;
    gl.setRenderTarget(rt);
    gl.setClearColor(0x000000, 0);
    gl.clear(true, false, false);
    gl.autoClear = false;
    if (tmp.sel.length) {
      maskMat.color.setRGB(1, 0, 0);
      camera.layers.set(OUTLINE_LAYER_SELECTED);
      gl.render(scene, camera);
    }
    if (tmp.hov.length) {
      maskMat.color.setRGB(0, 1, 0);
      camera.layers.set(OUTLINE_LAYER_HOVER);
      gl.render(scene, camera);
    }
    camera.layers.mask = prevMask;
    scene.overrideMaterial = prevOverride;
    scene.background = prevBg;
    gl.setRenderTarget(prevTarget);
    gl.setClearColor(prevClear, prevAlpha);

    quad.mat.uniforms.uColor.value.copy(themeColors.accent);
    gl.render(quad.scene, quad.cam);
    gl.autoClear = prevAutoClear;
  }, 2);

  return null;
}
