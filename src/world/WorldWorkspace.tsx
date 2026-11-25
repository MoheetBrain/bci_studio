// The neural world's entry: a development chooser for the three competing toys, then the chosen toy.
// The chooser is a comparison aid for a playtest — it is not a new set of permanent tabs.
import { lazy, Suspense, useEffect, useState } from 'react';
import { useShell } from '../shell/shellStore';
import { TOYS, useWorld, type ToyId } from './worldStore';
import './world.css';

const Workshop = lazy(() => import('./toys/Workshop'));
const Flight = lazy(() => import('./toys/Flight'));
const Pilot = lazy(() => import('./toys/Pilot'));
const Journey = lazy(() => import('./journey/Journey'));

/** A different order each day, so that the first toy played is not always the same one. */
function todaysOrder(): ToyId[] {
  const day = Math.floor(Date.now() / 86400000), orders: ToyId[][] = [['workshop', 'flight', 'pilot'], ['pilot', 'workshop', 'flight'], ['flight', 'pilot', 'workshop']];
  return orders[day % 3];
}

function Chooser() {
  const setToy = useWorld((s) => s.setToy), go = useShell((s) => s.go), order = todaysOrder();
  return (
    <div className="w-chooser cine" data-testid="world-chooser">
      <div className="w-chooser-in">
        <p className="w-eyebrow">Hamiltonian Neuroverse · development build</p>
        <h1>Three small toys. Which one makes you want another go?</h1>
        <p className="w-lead">Each one puts you in the same small neural circuit with the same controls and one different thing to do. Play each for about the same few minutes; the playtest sheet (docs/NEUROVERSE_PLAYTEST.md) says what to notice. Nothing here is a recording from a brain: every signal is computed by a stated model, and every cell shape is an illustration.</p>
        <div className="w-toys">
          {TOYS.map((t) => (
            <button key={t.id} type="button" className="w-toy" onClick={() => setToy(t.id)} data-testid={`toy-${t.id}`}>
              <span className="w-toy-letter" aria-hidden="true">{t.letter}</span>
              <span className="w-toy-name">{t.name}</span>
              <span className="w-toy-verb">{t.verb}</span>
              <span className="w-toy-q">Tests: {t.question}</span>
              <span className="w-toy-go">Play {t.letter} →</span>
            </button>
          ))}
        </div>
        <p className="w-fine" data-testid="world-order">Suggested order for today: {order.map((id) => TOYS.find((t) => t.id === id)!.letter).join(' → ')} (it rotates daily, so no toy is always first).</p>
        <p className="w-fine"><button type="button" className="w-link" onClick={() => { location.hash = '#/world'; }} data-testid="chooser-world">← The world</button> · <button type="button" className="w-link" onClick={() => go('brain')} data-testid="chooser-classic">Classic studio</button> — these three prototypes are kept as development aids; the world at #/world is built from them.</p>
      </div>
    </div>
  );
}

/** `#/world` is the world itself; `#/world/dev` is the development chooser for the three earlier prototypes. */
const isDev = () => typeof location !== 'undefined' && /^#\/world\/dev\b/.test(location.hash);

export default function WorldWorkspace() {
  const toy = useWorld((s) => s.toy);
  const [dev, setDev] = useState(isDev);
  useEffect(() => { const on = () => setDev(isDev()); window.addEventListener('hashchange', on); return () => window.removeEventListener('hashchange', on); }, []);
  useEffect(() => { if (toy && location.hash !== `#/world/${toy}`) history.replaceState(null, '', `#/world/${toy}`); }, [toy]);
  if (!toy && !dev) return <Suspense fallback={<div className="shell-loading cine" role="status">Opening the world…</div>}><div className="cine world-host"><Journey /></div></Suspense>;
  if (!toy) return <Chooser />;
  return (
    <Suspense fallback={<div className="shell-loading cine" role="status">Entering the circuit…</div>}>
      <div className="cine world-host" key={toy}>{toy === 'workshop' ? <Workshop /> : toy === 'flight' ? <Flight /> : <Pilot />}</div>
    </Suspense>
  );
}
