// Dev / preview server plugin: a read-only, localhost-only JSON API over the local corpus index.
//   GET /api/corpus/status
//   GET /api/corpus/search?q=<text>&limit=<n>
//   GET /api/corpus/chunk?id=<n>
// No path parameters exist, the database is opened read-only, and requests from non-loopback addresses are refused,
// so the service cannot be used to read other files or be reached from another machine.
import type { Connect, Plugin } from 'vite';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function corpusSearch(rootDir: string): Plugin {
  const file = join(rootDir, 'corpus/index.sqlite');
  let corpus: import('./corpus.ts').Corpus | null = null;
  let loadError: string | null = null;
  const open = async () => {
    if (corpus || loadError) return;
    if (!existsSync(file)) { loadError = 'The local corpus index has not been built. Run: npm run corpus:build'; return; }
    try {
      const { Corpus } = await import('./corpus.ts');
      corpus = new Corpus(file);
    } catch (e) {
      loadError = `The corpus index could not be opened (${e instanceof Error ? e.message : String(e)}). node:sqlite needs Node 22.5 or newer.`;
    }
  };
  const handler: Connect.NextHandleFunction = async (req, res, next) => {
    if (!req.url?.startsWith('/api/corpus/')) return next();
    const send = (code: number, body: unknown) => {
      res.statusCode = code;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.end(JSON.stringify(body));
    };
    if (!LOOPBACK.has(req.socket.remoteAddress ?? '')) return send(403, { error: 'The corpus service only answers requests from this computer.' });
    if (req.method !== 'GET') return send(405, { error: 'GET only' });
    const url = new URL(req.url, 'http://127.0.0.1');
    // the index may be rebuilt while the server runs
    if (loadError && existsSync(file)) loadError = null;
    await open();
    if (!corpus) return send(503, { error: loadError });
    try {
      if (url.pathname === '/api/corpus/status') return send(200, corpus.status());
      if (url.pathname === '/api/corpus/search') return send(200, corpus.search((url.searchParams.get('q') ?? '').slice(0, 300), Number(url.searchParams.get('limit') ?? 12)));
      if (url.pathname === '/api/corpus/chunk') {
        const c = corpus.chunk(Number(url.searchParams.get('id')));
        return c ? send(200, c) : send(404, { error: 'No such passage.' });
      }
      return send(404, { error: 'Unknown corpus endpoint.' });
    } catch (e) {
      return send(500, { error: e instanceof Error ? e.message : String(e) });
    }
  };
  return {
    name: 'hbci-corpus-search',
    configureServer(server) { server.middlewares.use(handler); },
    configurePreviewServer(server) { server.middlewares.use(handler); },
  };
}
