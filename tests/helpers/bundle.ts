// Load a studio module that uses bundler-style imports (extensionless paths, JSON) into a Node test:
// bundle it with esbuild (already a Vite dependency) and import the result. Same approach as scripts/check-*.mjs.
import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

export async function load<T = Record<string, unknown>>(entry: string): Promise<T> {
  const out = await build({
    entryPoints: [join(root, entry)], bundle: true, format: 'esm', write: false, platform: 'neutral',
    loader: { '.json': 'json' }, logLevel: 'silent',
  });
  return (await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'))) as T;
}
