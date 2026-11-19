// Fetch + decode the atlas (manifest + meshoptimizer-encoded chunks) into three.js geometries.
// Geometry positions stay in atlas RAS millimetres; the scene applies the display transform on one parent group.
import { BufferAttribute, BufferGeometry, Box3, Sphere, Vector3 } from 'three';
import { MeshoptDecoder } from 'meshoptimizer';
import type { AtlasManifest, AtlasStructure } from './types';

export const ATLAS_BASE = `${import.meta.env.BASE_URL}atlas/spl-nac/`;

export interface LoadedAtlas {
  manifest: AtlasManifest;
  geometries: Map<string, BufferGeometry>;
}

export class AtlasLoadError extends Error {
  constructor(message: string, readonly detail?: string) { super(message); }
}

async function get(url: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new AtlasLoadError(`Could not reach ${url}`, e instanceof Error ? e.message : String(e));
  }
  if (!res.ok) throw new AtlasLoadError(`${url} returned HTTP ${res.status}`);
  return res;
}

function decodeStructure(s: AtlasStructure, chunk: Uint8Array, q: AtlasManifest['quantisation']): BufferGeometry {
  const stride = q.vertexStride;
  const vtx = new Uint8Array(s.vertexCount * stride);
  MeshoptDecoder.decodeVertexBuffer(vtx, s.vertexCount, stride, chunk.subarray(s.vertexOffset, s.vertexOffset + s.vertexBytes));
  const idxBytes = new Uint8Array(s.indexCount * 4);
  MeshoptDecoder.decodeIndexBuffer(idxBytes, s.indexCount, 4, chunk.subarray(s.indexOffset, s.indexOffset + s.indexBytes));
  const idx32 = new Uint32Array(idxBytes.buffer);

  const dv = new DataView(vtx.buffer);
  const pos = new Float32Array(s.vertexCount * 3);
  const nrm = new Int8Array(s.vertexCount * 3);
  for (let v = 0; v < s.vertexCount; v++) {
    const o = v * stride;
    for (let k = 0; k < 3; k++) {
      pos[v * 3 + k] = dv.getInt16(o + k * 2, true) * q.scaleMm + q.offsetMm[k];
      nrm[v * 3 + k] = dv.getInt8(o + 6 + k);
    }
  }
  for (let i = 0; i < idx32.length; i++) if (idx32[i] >= s.vertexCount) throw new AtlasLoadError(`${s.id}: index out of range`);

  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('normal', new BufferAttribute(nrm, 3, true));
  g.setIndex(new BufferAttribute(s.vertexCount < 65536 ? Uint16Array.from(idx32) : idx32, 1));
  const [lo, hi] = s.boundsMm;
  g.boundingBox = new Box3(new Vector3(...lo), new Vector3(...hi));
  g.boundingSphere = g.boundingBox.getBoundingSphere(new Sphere());
  return g;
}

/**
 * Load the whole atlas. `onProgress(done, total)` counts decoded structures; chunks are fetched in parallel and the
 * cortex chunk is decoded first.
 */
export async function loadAtlas(onProgress?: (done: number, total: number) => void): Promise<LoadedAtlas> {
  const manifest = (await (await get(`${ATLAS_BASE}manifest.json`)).json()) as AtlasManifest;
  if (manifest.format !== 'hbci-atlas/1') throw new AtlasLoadError(`Unsupported atlas format "${manifest.format}"`);
  await MeshoptDecoder.ready;
  const buffers = manifest.chunks.map(async (c) => {
    const buf = new Uint8Array(await (await get(`${ATLAS_BASE}${c.file}`)).arrayBuffer());
    if (buf.byteLength !== c.bytes) throw new AtlasLoadError(`${c.file}: ${buf.byteLength} bytes, manifest says ${c.bytes}`);
    return buf;
  });
  const geometries = new Map<string, BufferGeometry>();
  let done = 0;
  for (let ci = 0; ci < manifest.chunks.length; ci++) {
    const chunk = await buffers[ci];
    for (const s of manifest.structures) {
      if (s.chunk !== ci) continue;
      geometries.set(s.id, decodeStructure(s, chunk, manifest.quantisation));
      done++;
    }
    onProgress?.(done, manifest.structures.length);
    // yield so the first chunk can paint before the rest decode
    await new Promise((r) => setTimeout(r, 0));
  }
  return { manifest, geometries };
}
