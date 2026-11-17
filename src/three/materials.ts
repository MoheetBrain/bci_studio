// Material presets (spread into per-mesh JSX materials so every mesh owns its material instance —
// parts fade/highlight their own materials, so presets must never be shared instances) and
// procedural canvas textures (offline: no fonts or images are fetched).
import { CanvasTexture, Color, RepeatWrapping, SRGBColorSpace } from 'three';
import type { Material, MeshStandardMaterial } from 'three';

// Paper & Graphite palette: muted copper, brushed silver, graphite packages and a neutral
// substrate. Metals keep a little roughness so they read as brushed, not mirror-bright, on the
// light workspace; the same presets read on the dark graphite workspace.
export const C = {
  copper: '#9c6845',
  copperHi: '#b98462',
  gold: '#b9a070',
  teal: '#176b62',
  blue: '#3b6fb6',
  titanium: '#a9afb6',
  nickel: '#b6bcc3',
  steel: '#8f969e',
  epoxy: '#2c3137',
  mask: '#3b4a47',
  polyimide: '#b08a5a',
  silicon: '#2a2f38',
  graphite: '#33383f',
  ink: '#20272d',
  paper: '#e9e8e3',
};

export const M = {
  titanium: { color: C.titanium, metalness: 0.9, roughness: 0.42 },
  titaniumDark: { color: '#7c838b', metalness: 0.9, roughness: 0.48 },
  nickel: { color: C.nickel, metalness: 0.9, roughness: 0.36 },
  steel: { color: C.steel, metalness: 0.9, roughness: 0.44 },
  copper: { color: C.copper, metalness: 0.95, roughness: 0.42 },
  gold: { color: C.gold, metalness: 0.95, roughness: 0.4 },
  tin: { color: '#c5cad0', metalness: 0.9, roughness: 0.4 },
  epoxy: { color: C.epoxy, metalness: 0.1, roughness: 0.6 },
  plastic: { color: '#3a3f46', metalness: 0.05, roughness: 0.55 },
  ferrite: { color: '#3d4046', metalness: 0.3, roughness: 0.72 },
  mask: { color: C.mask, metalness: 0.15, roughness: 0.5 },
  laminate: { color: '#5c6a66', metalness: 0.1, roughness: 0.55 },
  anodized: { color: C.graphite, metalness: 0.7, roughness: 0.4 },
  ceramicTan: { color: '#b3a58a', metalness: 0.1, roughness: 0.65 },
  platinum: { color: '#d4d9df', metalness: 0.95, roughness: 0.3 },
  graphite: { color: C.graphite, metalness: 0.35, roughness: 0.5 },
} as const;

/** Glass-like (no transmission pass; reflections come from the environment). */
export const GLASS = {
  color: '#d9e0e4',
  metalness: 0,
  roughness: 0.06,
  clearcoat: 1,
  clearcoatRoughness: 0.06,
  transparent: true,
  opacity: 0.16,
  depthWrite: false,
  envMapIntensity: 1.1,
} as const;

