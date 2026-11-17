// Below 1600 px the circuit, module, gates, cell and layout drawings need the component tree's width. Entering one of those levels
// folds the tree away; leaving them gives it back, unless the user changed it meanwhile or Focus is on.
import { useEffect, useRef } from 'react';
import { useScene } from '../state/sceneStore';
import { useMicro } from './microStore';

const WIDE_LEVELS = new Set(['circuit', 'module', 'gates', 'cell', 'layout']);

export function useAutoFold() {
  const level = useScene((s) => s.level);
  const folded = useRef(false);
  useEffect(() => {
    const s = useScene.getState();
    if (useMicro.getState().focus.on) return;
    if (WIDE_LEVELS.has(level)) {
      if (!folded.current && window.innerWidth < 1600 && s.panels.leftOpen) {
        s.setPanels({ leftOpen: false });
        folded.current = true;
      }
    } else if (folded.current) {
      folded.current = false;
      if (!s.panels.leftOpen) s.setPanels({ leftOpen: true });
    }
  }, [level]);
}
