// What each stage means, in three representations of the SAME state: a plain account (cinematic), the equations with
// the live numbers in them (physics & maths), and the block's interfaces and budgets (engineering). Every card also
// lists the model's assumptions and its sources. Nothing here is computed separately from the simulation.
import type { ReactNode } from 'react';
import { Cites } from '../science/Cite';
import type { Mode } from './experimentStore';
import { afeMagnitude } from './model/dsp';
import { BIN_MS, CAL_S, DSP_BAND_HZ, FEEDBACK_DELAY_BINS, GRID_HZ, N_CH, NEAR0_UM, REF_AMP_UV, REF_DIST_UM, SWING_V, VMAX, unitRate } from './model/motor';
import type { MotorSession, VisualSession } from './model/session';
import { BROADBAND_GAIN, DRIVE, LATENCY_S, VIS_BAND_HZ, VIS_GRID_HZ } from './model/visual';
import { Prov, type ProvKind } from './Prov';

interface Card { title: string; prov: ProvKind[]; cinematic: ReactNode; math: ReactNode; engineering: ReactNode; assume: string[]; sources: string[] }
const f1 = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '—');
const Eq = ({ children }: { children: ReactNode }) => <div className="eq mono">{children}</div>;
const Spec = ({ rows }: { rows: Array<[string, ReactNode]> }) => <table className="exp-spec"><tbody>{rows.map(([k, v]) => <tr key={k}><th>{k}</th><td className="mono">{v}</td></tr>)}</tbody></table>;

