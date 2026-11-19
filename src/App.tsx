import { useEffect, useRef } from 'react';
import { AdvancedBar, TopNav } from './ui/TopNav';
import { ComponentTree } from './ui/ComponentTree';
import { Inspector } from './ui/Inspector';
import { Viewport3D } from './three/Viewport3D';
import { CircuitView } from './circuit/CircuitView';
import { GatesView } from './gates/GatesView';
import { LayoutView } from './layout/LayoutView';
import { LabPanel } from './lab/LabPanel';
import { useScene } from './state/sceneStore';
import { useArtifacts } from './artifacts/load';
import { ViewModeBanner } from './micro/ViewModeBanner';
import { ModuleView } from './micro/module/ModuleView';
import { useAutoFold } from './micro/useAutoFold';
import { CellView } from './micro/cell/CellView';
import { CourseOverlay } from './micro/course/Course';

const LAB_H = { collapsed: '36px', tall: '52vh' } as const;

/** Drag handle that resizes a panel edge. */
function Resizer({ edge, onDrag }: { edge: 'left' | 'right' | 'bottom'; onDrag: (dx: number, dy: number) => void }) {
  const last = useRef<{ x: number; y: number } | null>(null);
  return (
    <div
      className={`resizer resizer-${edge}`}
      title="Drag to resize"
      onPointerDown={(e) => { last.current = { x: e.clientX, y: e.clientY }; (e.target as HTMLElement).setPointerCapture(e.pointerId); }}
      onPointerMove={(e) => {
        if (!last.current) return;
        onDrag(e.clientX - last.current.x, e.clientY - last.current.y);
        last.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={() => { last.current = null; }}
      data-testid={`resizer-${edge}`}
    />
  );
}

const IS_3D = { system: true, package: true, die: true, circuit: false, module: false, gates: false, cell: false, layout: false } as const;

export default function App() {
  const level = useScene((s) => s.level);
  const labSize = useScene((s) => s.labSize);
  const setLabSize = useScene((s) => s.setLabSize);
  const panels = useScene((s) => s.panels);
  const setPanels = useScene((s) => s.setPanels);
  const advanced = useScene((s) => s.advanced);
  const loadArtifacts = useArtifacts((s) => s.load);
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  useAutoFold();

  useEffect(() => {
    void loadArtifacts();
  }, [loadArtifacts]);

  // Escape: exit the current level (or clear the selection at the outermost level).
  // Lessons and dialogs may stop propagation first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const s = useScene.getState();
      if (s.lessonStep !== null) return; // the lesson handles Esc
      if (s.level === 'system') s.select(null);
      else s.back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const is3d = IS_3D[level];
  const bottom = labSize === 'normal' ? `${panels.bottom}px` : LAB_H[labSize];
  const cols = `${panels.leftOpen ? panels.left : 0}px 1fr ${panels.rightOpen ? panels.right : 0}px`;

  return (
    <div
      className={`app${advanced ? ' with-advanced' : ''}`}
      style={{ ['--bottom-h' as string]: bottom, gridTemplateColumns: cols }}
      data-ui-mode={useScene.getState().uiMode}
    >
      <div className="region-top">
        <TopNav />
      </div>
      {advanced && (
        <div className="region-adv">
          <AdvancedBar />
        </div>
      )}
      <aside className="region-left" aria-label="Component tree" style={{ display: panels.leftOpen ? undefined : 'none' }}>
        <ComponentTree />
      </aside>
      <main className="region-center">
        {panels.leftOpen && <Resizer edge="left" onDrag={(dx) => setPanels({ left: clamp(panels.left + dx, 180, 520) })} />}
        {panels.rightOpen && <Resizer edge="right" onDrag={(dx) => setPanels({ right: clamp(panels.right - dx, 280, 640) })} />}
        {labSize === 'normal' && <Resizer edge="bottom" onDrag={(_dx, dy) => setPanels({ bottom: clamp(panels.bottom - dy, 180, window.innerHeight * 0.75) })} />}
        <ViewModeBanner />
        <div className="center-stage">
          {/* The 3D viewport stays mounted so camera and assembly state survive level changes. */}
          <div style={{ position: 'absolute', inset: 0, visibility: is3d ? 'visible' : 'hidden' }}>
            <Viewport3D active={is3d} />
          </div>
          {level === 'circuit' && <CircuitView />}
          {level === 'module' && <ModuleView />}
          {level === 'gates' && <GatesView />}
          {level === 'cell' && <CellView />}
          {level === 'layout' && <LayoutView />}
          <CourseOverlay />
        </div>
      </main>
      <aside className="region-right" aria-label="Inspector" style={{ display: panels.rightOpen ? undefined : 'none' }}>
        <Inspector />
      </aside>
      <section className="region-bottom" aria-label="Signal laboratory">
        <LabPanel size={labSize} onSize={setLabSize} />
      </section>
    </div>
  );
}
