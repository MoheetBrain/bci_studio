// Die-level overlays: the contact-pad card (with a conceptual cross-section) and the 80/20 legend with the
// conceptual-routes / netlist-lines switch. Port counts come from rtl_modules.json; record counts from the
// four RTL runs in rtl_trace_v03.json. Nothing about pads is engineered, and the card says so.
import { useTraceV04 } from '../lab/v04Store';
import { useState } from 'react';
import { useArtifacts } from '../artifacts/load';
import { useScene } from '../state/sceneStore';
import { EvidenceBadge } from '../ui/EvidenceBadge';
import { useDieLayout, type PadGroup } from '../three/dieLayout';
import { useMicro } from './microStore';

const PAD_GROUP: Record<PadGroup, { label: string; test: (p: string) => boolean }> = {
  in: { label: 'the sample input (in_valid, in_channel, in_sample)', test: (p) => p.startsWith('in_') },
  rec: { label: 'the record output (rec_*)', test: (p) => p.startsWith('rec_') },
  reg: { label: 'the register bus (reg_addr, reg_wdata, reg_we, reg_re, reg_rdata)', test: (p) => p.startsWith('reg_') },
  pred: { label: 'the prediction pins (pred_strobe, pred_class_out, pred_irq)', test: (p) => p.startsWith('pred_') },
  clk: { label: 'clock and reset (clk, rst_n)', test: (p) => p === 'clk' || p === 'rst_n' },
};

/** Conceptual cross-section of a wire-bonded die: what a pad would connect to. */
function CrossSection() {
  return (
    <figure className="pad-xs" data-testid="pad-cross-section">
      <svg viewBox="0 0 360 150" width="100%" aria-label="Conceptual cross-section of a wire-bonded die">
        <rect x="10" y="112" width="340" height="22" rx="3" fill="#7fae8f" />
        <text x="18" y="127" fontSize="10" fill="#10261a">package substrate (wiring layers)</text>
        <rect x="250" y="104" width="44" height="8" fill="#d9b45a" />
        <rect x="266" y="134" width="12" height="10" fill="#c9cfd4" />
        <text x="284" y="146" fontSize="9" fill="var(--fg-secondary)">contact to board</text>
        <rect x="40" y="70" width="170" height="42" rx="2" fill="#8c8a86" />
        <text x="48" y="101" fontSize="10" fill="#f5f5f2">silicon die (transistors + metal layers)</text>
        <rect x="150" y="62" width="40" height="8" fill="#f4f4f1" stroke="#555" strokeWidth="0.8" />
        <text x="138" y="56" fontSize="10" fill="var(--fg)">pad (top metal)</text>
        <path d="M170 62 C 190 18, 250 18, 268 104" fill="none" stroke="#c9a23c" strokeWidth="2.2" />
        <text x="214" y="30" fontSize="10" fill="var(--fg)">bond wire</text>
      </svg>
      <figcaption>CONCEPT: a typical wire-bonded package, not a design for this chip (no package, pad ring or bonding diagram exists). Flip-chip bumps are another common option.</figcaption>
    </figure>
  );
}

export function PadCard() {
  const pad = useMicro((m) => m.pad);
  const setPad = useMicro((m) => m.setPad);
  const modules = useArtifacts((a) => a.modules);
  const layout = useDieLayout();
  if (pad === null) return null;
  const info = layout.pads[pad];
  if (!info) return null;
  const side = info.side;
  const top = modules?.modules.find((m) => m.name === 'hbci02_digital_top');
  const ports = top?.ports ?? [];
  const ins = ports.filter((p) => p.dir === 'input');
  const outs = ports.filter((p) => p.dir === 'output');
  const bits = (ps: typeof ports) => ps.reduce((k, p) => k + p.width, 0);
  const grp = PAD_GROUP[info.group];
  const here = ports.filter((p) => grp.test(p.name));
  const nPads = layout.pads.length;
  return (
    <aside className="padcard" data-testid="pad-card" role="dialog" aria-label="Contact pad">
      <div className="si-h">
        <b>CONTACT PAD</b>
        <span className="si-h-sub">square {info.k + 1} of {info.n} on the {side} edge</span>
        <span className="vmb-sp" />
        <button className="btn sm" onClick={() => setPad(null)} aria-label="Close pad card">Close</button>
      </div>
      <div className="si-body">
        <p><EvidenceBadge e="CONCEPT" /> These white squares show where wires would join the die to its package. They are illustrative.</p>
        <p className="pad-warn" data-testid="pin-mapping">PIN MAPPING NOT ENGINEERED: no pad has been assigned to a port, so this square has no pin number.</p>
        <p>On this drawing the {side} edge is where the studio groups {grp.label}. That grouping is a reading aid.</p>
        {here.length > 0 && (
          <div className="pad-ports">
            {here.map((p) => <code key={p.name} title={`${p.dir}, ${p.width} bit${p.width > 1 ? 's' : ''}${p.signed ? ', signed' : ''}`}>{p.name}{p.width > 1 ? `[${p.width - 1}:0]` : ''}</code>)}
          </div>
        )}
        {top ? (
          <p className="pad-count">
            Real top-level ports of hbci02_digital_top (rtl_modules.json): <b>{ports.length}</b> = {ins.length} inputs ({bits(ins)} bits) + {outs.length} outputs ({bits(outs)} bits), <b>{bits(ports)}</b> signal bits.
            The drawing has {nPads} squares. On the chip top (hbci02_chip_top, RTL) the sample input and the register bus are serialised over SPI (3 + 4 pins) and the records over a 2-pin serial output, so a real pad ring would be far smaller than this port list; a real chip would also need power and ground pads.
          </p>
        ) : <p className="si-missing">rtl_modules.json not loaded: port counts unavailable.</p>}
        <CrossSection />
      </div>
    </aside>
  );
}

