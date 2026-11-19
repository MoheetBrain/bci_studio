// Level 4 — standard cell (genuine SKY130 PDK data from the v0.2 layout) and the educational
// transistor tutorial. The display-mode banner above this view is rendered by App from
// useMicro().cellTab; this view only switches that tab and reports its evidence level.
import { useEffect, useState } from 'react';
import { useScene } from '../../state/sceneStore';
import { useMicro } from '../microStore';
import type { CellDoc, CellIndex } from './netlist';
import { DEFAULT_VIS, PdkCell, type PdkState } from './PdkCell';
import { Tutorial, type TutState } from './Tutorial';
import './cell.css';

const BASE = `${import.meta.env.BASE_URL}artifacts/cells/`;

async function getJson<T>(name: string): Promise<T | null> {
  try {
    const r = await fetch(BASE + name, { cache: 'no-cache' });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null; // missing file (or the dev server's HTML fallback)
  }
}

// Cached for the session: the artifacts do not change while the studio runs.
let indexCache: CellIndex | 'missing' | null = null;
const docCache = new Map<string, CellDoc | 'missing'>();

export function CellView() {
  const tab = useMicro((m) => m.cellTab);
  const setCellTab = useMicro((m) => m.setCellTab);
  const [index, setIndex] = useState<CellIndex | 'missing' | null>(indexCache);
  const [docs, setDocs] = useState<Record<string, CellDoc | 'missing'>>(() => Object.fromEntries(docCache));
  const [pdk, setPdk] = useState<PdkState>({ pick: null, vis: DEFAULT_VIS, showGates: true, showLabels: true });
  const [tut, setTut] = useState<TutState>({ ex: 'nand', v: { A: 0, B: 0 }, slow: false });

  useEffect(() => {
    useScene.getState().setViewEvidence(tab === 'pdk' ? 'LAYOUT' : 'CONCEPT');
  }, [tab]);

  useEffect(() => {
    if (indexCache) return;
    let live = true;
    getJson<CellIndex>('index.json').then((d) => {
      indexCache = d && Array.isArray(d.cells) && d.cells.length ? d : 'missing';
      if (live) setIndex(indexCache);
    });
    return () => { live = false; };
  }, []);

  const entries = index && index !== 'missing' ? index.cells : [];
  const pick = pdk.pick ?? entries[0]?.cell ?? null;
  const file = entries.find((c) => c.cell === pick)?.file ?? null;

  useEffect(() => {
    if (!pick || !file || docCache.has(pick)) return;
    let live = true;
    getJson<CellDoc>(file).then((d) => {
      docCache.set(pick, d && Array.isArray(d.layers) && d.bbox_um ? d : 'missing');
      if (live) setDocs(Object.fromEntries(docCache));
    });
    return () => { live = false; };
  }, [pick, file]);

  const seeReal = (ex: TutState['ex']) => {
    const want = entries.find((c) => (ex === 'nand' ? /__nand2_/ : /__inv_/).test(c.cell));
    if (want) setPdk((p) => ({ ...p, pick: want.cell }));
    setCellTab('pdk');
  };

  return (
    <div className="cv" data-testid="cell-view">
      <div className="cv-top">
        <div className="cv-tabs" role="tablist" aria-label="Level 4 view">
          <button role="tab" aria-selected={tab === 'pdk'} className={`seg-btn cv-tab${tab === 'pdk' ? ' on' : ''}`} onClick={() => setCellTab('pdk')} data-testid="cell-tab-pdk">
            Genuine SKY130 cell
          </button>
          <button role="tab" aria-selected={tab === 'tutorial'} className={`seg-btn cv-tab${tab === 'tutorial' ? ' on' : ''}`} onClick={() => setCellTab('tutorial')} data-testid="cell-tab-tutorial">
            Transistor tutorial — educational
          </button>
        </div>
        <span className="cv-sp" />
        <div className="cv-nav">
          <button className="btn" onClick={() => useScene.getState().setLevel('gates')} data-testid="cell-back-gates">← Back to gates</button>
          <button
            className="btn"
            onClick={() => { useMicro.getState().setLayoutTab('layout'); useScene.getState().setLevel('layout'); }}
            data-testid="cell-to-layout"
          >
            See the whole v0.2 layout
          </button>
        </div>
      </div>
      {tab === 'pdk' ? (
        <PdkCell
          index={index}
          doc={pick ? docs[pick] ?? null : null}
          docMissing={file}
          st={{ ...pdk, pick }}
          set={(p) => setPdk((s) => ({ ...s, ...p }))}
        />
      ) : (
        <Tutorial st={tut} set={(p) => setTut((s) => ({ ...s, ...p }))} seeReal={seeReal} />
      )}
    </div>
  );
}
