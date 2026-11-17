import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { corpusSearch } from './server/searchPlugin.ts';

// SHA-256 over the concatenated rtl/*.v (sorted, same as `cat rtl/*.v | shasum -a 256`) at server start /
// build time. The studio compares it with the hash recorded in the generated artifacts to flag stale traces
// (restart the dev server after editing RTL).
function rtlSha256(): string {
  try {
    const dir = join(__dirname, 'chip', 'rtl');
    const h = createHash('sha256');
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.v')).sort()) h.update(readFileSync(join(dir, f)));
    return h.digest('hex');
  } catch {
    return 'unknown';
  }
}

export default defineConfig({
  plugins: [react(), corpusSearch(__dirname)],
  define: { __RTL_SHA256__: JSON.stringify(rtlSha256()) },
  // the shared system model is imported from ./chip/system (snapshot of the chip repository)
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
  resolve: { dedupe: ['three'] },
  build: { chunkSizeWarningLimit: 2500 },
});