// ─────────────────────────────────────────────── rim-light shader patch ──
// Adds a soft fresnel rim term to MeshStandard/Physical materials; parts drive `userData.rim`
// for signal-path and lab-activity tints (selection and hover use the screen-space outline).
export function patchRim(mat: Material) {
  const m = mat as MeshStandardMaterial;
  if (!m.isMeshStandardMaterial || m.userData.rim) return;
  const rim = { value: new Color(0, 0, 0) };
  m.userData.rim = rim;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColor = rim;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRimColor;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          vec3 rimView = normalize(vViewPosition);
          float rimF = 1.0 - clamp(abs(dot(normalize(normal), rimView)), 0.0, 1.0);
          totalEmissiveRadiance += uRimColor * (rimF * rimF * 1.1 + 0.02);
        }`,
      );
  };
  m.customProgramCacheKey = () => 'hbci-rim';
  m.needsUpdate = true;
}

// ───────────────────────────────────────────────────── canvas textures ──
const FONT = '-apple-system, "SF Pro Display", "Helvetica Neue", Helvetica, Arial, sans-serif';
const MONO = '"SF Mono", ui-monospace, Menlo, Consolas, monospace';

export function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d')!;
  draw(ctx, w, h);
  const t = new CanvasTexture(cv);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/** Laser-etched marking on a metal or epoxy top surface. */
export function markingTexture(lines: { text: string; size: number; weight?: number; mono?: boolean }[], opts: {
  w?: number; h?: number; bg: string; fg: string; dot?: boolean; border?: string;
}) {
  const w = opts.w ?? 512;
  const h = opts.h ?? 512;
  return canvasTexture(w, h, (ctx) => {
    ctx.fillStyle = opts.bg;
    ctx.fillRect(0, 0, w, h);
    // faint brushed grain
    ctx.globalAlpha = 0.06;
    for (let i = 0; i < 220; i++) {
      ctx.fillStyle = i % 2 ? '#ffffff' : '#000000';
      ctx.fillRect(0, Math.random() * h, w, Math.random() * 1.5);
    }
    ctx.globalAlpha = 1;
    if (opts.border) {
      ctx.strokeStyle = opts.border;
      ctx.lineWidth = w * 0.012;
      ctx.strokeRect(w * 0.05, h * 0.05, w * 0.9, h * 0.9);
    }
    if (opts.dot) {
      ctx.fillStyle = opts.fg;
      ctx.beginPath();
      ctx.arc(w * 0.13, h * 0.13, w * 0.035, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = opts.fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const total = lines.reduce((s, l) => s + l.size * 1.25, 0);
    let y = h / 2 - total / 2;
    for (const l of lines) {
      y += (l.size * 1.25) / 2;
      ctx.font = `${l.weight ?? 600} ${l.size}px ${l.mono ? MONO : FONT}`;
      ctx.fillText(l.text, w / 2, y);
      y += (l.size * 1.25) / 2;
    }
  });
}

/** Faint repeating grid used for silicon. */
export function siliconTexture(blocks?: { x: number; y: number; w: number; h: number; color: string }[], pads = true) {
  const S = 1024;
  return canvasTexture(S, S, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, S, S);
    g.addColorStop(0, '#343a44');
    g.addColorStop(0.5, '#2a2f38');
    g.addColorStop(1, '#30343c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    ctx.strokeStyle = 'rgba(200,210,220,0.07)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= S; i += 16) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, S); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(S, i); ctx.stroke();
    }
    if (blocks) {
      for (const b of blocks) {
        ctx.fillStyle = b.color;
        ctx.globalAlpha = 0.22;
        ctx.fillRect(b.x * S, b.y * S, b.w * S, b.h * S);
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = b.color;
        ctx.lineWidth = 3;
        ctx.strokeRect(b.x * S, b.y * S, b.w * S, b.h * S);
        // standard-cell rows
        ctx.globalAlpha = 0.18;
        for (let y = b.y * S + 6; y < (b.y + b.h) * S - 4; y += 9) {
          ctx.beginPath(); ctx.moveTo(b.x * S + 4, y); ctx.lineTo((b.x + b.w) * S - 4, y); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    }
    // pad ring
    ctx.fillStyle = 'rgba(205,210,216,0.6)';
    const n = pads ? 14 : 0;
    for (let i = 0; i < n; i++) {
      const p = 60 + (i * (S - 120)) / (n - 1);
      for (const [x, y] of [[p, 18], [p, S - 18], [18, p], [S - 18, p]]) ctx.fillRect(x - 12, y - 12, 24, 24);
    }
  });
}

/** Top surface of a die block: tinted background, placed-cell rows and the block label. */
export function blockTexture(opts: {
  name: string; sub: string; cells: number; tint: string; w: number; h: number;
  /** Replaces "N cells" (e.g. "≈2100 cells (est.)"). */
  cellsLabel?: string;
  /** Fraction of the tile height available to the label (default 1). */
  labelH?: number;
  /** Vertical centre of the label as a fraction of the height (default 0.5). */
  labelAt?: number;
  /** Optional per-channel lane captions (fractions of the tile). */
  lanes?: { n: number; z0: number; z1: number; x: number };
}) {
  const PX = 220; // pixels per world unit
  const cw = Math.max(64, Math.round(opts.w * PX));
  const ch = Math.max(64, Math.round(opts.h * PX));
  return canvasTexture(cw, ch, (ctx) => {
    ctx.fillStyle = '#272c34';
    ctx.fillRect(0, 0, cw, ch);
    ctx.fillStyle = opts.tint;
    ctx.globalAlpha = 0.14;
    ctx.fillRect(0, 0, cw, ch);
    // standard cell rows with pseudo-random cells
    let seed = opts.name.length * 977 + opts.cells;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const rowH = 10;
    for (let y = 6; y < ch - 6; y += rowH) {
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = opts.tint;
      let x = 6;
      while (x < cw - 6) {
        const cwid = 4 + rnd() * 18;
        if (rnd() > 0.15) ctx.fillRect(x, y, Math.min(cwid, cw - 6 - x), rowH - 3);
        x += cwid + 1.5;
      }
    }
    // metal stripes
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = '#b98462';
    for (let x = 14; x < cw; x += 28) ctx.fillRect(x, 0, 2, ch);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = opts.tint;
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, cw - 4, ch - 4);

    if (opts.lanes) {
      const { n, z0, z1, x } = opts.lanes;
      ctx.fillStyle = '#b9c1c9';
      ctx.font = `600 ${Math.round(((z1 - z0) * ch) / n / 2.6)}px ${MONO}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < n; i++) ctx.fillText(`ch${i}`, x * cw, (z0 + ((i + 0.5) * (z1 - z0)) / n) * ch);
    }

    // label
    const vertical = ch > cw * 1.8 && !opts.lanes;
    ctx.save();
    ctx.translate(cw / 2, ch * (opts.labelAt ?? 0.5));
    if (vertical) ctx.rotate(-Math.PI / 2);
    const avail = vertical ? ch : cw;
    const across = vertical ? cw : ch * (opts.labelH ?? 1);
    const big = Math.min(46, avail / Math.max(6, opts.name.length * 0.62), across / 2.9);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(24,28,34,0.78)';
    const boxW = Math.min(avail - 12, big * opts.name.length * 0.66 + 30);
    const boxH = big * 2.7;
    ctx.fillRect(-boxW / 2, -boxH / 2, boxW, boxH);
    ctx.fillStyle = '#eef0f2';
    ctx.font = `600 ${big}px ${MONO}`;
    ctx.fillText(opts.name, 0, -big * 0.45);
    ctx.fillStyle = opts.tint;
    ctx.font = `500 ${big * 0.56}px ${FONT}`;
    ctx.fillText(`${opts.sub} · ${opts.cellsLabel ?? `${opts.cells} cells`}`, 0, big * 0.72);
    ctx.restore();
  });
}

