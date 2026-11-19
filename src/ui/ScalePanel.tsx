// Size & Scale: per-object dimensions with provenance (KNOWN / TARGET / ILLUSTRATIVE / UNKNOWN) and an
// orthographic comparison at true relative scale. Nothing here is "actual size on screen": there is no
// display calibration, and scene coordinates are never converted to millimetres.
import { useEffect } from 'react';
import { create } from 'zustand';
import { useArtifacts } from '../artifacts/load';
import { COMPONENTS } from '../model/components';
import { fmtMm, MICRO_SD, PROVENANCE_HELP, referenceRecords, sizeRecordFor, TARGET_20, v02DieRecord, type Provenance, type SizeRecord } from '../model/dimensions';
import { useScene } from '../state/sceneStore';
import { KindBadge } from './KindBadge';
import './panels.css';

interface ScaleState { open: boolean; setOpen: (v: boolean) => void }
export const useScalePanel = create<ScaleState>((set) => ({ open: false, setOpen: (v) => set({ open: v }) }));
export const openScalePanel = () => useScalePanel.getState().setOpen(true);

function Prov({ p }: { p: Provenance }) {
  return <span className={`prov prov-${p}`} title={PROVENANCE_HELP[p]}>{p}</span>;
}

function DimTable({ r }: { r: SizeRecord }) {
  const measurable = r.provenance === 'KNOWN' || r.provenance === 'TARGET';
  return (
    <div className={`dim${measurable ? '' : ' dim-off'}`} data-testid={`dim-${r.id}`} data-provenance={r.provenance}>
      <div className="dim-head">
        <b>{r.label}</b>
        <Prov p={r.provenance} />
      </div>
      {r.notPhysical ? (
        <p className="dim-why">Not a physical object: a software function has no size.</p>
      ) : (
        <table className="dim-table" aria-label={`Dimensions of ${r.label}`}>
          <tbody>
            <tr><th>Width</th><td className="mono">{measurable ? fmtMm(r.width_mm) : 'not measurable'}</td></tr>
            <tr><th>Length</th><td className="mono">{measurable ? fmtMm(r.length_mm) : 'not measurable'}</td></tr>
            <tr><th>Thickness</th><td className="mono">{measurable ? (r.thickness_mm === null ? 'not specified' : fmtMm(r.thickness_mm)) : 'not measurable'}</td></tr>
          </tbody>
        </table>
      )}
      {!measurable && r.why && !r.notPhysical && <p className="dim-why">Measurement disabled: {r.why}</p>}
      {r.note && <p className="dim-note">{r.note}</p>}
      <p className="dim-src"><span className="faint">Source:</span> {r.source}</p>
    </div>
  );
}

/** Orthographic top view at true relative scale. 10 px per mm; everything shares the bottom-left corner. */
function Comparison({ die }: { die: SizeRecord | null }) {
  const PX = 10; // px per mm in the drawing (not a screen calibration)
  const W = 360, H = 270;
  const ox = 44, oy = H - 34; // bottom-left origin
  const rect = (w: number, l: number) => ({ x: ox, y: oy - l * PX, w: w * PX, h: l * PX });
  const t = rect(TARGET_20.width_mm!, TARGET_20.length_mm!);
  const s = rect(MICRO_SD.width_mm!, MICRO_SD.length_mm!);
  const d = die ? rect(die.width_mm!, die.length_mm!) : null;
  const ZOOM = 20;
  const dz = die ? { x: ox + t.w + 30, y: oy - die.length_mm! * PX * ZOOM, w: die.width_mm! * PX * ZOOM, h: die.length_mm! * PX * ZOOM } : null;
  return (
    <svg className="scale-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Orthographic size comparison at true relative scale" data-testid="scale-svg">
      {/* 20 × 20 mm target */}
      <rect x={t.x} y={t.y} width={t.w} height={t.h} className="sc-target" />
      <text x={t.x + t.w / 2} y={t.y - 6} className="sc-lbl" textAnchor="middle">20 × 20 mm target (TARGET)</text>
      {/* microSD */}
      <rect x={s.x} y={s.y} width={s.w} height={s.h} rx="4" className="sc-sd" />
      <text x={s.x + s.w / 2} y={s.y + 14} className="sc-lbl sc-lbl-sd" textAnchor="middle">microSD</text>
      <text x={s.x + s.w / 2} y={s.y + 26} className="sc-lbl sc-lbl-sd" textAnchor="middle">15 × 11 mm</text>
      {/* v0.2 die, true scale */}
      {d && (
        <>
          <rect x={d.x} y={d.y} width={Math.max(1.5, d.w)} height={Math.max(1.5, d.h)} className="sc-die" />
          <line x1={d.x + d.w} y1={d.y} x2={dz!.x} y2={dz!.y + dz!.h / 2} className="sc-lead" />
          <rect x={dz!.x} y={dz!.y} width={dz!.w} height={dz!.h} className="sc-die sc-die-zoom" />
          <text x={dz!.x + dz!.w / 2} y={dz!.y - 6} className="sc-lbl" textAnchor="middle">die, ×{ZOOM} inset</text>
          <text x={dz!.x + dz!.w / 2} y={dz!.y + dz!.h + 12} className="sc-lbl" textAnchor="middle">{fmtMm(die!.width_mm)} × {fmtMm(die!.length_mm)}</text>
          <text x={dz!.x + dz!.w / 2} y={dz!.y + dz!.h + 24} className="sc-lbl faint" textAnchor="middle">v0.2 event core</text>
        </>
      )}
      {/* scale bar */}
      <line x1={ox} y1={oy + 12} x2={ox + 10 * PX} y2={oy + 12} className="sc-bar" />
      <line x1={ox} y1={oy + 8} x2={ox} y2={oy + 16} className="sc-bar" />
      <line x1={ox + 10 * PX} y1={oy + 8} x2={ox + 10 * PX} y2={oy + 16} className="sc-bar" />
      <text x={ox + 5 * PX} y={oy + 28} className="sc-lbl" textAnchor="middle">10 mm (relative only)</text>
      {/* origin corner note */}
      <text x={ox - 4} y={oy + 4} className="sc-lbl faint" textAnchor="end">corner</text>
    </svg>
  );
}