export function DieLegend() {
  const lineMode = useMicro((m) => m.lineMode);
  const setLineMode = useMicro((m) => m.setLineMode);
  const tr = useArtifacts((a) => a.traceV03);
  const { trace: t4 } = useTraceV04();
  const mode = useScene((s) => s.procMode);
  const n = (m: 'RAW' | 'EVENT' | 'FEATURE' | 'HYBRID') => tr?.runs[m].records.length.toLocaleString('en-GB') ?? '—';
  // Open by default only where it does not cover the die; the same legend is in "What am I looking at?".
  const [open, setOpen] = useState(() => window.innerWidth >= 1680);
  return (
    <div className={`vp-card die-legend${open ? '' : ' closed'}`} data-testid="die-legend">
      <button className="dl-h" onClick={() => setOpen(!open)} aria-expanded={open} data-testid="legend-toggle">
        <b>Legend {open ? '▾' : '▸'}</b><span className="dl-k">Block identity RTL · placement CONCEPT</span>
      </button>
      {open && <ul>
        <li><i className="vmb-sw sw-tile" /> Tile = one real RTL block, drawn where it is easy to read</li>
        <li><i className="vmb-sw sw-route" /> Copper line = real connection, drawn as a route (not a wire)</li>
        <li><i className="vmb-sw sw-bus" /> Triple line = a bus of many wires</li>
        <li><i className="vmb-sw sw-pad" /> White square = illustrative contact pad</li>
        <li><i className="vmb-sw sw-lit" /> Lit frame = makes records in <b>{mode}</b></li>
        <li><i className="vmb-sw sw-ai" /> Raspberry frame and routes = the on-chip AI decoder (v0.4): fed by every completed window in every mode</li>
      </ul>}
      <div className="dl-lines seg" role="radiogroup" aria-label="Lines on the die">
        <button role="radio" aria-checked={lineMode === 'concept'} className={`seg-btn${lineMode === 'concept' ? ' on' : ''}`} onClick={() => setLineMode('concept')} data-testid="lines-concept">Concept routes</button>
        <button role="radio" aria-checked={lineMode === 'netlist'} className={`seg-btn${lineMode === 'netlist' ? ' on' : ''}`} onClick={() => setLineMode('netlist')} data-testid="lines-netlist" title="Straight lines between the blocks the Yosys netlist connects (rtl_modules.json)">Netlist lines</button>
      </div>
      {lineMode === 'netlist' && <p className="dl-note">Straight lines = blocks connected in the synthesised netlist (teal: v0.3 readout top, amber: inside the legacy core, grey: v0.4 top hbci02_digital_top, raspberry: inside the decoder). Clock and reset reach every register and are not drawn.</p>}
      {tr && open && (
        <p className="dl-note" data-testid="legend-records">
          The same 4,000 samples, four RTL runs: RAW {n('RAW')} · EVENT {n('EVENT')} · FEATURE {n('FEATURE')} · HYBRID {n('HYBRID')} records.
          HYBRID sends more than RAW; EVENT and FEATURE throw the waveform away.
          {t4 && <> v0.4 run ({t4.config.mode}): {t4.features.length} windows on the decoder tap → {t4.frames.length} frames → {t4.predictions.length} predictions ({t4.source.model.trained ? 'trained model' : 'placeholder model'}).</>}
        </p>
      )}
    </div>
  );
}