/** PCB top: solder mask, silkscreen outlines and reference designators. */
export function pcbTexture(footprints: { x: number; y: number; w: number; h: number; ref: string }[], aspect: number) {
  const W = 1024;
  const H = Math.round(W / aspect);
  const t = canvasTexture(W, H, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#41514d');
    g.addColorStop(1, '#374542');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(236,240,238,0.6)';
    ctx.fillStyle = 'rgba(236,240,238,0.7)';
    ctx.lineWidth = 2;
    ctx.font = `600 18px ${MONO}`;
    for (const f of footprints) {
      const x = f.x * W, y = f.y * H, w = f.w * W, h = f.h * H;
      ctx.strokeRect(x - w / 2, y - h / 2, w, h);
      ctx.fillText(f.ref, x - w / 2, y - h / 2 - 6);
    }
    ctx.font = `600 22px ${FONT}`;
    ctx.fillText('HBCI DEV CARRIER · CONCEPT', W * 0.04, H * 0.94);
    ctx.font = `500 16px ${MONO}`;
    ctx.fillText('REV 0.4  NOT FOR IMPLANT', W * 0.7, H * 0.94);
  });
  return t;
}

/** Neural-net pattern for the external AI module (printed, not glowing). */
export function neuralTexture(title = 'EXTERNAL COMPUTE · CONCEPT') {
  return canvasTexture(512, 352, (ctx, w, h) => {
    ctx.fillStyle = '#2b3036';
    ctx.fillRect(0, 0, w, h);
    const cols = [4, 6, 6, 3];
    const pts: [number, number][][] = cols.map((n, ci) =>
      Array.from({ length: n }, (_, i) => [60 + (ci * (w - 120)) / (cols.length - 1), ((i + 1) * h) / (n + 1)]),
    );
    ctx.strokeStyle = 'rgba(141,196,188,0.4)';
    ctx.lineWidth = 1.5;
    for (let c = 0; c < pts.length - 1; c++)
      for (const a of pts[c]) for (const b of pts[c + 1]) { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
    for (const col of pts) for (const p of col) {
      ctx.fillStyle = '#5cc2b5';
      ctx.beginPath(); ctx.arc(p[0], p[1], 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#e8f6f3';
      ctx.beginPath(); ctx.arc(p[0], p[1], 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = 'rgba(236,240,242,0.8)';
    ctx.font = `600 22px ${FONT}`;
    ctx.fillText(title, 20, 30);
  });
}

/** Radial soft glow used as an additive halo sprite / ground glow. */
export function glowTexture(color = '255,255,255') {
  const t = canvasTexture(128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, `rgba(${color},1)`);
    g.addColorStop(0.35, `rgba(${color},0.35)`);
    g.addColorStop(1, `rgba(${color},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

/** Face of a READ–COMPUTE–FEEDBACK loop stage plate (decoder / language model). */
export function stagePlateTexture(opts: { title: string; sub: string; tag: string; fg: string; bg: string; accent: string; dashed?: boolean; icon?: 'net' | 'chat' }) {
  return canvasTexture(512, 320, (ctx, w, h) => {
    ctx.fillStyle = opts.bg;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = opts.accent;
    ctx.lineWidth = 6;
    if (opts.dashed) ctx.setLineDash([22, 14]);
    ctx.strokeRect(8, 8, w - 16, h - 16);
    ctx.setLineDash([]);
    // icon in the lower-right corner, clear of the text
    ctx.globalAlpha = opts.dashed ? 0.4 : 0.85;
    if (opts.icon === 'net') {
      const cols = [3, 4, 2];
      const pts = cols.map((n, ci) => Array.from({ length: n }, (_, i) => [w * 0.66 + ci * 52, 178 + ((i + 1) * 110) / (n + 1)] as [number, number]));
      ctx.strokeStyle = opts.accent;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      for (let c = 0; c < pts.length - 1; c++) for (const a of pts[c]) for (const b of pts[c + 1]) { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
      ctx.setLineDash([]);
      for (const col of pts) for (const p of col) { ctx.beginPath(); ctx.arc(p[0], p[1], 7, 0, Math.PI * 2); ctx.stroke(); }
    } else if (opts.icon === 'chat') {
      ctx.fillStyle = opts.accent;
      const bubble = (x: number, y: number, bw: number, bh: number) => {
        ctx.beginPath();
        ctx.roundRect(x, y, bw, bh, 12);
        ctx.fill();
      };
      bubble(w * 0.66, 192, 130, 30);
      ctx.globalAlpha *= 0.6;
      bubble(w * 0.72, 232, 110, 30);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = opts.fg;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${opts.title.length > 10 ? 40 : 46}px ${FONT}`;
    ctx.fillText(opts.title, 34, 92);
    ctx.font = `500 26px ${FONT}`;
    ctx.globalAlpha = 0.85;
    ctx.fillText(opts.sub, 34, 142);
    ctx.globalAlpha = 1;
    ctx.fillStyle = opts.accent;
    ctx.font = `700 26px ${MONO}`;
    ctx.fillText(opts.tag, 34, h - 52);
  });
}

/** Software-only feedback indicator panel (ready / uncertain / clarify). */
export function feedbackPanelTexture() {
  return canvasTexture(512, 300, (ctx, w, h) => {
    ctx.fillStyle = '#2d2a36';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#a98ad6';
    ctx.lineWidth = 5;
    ctx.setLineDash([20, 12]);
    ctx.strokeRect(8, 8, w - 16, h - 16);
    ctx.setLineDash([]);
    ctx.fillStyle = '#efe8fa';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `700 36px ${FONT}`;
    ctx.fillText('FEEDBACK UI', 30, 52);
    ctx.font = `500 22px ${FONT}`;
    ctx.fillStyle = '#c3b4e0';
    ctx.fillText('software-only indicator · no stimulation', 30, 92);
    const labels = ['ready', 'uncertain', 'clarify?'];
    ctx.font = `600 24px ${MONO}`;
    labels.forEach((l, i) => {
      ctx.fillStyle = '#d8ccef';
      ctx.fillText(l, 30 + i * 160 + 46, h - 70);
    });
  });
}

/** Blueprint-style substrate face: fine grid plus routed wiring (illustrative). */
export function blueprintTexture() {
  return canvasTexture(1024, 720, (ctx, w, h) => {
    ctx.fillStyle = '#3a4756';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(200, 220, 240, 0.14)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= w; x += 24) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y <= h; y += 24) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(205, 225, 240, 0.5)';
    ctx.lineWidth = 2;
    let seed = 41;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 70; i++) {
      let x = Math.round((rnd() * w) / 24) * 24;
      let y = Math.round((rnd() * h) / 24) * 24;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let k = 0; k < 4; k++) {
        if (k % 2) y += (rnd() - 0.5) * 220;
        else x += (rnd() - 0.5) * 300;
        ctx.lineTo(Math.round(x / 24) * 24, Math.round(y / 24) * 24);
      }
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(225, 235, 245, 0.75)';
    ctx.font = `600 22px ${MONO}`;
    ctx.fillText('FLEX SUBSTRATE · ILLUSTRATIVE ROUTING · CONCEPT', 28, h - 26);
  });
}