export function ScalePanel() {
  const open = useScalePanel((s) => s.open);
  const setOpen = useScalePanel((s) => s.setOpen);
  const selectedId = useScene((s) => s.selectedId);
  const layout = useArtifacts((a) => a.layout);
  const sky130V03 = useArtifacts((a) => a.sky130V03);
  const sky130V04 = useArtifacts((a) => a.sky130V04);
  const layoutV03 = useArtifacts((a) => a.layoutV03);
  const layoutV04 = useArtifacts((a) => a.layoutV04);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      e.preventDefault();
      setOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, setOpen]);

  if (!open) return null;
  const arts = { layout, layoutV03, layoutV04, sky130V03, sky130V04 };
  const c = selectedId ? COMPONENTS[selectedId] : null;
  const sel = c ? sizeRecordFor(c, arts) : null;
  const refs = referenceRecords(arts);
  const die = v02DieRecord(arts);
  const provs = new Set<Provenance>(refs.map((r) => r.provenance).filter((p) => p === 'KNOWN' || p === 'TARGET'));
  const mixed = provs.size > 1;

  return (
    <div className="scale-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }} data-testid="scale-panel">
      <div className="scale-panel" role="dialog" aria-modal="true" aria-label="Size and scale">
        <header className="scale-head">
          <div>
            <h3>Size &amp; scale</h3>
            <p className="scale-sub">How big things are, and how sure we are. <b>Die footprint ≠ package size ≠ whole-device size.</b></p>
          </div>
          <button className="btn sm" onClick={() => setOpen(false)} aria-label="Close" data-testid="scale-close">Close ✕</button>
        </header>

        <div className="scale-grid">
          <section className="scale-col">
            <h4>Selected object</h4>
            {c && sel ? (
              <>
                <div className="scale-selname"><span>{c.name}</span> <KindBadge c={c} /></div>
                <DimTable r={sel} />
              </>
            ) : (
              <p className="muted">Nothing selected. Pick a part to see its size record.</p>
            )}
            <h4>Reference objects</h4>
            {refs.map((r) => <DimTable key={r.id} r={r} />)}
          </section>

          <section className="scale-col">
            <h4>Orthographic comparison (true relative scale)</h4>
            <Comparison die={die} />
            {mixed && (
              <p className="warn-box scale-warn" data-testid="scale-mixed">
                This drawing mixes provenances: the 20 × 20 mm square is a comparison TARGET, not a measured part; the microSD card and the v0.2 die are KNOWN. Nothing drawn here is ILLUSTRATIVE scene geometry.
              </p>
            )}
            <ul className="scale-notes">
              <li>The v0.2 event-core die (about 0.25 mm) is the tiny mark in the corner; that is the point. It is <b>not</b> the v0.4 chip: the v0.3 readout-core and v0.4 chip-top dies are drawn from their own layout artifacts when present, and individual logic blocks stay UNKNOWN in size.</li>
              <li>The package, board, housing and the cortical concept are drawn in scene units and are deliberately absent here: they have no millimetre size. The cortical concept's layers are drawn with exaggerated thickness.</li>
              <li>Nothing in this panel is "actual size on screen". There is no display calibration; only the ratios between drawn objects are true.</li>
              <li>{die ? `Die figures come from the genuine v0.2 layout (${fmtMm(die.width_mm)} × ${fmtMm(die.length_mm)}); thickness is not part of a layout result.` : 'layout_summary.json is not loaded, so the v0.2 die is not drawn.'}</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
