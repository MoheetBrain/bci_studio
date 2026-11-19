import { useArtifacts } from '../artifacts/load';

const KW = /\b(module|endmodule|input|output|wire|reg|signed|assign|always|begin|end|if|else|for|integer|parameter|localparam|posedge|negedge|or|and)\b/g;

function highlight(line: string) {
  const cmt = line.indexOf('//');
  const code = cmt >= 0 ? line.slice(0, cmt) : line;
  const rest = cmt >= 0 ? line.slice(cmt) : '';
  const parts: React.ReactNode[] = [];
  let last = 0;
  code.replace(KW, (m, _g, off: number) => {
    parts.push(code.slice(last, off));
    parts.push(<span key={off} className="kw">{m}</span>);
    last = off + m.length;
    return m;
  });
  parts.push(code.slice(last));
  if (rest) parts.push(<span key="c" className="cm">{rest}</span>);
  return parts;
}

/** Exact module source from rtl_modules.json with line numbers; optional highlighted lines. */
export function SourceView({ module, highlightLines, maxHeight = 320 }: { module: string; highlightLines?: Set<number>; maxHeight?: number }) {
  const modules = useArtifacts((a) => a.modules);
  const m = modules?.modules.find((x) => x.name === module);
  if (!m) return <div className="missing">rtl_modules.json not generated yet (run <code>make artifacts</code>).</div>;
  const lines = m.source.split('\n');
  return (
    <div className="src" style={{ maxHeight }} data-testid="source-view">
      <div className="src-head mono">{m.file}:{m.line_start}–{m.line_end}</div>
      <pre>
        {lines.map((l, k) => {
          const n = m.line_start + k;
          return (
            <div key={k} className={highlightLines?.has(n) ? 'hl' : undefined} data-line={n}>
              <span className="ln">{n}</span>{highlight(l)}
            </div>
          );
        })}
      </pre>
    </div>
  );
}