function motorCards(s: MotorSession, t: number): Card[] {
  const r = s.run, p = r.params, f = r.focus!, k = Math.max(0, Math.min(r.nBins - 1, Math.floor((t * 1000) / BIN_MS + 1e-6)));
  const units = r.units.filter((u) => u.ch === f.ch), u0 = units[0];
  const vx = r.intent[k * 2], vy = r.intent[k * 2 + 1], sp = Math.hypot(vx, vy), th = Math.atan2(vy, vx);
  const info = s.decoders.find((d) => d.id === s.decoderId)!;
  const rawBits = N_CH * p.fsHz * p.bits, featBits = N_CH * 4 * (1000 / BIN_MS);
  const lag = info.heldOutNow.lagBins * BIN_MS;
  return [
    {
      title: 'Cortical tissue under the device', prov: ['illustrative', 'simulated'],
      cinematic: <p>Eight fine threads reach down from the device into the cortex. Around each recording site sit a few neurons. Every flash is one spike of a model neuron — and how often each one fires depends on the movement the (simulated) person intends.</p>,
      math: <><Eq>r = r₀ + |v| · (k + m · cos(θ − θ<sub>pref</sub>))</Eq><p>For the nearest neuron on this contact, now: |v| = {f1(sp, 2)}, θ = {f1((th * 180) / Math.PI, 0)}°, θ<sub>pref</sub> = {f1((u0.prefRad * 180) / Math.PI, 0)}° → r = <strong>{f1(unitRate(u0, vx, vy), 0)} spikes/s</strong>. Spike times are drawn at random at that rate (a Poisson process with a 3 ms dead time).</p></>,
      engineering: <Spec rows={[['Recording sites', `${N_CH} (2 × 4, 2.2 mm apart)`], ['Model neurons', `${r.units.length} (3 per site)`], ['Site shown', `contact ${f.ch + 1}`], ['Simulated time', `${r.durationS} s`], ['Waveform grid', `${GRID_HZ / 1000} kHz`]]} />,
      assume: ['Cell shapes and positions are drawn; the atlas has no cells. The dim cells in the background are scenery: they are not simulated and never fire.', 'Each model neuron is seen by one contact only (contacts are 2.2 mm apart).', 'Cosine direction tuning with a speed term, as reported for monkey motor cortex during reaching. Rates and tuning depths are illustrative values.', 'Clinical arrays cited in the region brief use on the order of a hundred electrodes; this model has eight.'],
      sources: ['georgopoulos1982', 'moran1999', 'hochberg2006'],
    },
    {
      title: 'One neuron fires', prov: ['simulated'],
      cinematic: <p>Each spike is an action potential: the voltage across the cell’s membrane jumps from about −65 mV to about +40 mV and falls back, all within a couple of milliseconds. Outside the cell, at the contact, the same event is a deflection a thousand times smaller — microvolts, not millivolts.</p>,
      math: <><Eq>C·dV/dt = I − ḡ<sub>Na</sub>m³h(V − E<sub>Na</sub>) − ḡ<sub>K</sub>n⁴(V − E<sub>K</sub>) − g<sub>L</sub>(V − E<sub>L</sub>)</Eq><p>The Hodgkin–Huxley membrane equation, integrated once to give the shape of one action potential (C = 1 µF/cm², ḡ<sub>Na</sub> = 120, ḡ<sub>K</sub> = 36, g<sub>L</sub> = 0.3 mS/cm²). The extracellular shape is taken as <span className="mono">−dV/dt</span>, so its negative peak falls on the steepest rise of V.</p></>,
      engineering: <Spec rows={[['Spike width (this model)', '≈ 1–2 ms'], ['Inside the cell', '≈ 105 mV swing'], ['At the contact', `${f1(r.ampUv[u0.id], 0)} µV`], ['Ratio', `≈ ${(105000 / r.ampUv[u0.id]).toFixed(0)} : 1`], ['Band that holds a spike', `${DSP_BAND_HZ[0]} Hz – ${DSP_BAND_HZ[1] / 1000} kHz`]]} />,
      assume: ['One Hodgkin–Huxley action potential (squid axon, 6.3 °C) is replayed at every simulated spike time. Inputs between spikes are not modelled.', 'A human cortical neuron has different channels, temperature and geometry; the shape is a stand-in.', 'The extracellular shape ∝ −dV/dt is this studio’s teaching rule; a real one depends on the cell’s geometry.'],
      sources: ['hodgkin1952', 'henze2000'],
    },
    {
      title: 'What the contact sees', prov: ['simulated'],
      cinematic: <p>The contact does not hear one neuron. It hears every cell nearby — each fainter the further away it is — on top of a slow wave from the whole neighbourhood and a floor of noise. Move the electrode away and the spikes sink into that floor.</p>,
      math: <><Eq>V<sub>e</sub>(t) = Σ<sub>i</sub> A<sub>i</sub> · s(t − t<sub>i</sub>) + field(t) + noise(t) + offset</Eq><Eq>A<sub>i</sub> = {REF_AMP_UV} µV · {REF_DIST_UM} µm / d<sub>i</sub></Eq><p>On this contact: {units.map((u) => `d = ${f1(u.dist0Um + p.nearUm - NEAR0_UM, 0)} µm → ${f1(r.ampUv[u.id], 0)} µV`).join(' · ')}. Noise in the detector’s band: {f1(r.sigmaUv[f.ch], 1)} µV.</p></>,
      engineering: <Spec rows={[['Largest spike', `${f1(r.ampUv[u0.id], 0)} µV`], ['Noise (detector band)', `${f1(r.sigmaUv[f.ch], 1)} µV rms`], ['Spike ÷ noise', f1(r.ampUv[u0.id] / Math.max(0.1, r.sigmaUv[f.ch]), 1)], ['Electrode offset', `${f1(f.offsetMv, 1)} mV`], ['Offset ÷ spike', `≈ ${((f.offsetMv * 1000) / r.ampUv[u0.id]).toFixed(0)} : 1`]]} />,
      assume: ['Amplitude falls as 1 / distance from 120 µV at 30 µm — a stated teaching rule, not a measurement.', 'Noise is white and Gaussian, with the rms you set over 0.3–7.5 kHz. It lumps electrode, amplifier and unresolved background together.', 'The slow field potential is three fixed sinusoids; the DC offset is a fixed value per contact.', 'Whether a real electrode at the attached point would record such neurons cannot be inferred from the atlas.'],
      sources: ['henze2000', 'buzsaki2012'],
    },
    {
      title: 'Analogue front end', prov: ['simulated'],
      cinematic: <p>Before anything can be digitised, the signal has to be made bigger. But the contact also carries an offset thousands of times larger than a spike — amplify that and the output slams into its limit. So the slow, large parts are removed first, then the rest is amplified.</p>,
      math: <><Eq>|H(f)| = G · (f/f<sub>hp</sub>)/√(1 + (f/f<sub>hp</sub>)²) · 1/√(1 + (f/f<sub>lp</sub>)⁴)</Eq><p>At 1 kHz: × {f1(p.gain * afeMagnitude(1000, p.hpHz, p.lpHz), 0)}. At 10 Hz: × {f1(p.gain * afeMagnitude(10, p.hpHz, p.lpHz), 1)}. The output cannot exceed ±{SWING_V} V.</p></>,
      engineering: <Spec rows={[['High-pass', p.hpHz > 0 ? `${p.hpHz} Hz, 1st order` : 'none (DC-coupled)'], ['Low-pass', `${p.lpHz} Hz, 2nd-order Butterworth`], ['Gain', `× ${p.gain} (${f1(20 * Math.log10(p.gain), 0)} dB)`], ['Output swing', `±${SWING_V} V`], ['Largest spike at output', `${f1((r.ampUv[u0.id] * p.gain) / 1000, 1)} mV`], ['Offset × gain', p.hpHz > 0 ? 'blocked' : `${f1((f.offsetMv * p.gain) / 1000, 1)} V`], ['Samples on a rail', `${(f.clippedFrac * 100).toFixed(1)} %`]]} />,
      assume: ['Ideal filters and an ideal gain stage with hard limits; no amplifier noise shaping, no input impedance.', 'The amplifier is assumed switched on long before t = 0, so the high-pass has already settled.'],
      sources: ['harrison2003', 'harrison2008'],
    },
    {
      title: 'Analogue-to-digital conversion', prov: ['simulated'],
      cinematic: <p>The converter looks at the voltage {p.fsHz.toLocaleString()} times a second and writes down the nearest of {(2 ** p.bits).toLocaleString()} numbers. Look too rarely and a spike falls between two looks; use too few numbers and it is rounded away.</p>,
      math: <><Eq>x[n] = round( v(n / f<sub>s</sub>) / Δ ),  Δ = 2·V<sub>ref</sub> / 2<sup>B</sup></Eq><p>Δ = {(2000 / 2 ** p.bits).toFixed(3)} mV at the converter = {f1(f.lsbUv, 2)} µV at the electrode. Rounding adds noise of Δ/√12 = {f1(f.lsbUv / Math.sqrt(12), 2)} µV. Nothing above f<sub>s</sub>/2 = {p.fsHz / 2} Hz can be told from a lower frequency afterwards.</p></>,
      engineering: <Spec rows={[['Sample rate', `${p.fsHz.toLocaleString()} S/s`], ['Resolution', `${p.bits} bit`], ['Full scale', `±${SWING_V} V`], ['Raw data, 8 channels', `${(rawBits / 1000).toFixed(0)} kbit/s`], ['The same for 1,024 channels', `${((rawBits / N_CH) * 1024 / 1e6).toFixed(1)} Mbit/s`]]} />,
      assume: ['An ideal sampler and an ideal mid-tread quantiser: no aperture jitter, no non-linearity.', 'The converter picks every k-th point of a 30 kHz grid, so a low-pass corner above the Nyquist frequency really does alias.'],
      sources: ['shannon1949'],
    },
    {
      title: 'Digital signal processing', prov: ['simulated', 'inferred'],
      cinematic: <p>Three steps turn a stream of samples into something a decoder can use: keep only the band spikes live in, subtract whatever all contacts share (interference, not brain), and count each time the trace dips below a threshold. The counts, smoothed, are the features.</p>,
      math: <><Eq>z<sub>c</sub>[n] = y<sub>c</sub>[n] − (1/N)·Σ<sub>j</sub> y<sub>j</sub>[n]</Eq><Eq>σ̂ = median|z| / 0.6745,  crossing when z &lt; −{p.threshK}·σ̂</Eq><Eq>r<sub>k</sub> = r<sub>k−1</sub> + α·(c<sub>k</sub>/Δ − r<sub>k−1</sub>),  α = 1 − e<sup>−Δ/τ</sup> = {f1(1 - Math.exp(-BIN_MS / p.tauMs), 3)}</Eq><p>Here σ̂ = {f1(r.sigmaUv[f.ch], 2)} µV, threshold −{f1(r.thresholdUv[f.ch], 1)} µV, Δ = {BIN_MS} ms, τ = {p.tauMs} ms.</p></>,
      engineering: <Spec rows={[['Band-pass', `2 biquads, ${DSP_BAND_HZ[0]} Hz – ${Math.min(DSP_BAND_HZ[1], 0.4 * p.fsHz)} Hz`], ['Arithmetic', `${((10 * N_CH * p.fsHz) / 1e6).toFixed(2)} M multiply–adds/s`], ['In', `${(rawBits / 1000).toFixed(0)} kbit/s`], ['Out (8 counts per bin)', `${(featBits / 1000).toFixed(2)} kbit/s`], ['Reduction', `≈ ${(rawBits / featBits).toFixed(0)} ×`], ['Estimating σ̂', `first ${CAL_S} s`]]} />,
      assume: ['Threshold crossings are counted without sorting them into single neurons.', 'The noise estimate is made once, in the first second, and not updated.', 'This detector is a floating-point teaching version. The Hamiltonian RTL has its own event and feature paths; they are not what runs here.'],
      sources: ['quiroga2004', 'ludwig2009', 'christie2015'],
    },
    {
      title: 'Decoder', prov: ['inferred'],
      cinematic: <p>The decoder turns eight firing-rate estimates into one intended velocity. Each channel pushes the answer one way or the other by an amount it learned during calibration; the bars show every push for this instant, and they add up to exactly the number that moves the cursor.</p>,
      math: info.id === 'kalman'
        ? <><Eq>x̂<sub>k</sub> = (I − K·C)·A·x̂<sub>k−1</sub> + K·(y<sub>k</sub> − μ)</Eq><p>x is velocity, y the spike counts. A says how velocity carries over from bin to bin, C how counts depend on velocity, K (the Kalman gain) how much to trust the new counts. All three are fitted to the calibration data.</p></>
        : info.id === 'linear'
          ? <><Eq>v̂ = b + W·z,  z<sub>c</sub> = (r<sub>c</sub> − μ<sub>c</sub>) / σ<sub>c</sub></Eq><p>W is a 2 × 8 matrix found by ridge regression on the calibration data: the weights that make v̂ closest to the intended velocity.</p></>
          : <><Eq>h = tanh(W₁·z + b₁),  v̂ = W₂·h + b₂</Eq><p>{info.cost.nonlin} hidden units, trained by gradient descent (Adam, 400 passes) on the calibration data; the parameters that did best on a held-out fifth are kept.</p></>,
      engineering: <Spec rows={[['Multiply–adds per bin', String(info.cost.macs)], ['Parameters', String(info.cost.params)], ['Memory at 16 bit', `${(info.cost.params + info.cost.stateWords) * 2} bytes`], ['Serial engine', `${info.cost.macs + info.cost.nonlin + 2} clock cycles`], ['Held-out R² (now)', f1(info.heldOutNow.r2, 2)], ['Output lag', `${lag} ms`]]} />,
      assume: ['Fitted on a simulated calibration run; scored on a different simulated run. Not validated on neural data.', 'Clock cycles assume one multiply–accumulate per cycle on a serial engine. The Hamiltonian RTL decoder does 16 in 18 cycles in simulation; other sizes are extrapolated, and that chip is not fabricated.', 'On real recordings, published comparisons find modern networks ahead of Kalman and Wiener filters; a small synthetic task need not agree.'],
      sources: ['wu2006', 'gilja2012', 'glaser2020'],
    },
    {
      title: 'Output and feedback', prov: ['simulated'],
      cinematic: <p>The decoded velocity moves a cursor. The person sees it move — a moment late — and aims again from wherever it now is. That loop through the eyes is why the cursor arrives even though no single decoded value is exactly right.</p>,
      math: <><Eq>p<sub>k+1</sub> = p<sub>k</sub> + v̂<sub>k</sub> · v<sub>max</sub> · Δ</Eq><Eq>v<sub>k</sub> = (g − p<sub>k−{FEEDBACK_DELAY_BINS}</sub>) / |…| · min(1, |…| / 0.35)</Eq><p>p is the cursor, g the target, v<sub>max</sub> = {VMAX} per second, Δ = {BIN_MS} ms. The simulated user always aims straight at the target from where they last saw the cursor.</p></>,
      engineering: <Spec rows={[['Bin', `${BIN_MS} ms`], ['Decoder lag', `${lag} ms`], ['Visual feedback (assumed)', `${FEEDBACK_DELAY_BINS * BIN_MS} ms`], ['Loop delay', `≈ ${BIN_MS + lag + FEEDBACK_DELAY_BINS * BIN_MS} ms`], ['Targets reached', `${s.summary.hits} of ${s.summary.trials}`], ['Mean time to target', s.summary.meanTimeS ? `${f1(s.summary.meanTimeS, 2)} s` : '—']]} />,
      assume: ['The user is a rule, not a person: always aiming at the target, 100 ms behind, never tiring or learning.', 'A real user also adapts to the decoder; that co-adaptation is not modelled.'],
      sources: ['hochberg2006', 'gilja2012'],
    },
  ];
}