/** Thinned-electronics candidate tile face. */
export function tileTexture(title: string, sub: string, accent: string, lanes = 0) {
  return canvasTexture(512, 360, (ctx, w, h) => {
    ctx.fillStyle = '#2b3139';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = accent;
    ctx.globalAlpha = 0.18;
    for (let y = 18; y < h - 10; y += 12) { ctx.beginPath(); ctx.moveTo(14, y); ctx.lineTo(w - 14, y); ctx.stroke(); }
    ctx.globalAlpha = 1;
    ctx.lineWidth = 5;
    ctx.strokeRect(4, 4, w - 8, h - 8);
    ctx.fillStyle = 'rgba(24, 28, 34, 0.75)';
    ctx.fillRect(24, 22, w - 48, lanes ? 96 : 130);
    ctx.fillStyle = '#eef0f2';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `700 40px ${FONT}`;
    ctx.fillText(title, 40, 56);
    ctx.fillStyle = accent;
    ctx.font = `500 24px ${FONT}`;
    ctx.fillText(sub, 40, 96);
    if (lanes) {
      ctx.font = `600 18px ${MONO}`;
      ctx.fillStyle = '#b9c1c9';
      for (let i = 0; i < lanes; i++) ctx.fillText(`ch${i}`, 30, 142 + i * 26);
    }
  });
}

/** Top face of the external relay puck. */
export function relayTexture() {
  return canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#2f343b';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(141, 196, 188, 0.5)';
    ctx.lineWidth = 3;
    for (let r = 60; r < 250; r += 34) { ctx.beginPath(); ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2); ctx.stroke(); }
    ctx.fillStyle = 'rgba(24, 28, 34, 0.8)';
    ctx.fillRect(70, h / 2 - 54, w - 140, 108);
    ctx.fillStyle = '#eef0f2';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 40px ${FONT}`;
    ctx.fillText('EXTERNAL RELAY', w / 2, h / 2 - 16);
    ctx.fillStyle = '#9fd6cd';
    ctx.font = `500 24px ${MONO}`;
    ctx.fillText('power ↓ · data ↑ · CONCEPT', w / 2, h / 2 + 26);
  });
}

/** Text strip for die-region headers (e.g. the legacy EVENT core cluster). */
export function headerTexture(text: string, color: string, wUnits: number, hUnits: number) {
  const PX = 220;
  const cw = Math.max(64, Math.round(wUnits * PX));
  const ch = Math.max(24, Math.round(hUnits * PX));
  return canvasTexture(cw, ch, (ctx) => {
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = 'rgba(5, 11, 26, 0.0)';
    ctx.fillRect(0, 0, cw, ch);
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${Math.round(ch * 0.56)}px ${MONO}`;
    ctx.fillText(text, ch * 0.3, ch / 2);
  });
}