function visualCards(s: VisualSession, t: number): Card[] {
  const r = s.run, p = r.params, f = r.focus!, k = Math.max(0, Math.min(r.nBins - 1, Math.floor((t * 1000) / r.binMs + 1e-6)));
  const e = r.drive[k * r.nCh + f.ch], rawBits = r.nCh * p.fsHz * p.bits;
  return [
    {
      title: 'Cortical surface under the device', prov: ['illustrative', 'simulated'],
      cinematic: <p>Here the recording sites lie <em>on</em> the cortex, not in it. Each one is a millimetre across and listens to the summed activity of a great many cells beneath it. When a picture appears, the cells under some contacts become busier; under others, hardly at all.</p>,
      math: <><Eq>drive<sub>c</sub>(t) = g<sub>c</sub> · a<sub>picture</sub> · shape(t − onset − {(LATENCY_S * 1000).toFixed(0)} ms)</Eq><p>g<sub>c</sub> is how strongly the cortex under contact c responds (set per contact), a = {DRIVE.object} for an intact object and {DRIVE.scrambled} for a scrambled one. Now, under contact {f.ch + 1}: {f1(e, 2)}.</p></>,
      engineering: <Spec rows={[['Recording sites', `${r.nCh} surface contacts`], ['Modality', 'field potential (no spikes)'], ['Pictures in this run', String(r.stim.length)], ['Waveform grid', `${VIS_GRID_HZ / 1000} kHz`]]} />,
      assume: ['The sheet of cells is a drawing. Their flicker is random; only its rate follows the model’s drive.', 'Which contacts respond, and how strongly, is set by hand.', 'A real surface grid would sit under the skull, on the cortex; none of that anatomy is modelled.'],
      sources: ['buzsaki2012', 'malach1995'],
    },
    {
      title: 'A population responds', prov: ['simulated'],
      cinematic: <p>About a tenth of a second after a picture appears, the local population’s firing rises, eases off a little while the picture stays, and dies away when it goes. An intact object drives this cortex harder than a scrambled one.</p>,
      math: <><Eq>background<sub>c</sub>(t) → (1 + {BROADBAND_GAIN}·drive<sub>c</sub>(t)) · background<sub>c</sub>(t)</Eq><p>The ongoing background activity is multiplied as a whole: power rises across all frequencies together — a broadband shift. A full response raises band power by about {f1(20 * Math.log10(1 + BROADBAND_GAIN), 0)} dB.</p></>,
      engineering: <Spec rows={[['Response latency', `${(LATENCY_S * 1000).toFixed(0)} ms (model)`], ['Intact : scrambled', `${DRIVE.object} : ${DRIVE.scrambled}`], ['Trial-to-trial spread', '≈ 20 %'], ['Useful band', `${VIS_BAND_HZ[0]}–${VIS_BAND_HZ[1]} Hz`]]} />,
      assume: ['The intact-versus-scrambled difference is put in by hand, following the imaging result. The simulation illustrates it; it is not evidence for it.', 'Every object drives the model identically, so nothing downstream can tell objects apart.', 'Attention, eye position and task effects are not modelled.'],
      sources: ['malach1995', 'manning2009', 'ray2011'],
    },
    {
      title: 'What the contact sees', prov: ['simulated'],
      cinematic: <p>The trace is mostly the brain’s ongoing background: slow, large waves and a ten-per-second rhythm. The response to a picture is not a new shape on top — it is that the fast fuzz gets a little bigger. You can barely see it by eye.</p>,
      math: <><Eq>V<sub>e</sub>(t) = (1 + {BROADBAND_GAIN}·drive) · background(t) + evoked(t) + rhythm(t) + hum(t) + noise(t)</Eq><p>The background is “pink”: most of its power is at low frequencies. That is why the feature is taken from a higher band, where a change in level stands out against less background.</p></>,
      engineering: <Spec rows={[['Signal size', 'tens of µV'], ['Measurement noise', `${f1(p.noiseUv, 1)} µV rms`], ['Mains hum', p.artefact ? '25 µV, common to all contacts' : 'off'], ['Electrode offset', `${f1(f.offsetMv, 1)} mV`]]} />,
      assume: ['Background = three leaky integrators of white noise per contact, independent between contacts.', 'No law for amplitude versus distance from the cortex is assumed, so there is no distance control.'],
      sources: ['buzsaki2012', 'miller2016'],
    },
    {
      title: 'Analogue front end', prov: ['simulated'],
      cinematic: <p>The same two jobs as for spikes — remove the offset, then amplify — but tuned to slower signals: the corners sit at fractions of a hertz and a few hundred hertz instead of hundreds and thousands.</p>,
      math: <><Eq>|H(f)| = G · (f/f<sub>hp</sub>)/√(1 + (f/f<sub>hp</sub>)²) · 1/√(1 + (f/f<sub>lp</sub>)⁴)</Eq><p>At 100 Hz: × {f1(p.gain * afeMagnitude(100, p.hpHz, p.lpHz), 0)}.</p></>,
      engineering: <Spec rows={[['High-pass', p.hpHz > 0 ? `${p.hpHz} Hz` : 'none (DC-coupled)'], ['Low-pass', `${p.lpHz} Hz`], ['Gain', `× ${p.gain}`], ['Samples on a rail', `${(f.clippedFrac * 100).toFixed(1)} %`]]} />,
      assume: ['Ideal filters and gain with hard limits at ±1 V.'], sources: ['harrison2008'],
    },
    {
      title: 'Analogue-to-digital conversion', prov: ['simulated'],
      cinematic: <p>Field potentials change far more slowly than spikes, so a thousand looks a second is plenty — until the rate drops so low that the band the feature lives in no longer fits under half the sample rate.</p>,
      math: <><Eq>x[n] = round( v(n / f<sub>s</sub>) / Δ ),  Δ = 2·V<sub>ref</sub> / 2<sup>B</sup></Eq><p>Δ = {f1(f.lsbUv, 2)} µV at the electrode. Nyquist: {p.fsHz / 2} Hz; the feature band ends at {VIS_BAND_HZ[1]} Hz.</p></>,
      engineering: <Spec rows={[['Sample rate', `${p.fsHz} S/s`], ['Resolution', `${p.bits} bit`], ['Raw data, 8 channels', `${(rawBits / 1000).toFixed(0)} kbit/s`], ['Compared with the spike chain', `≈ ${((8 * 30000 * 12) / rawBits).toFixed(0)} × less`]]} />,
      assume: ['Ideal sampler and quantiser.'], sources: ['shannon1949'],
    },
    {
      title: 'Digital signal processing', prov: ['simulated', 'inferred'],
      cinematic: <p>Subtract what all contacts share — that removes the mains hum. Keep the {VIS_BAND_HZ[0]}–{VIS_BAND_HZ[1]} Hz band. Then measure how much power is in it, tenth of a second by tenth of a second, relative to rest. That number is the feature.</p>,
      math: <><Eq>P<sub>k</sub> = mean( z[n]² ) over bin k,  feature = 10·log₁₀( P<sub>k</sub> / P<sub>rest</sub> )</Eq><p>Now on contact {f.ch + 1}: {f1(r.powerDb[k * r.nCh + f.ch], 1)} dB, smoothed {f1(r.feat[k * r.nCh + f.ch], 1)} dB.</p></>,
      engineering: <Spec rows={[['Band', `${VIS_BAND_HZ[0]}–${Math.min(VIS_BAND_HZ[1], 0.4 * p.fsHz)} Hz, 2 biquads`], ['Bin', `${r.binMs} ms`], ['Rest power from', 'the first second'], ['Same band as', 'the Hamiltonian chip’s FEATURE path design (70–150 Hz)']]} />,
      assume: ['Rest power is measured once. Drift afterwards is not corrected.', 'The common average removes what the contacts share, but it also carries a little of every contact’s own activity into every other: a contact over undriven cortex shows a small rise that is not its own.', 'This is a floating-point teaching version, not the chip’s RTL.'],
      sources: ['miller2016', 'crone1998'],
    },
    {
      title: 'Decoder', prov: ['inferred'],
      cinematic: <p>Two questions, each answered with a probability: is a picture on the screen, and if so, is it an intact object? A probability near one half means the decoder does not know — and it says so.</p>,
      math: <><Eq>P = 1 / (1 + e<sup>−(b + w·z)</sup>),  z<sub>c</sub> = (feature<sub>c</sub> − μ<sub>c</sub>) / σ<sub>c</sub></Eq><p>Now: P(on) = {f1(r.decoded[k * 2], 2)}, P(intact) = {f1(r.decoded[k * 2 + 1], 2)}.</p></>,
      engineering: <Spec rows={[['Multiply–adds per bin', '16'], ['Parameters', '18 + 16 for normalising'], ['Training bins', String(s.trainBins)]]} />,
      assume: ['Logistic regression fitted on a simulated, labelled calibration session.', 'It answers only the two questions it was trained on.'],
      sources: ['miller2016', 'kay2008'],
    },
    {
      title: 'Output', prov: ['simulated'],
      cinematic: <p>The result is a running commentary on the screen: on, off, object, scrambled. Strongly driving pictures are caught every time; weak ones are missed. Which object it was cannot be recovered at all.</p>,
      math: <><p>Detected: P(on) &gt; 0.5 in at least one bin of the expected response. Delay: first such bin minus the picture’s onset.</p><Eq>{s.summary.detected} of {s.summary.stimuli} detected · {s.summary.falseAlarmBins} false-alarm bins of {s.summary.quietBins}</Eq></>,
      engineering: <Spec rows={[['Mean delay', s.summary.meanDelayS ? `${(s.summary.meanDelayS * 1000).toFixed(0)} ms` : '—'], ['of which latency', `${(LATENCY_S * 1000).toFixed(0)} ms`], ['of which smoothing + bin', `≈ ${p.tauMs + r.binMs} ms`]]} />,
      assume: ['No feedback loop: the picture drives the cortex; the decoder only reports.', 'Which-object accuracy is chance by construction.'],
      sources: ['miller2016', 'kay2008'],
    },
  ];
}

export function Explain({ s, stage, mode, t }: { s: MotorSession | VisualSession; stage: number; mode: Mode; t: number }) {
  const card = (s.kind === 'motor' ? motorCards(s, t) : visualCards(s, t))[stage - 1];
  return (
    <section className="exp-explain" aria-label="What this stage means" data-testid="explain" data-mode={mode}>
      <div className="exp-explain-head">
        <span className="exp-step mono">{stage} / 8</span>
        <h3 data-testid="explain-title">{card.title}</h3>
      </div>
      <div className="exp-provs" data-testid="explain-prov">{card.prov.map((p) => <Prov key={p} kind={p} />)}</div>
      <div className="exp-explain-body" data-testid={`explain-${mode}`}>{card[mode]}</div>
      <details className="exp-assume" data-testid="assumptions" open={mode !== 'cinematic'}>
        <summary>Model and assumptions</summary>
        <ul>{card.assume.map((a) => <li key={a}>{a}</li>)}</ul>
        <div className="exp-cites"><Cites ids={card.sources} /></div>
      </details>
    </section>
  );
}
