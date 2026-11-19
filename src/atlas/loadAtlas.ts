// Fetch + decode the atlas into three.js geometries:
//   • the per-structure meshes (manifest + meshoptimizer chunks) — the atlas's own models, decimated;
//   • the specimen surface (one continuous sheet from the atlas MRI, each vertex carrying a region id);
//   • on demand, the MRI and region-id volumes for the slice view.
// Positions stay in atlas RAS millimetres; the scene applies the display transform on one parent group.
import { BufferAttribute, BufferGeometry, Box3, Sphere, Vector3 } from 'three';
import { MeshoptDecoder } from 'meshoptimizer';
import type { AtlasManifest, AtlasStructure, SpecimenMeta } from './types';
import { OUTER } from './visibility';
import { halfEdgeAdjacency, type Adjacency } from './surfaceFields';

export const ATLAS_BASE = `${import.meta.env.BASE_URL}atlas/spl-nac/`;

export interface Specimen {
  meta: SpecimenMeta;
  geometry: BufferGeometry;
  /** Per-vertex region: 0 = none, else 1-based index into manifest.structures. */
  region: Uint8Array;
  /** Structure ids that own at least one vertex of the surface. */
  /** Vertex neighbours on the surface (for smoothed selection and border fields). */
  adj: Adjacency;
  /** Structures that own at least one surface vertex. */
  surfaceIds: Set<string>;
  /** The subset that belongs to the outer tissue classes, i.e. that can really be seen and selected from outside. */
  exposedIds: Set<string>;
}

export interface LoadedAtlas {
  manifest: AtlasManifest;
  geometries: Map<string, BufferGeometry>;
  specimen: Specimen;
}

export interface SliceVolumes {
  dims: [number, number, number];
  originMm: [number, number, number];
  t1: Uint8Array;
  region: Uint8Array;
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

function decodeMesh(id: string, vertexCount: number, indexCount: number, vBytes: Uint8Array, iBytes: Uint8Array, q: AtlasManifest['quantisation'], stride: number) {
  const vtx = new Uint8Array(vertexCount * stride);
  MeshoptDecoder.decodeVertexBuffer(vtx, vertexCount, stride, vBytes);
  const idxBytes = new Uint8Array(indexCount * 4);
  MeshoptDecoder.decodeIndexBuffer(idxBytes, indexCount, 4, iBytes);
  const idx32 = new Uint32Array(idxBytes.buffer);
  const dv = new DataView(vtx.buffer);
  const pos = new Float32Array(vertexCount * 3);
  const nrm = new Int8Array(vertexCount * 3);
  const ao = new Uint8Array(vertexCount);
  for (let v = 0; v < vertexCount; v++) {
    const o = v * stride;
    for (let k = 0; k < 3; k++) {
      pos[v * 3 + k] = dv.getInt16(o + k * 2, true) * q.scaleMm + q.offsetMm[k];
      nrm[v * 3 + k] = dv.getInt8(o + 6 + k);
    }
    ao[v] = vtx[o + 9];
  }
  for (let i = 0; i < idx32.length; i++) if (idx32[i] >= vertexCount) throw new AtlasLoadError(`${id}: index out of range`);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('normal', new BufferAttribute(nrm, 3, true));
  g.setAttribute('aAo', new BufferAttribute(ao, 1, true));
  g.setIndex(new BufferAttribute(vertexCount < 65536 ? Uint16Array.from(idx32) : idx32, 1));
  return { g, vtx };
}

function decodeStructure(s: AtlasStructure, chunk: Uint8Array, q: AtlasManifest['quantisation']): BufferGeometry {
  const { g } = decodeMesh(s.id, s.vertexCount, s.indexCount, chunk.subarray(s.vertexOffset, s.vertexOffset + s.vertexBytes), chunk.subarray(s.indexOffset, s.indexOffset + s.indexBytes), q, q.vertexStride);
  const [lo, hi] = s.boundsMm;
  g.boundingBox = new Box3(new Vector3(...lo), new Vector3(...hi));
  g.boundingSphere = g.boundingBox.getBoundingSphere(new Sphere());
  return g;
}

async function loadSpecimen(manifest: AtlasManifest): Promise<Specimen> {
  const meta = (await (await get(`${ATLAS_BASE}specimen.json`)).json()) as SpecimenMeta;
  if (meta.format !== 'hbci-specimen/1') throw new AtlasLoadError(`Unsupported specimen format "${meta.format}"`);
  if (meta.regions.structureCount !== manifest.structures.length) throw new AtlasLoadError('The specimen surface was built for a different atlas manifest (run npm run atlas:build)');
  const bin = new Uint8Array(await (await get(`${ATLAS_BASE}${meta.mesh.file}`)).arrayBuffer());
  if (bin.byteLength !== meta.mesh.bytes) throw new AtlasLoadError(`${meta.mesh.file}: ${bin.byteLength} bytes, expected ${meta.mesh.bytes}`);
  const m = meta.mesh;
  const { g, vtx } = decodeMesh('specimen', m.vertexCount, m.indexCount, bin.subarray(0, m.vertexBytes), bin.subarray(m.vertexBytes, m.vertexBytes + m.indexBytes), manifest.quantisation, m.vertexStride);
  const region = new Uint8Array(m.vertexCount), flags = new Uint8Array(m.vertexCount);
  for (let v = 0; v < m.vertexCount; v++) { region[v] = vtx[v * m.vertexStride + 10]; flags[v] = vtx[v * m.vertexStride + 11]; }
  g.setAttribute('aRegion', new BufferAttribute(region, 1, false));
  g.setAttribute('aFlags', new BufferAttribute(flags, 1, false));
  // fields filled in by the scene: smoothed selection mask, and eight smoothed region-class memberships
  g.setAttribute('aSelW', new BufferAttribute(new Uint8Array(m.vertexCount), 1, true));
  g.setAttribute('aParcelA', new BufferAttribute(new Uint8Array(m.vertexCount * 4), 4, true));
  g.setAttribute('aParcelB', new BufferAttribute(new Uint8Array(m.vertexCount * 4), 4, true));
  const adj = halfEdgeAdjacency(m.vertexCount, g.getIndex()!.array);
  g.boundingBox = new Box3(new Vector3(...m.boundsMm[0]), new Vector3(...m.boundsMm[1]));
  g.boundingSphere = g.boundingBox.getBoundingSphere(new Sphere());
  const surfaceIds = new Set<string>();
  for (const r of region) if (r) surfaceIds.add(manifest.structures[r - 1].id);
  const exposedIds = new Set<string>();
  for (const s of manifest.structures) if (surfaceIds.has(s.id) && OUTER.has(s.tissue)) exposedIds.add(s.id);
  return { meta, geometry: g, region, adj, surfaceIds, exposedIds };
}

/**
 * The slice volumes are stored gzip-compressed. Some servers (Vite's dev server among them) announce a `.gz` file with
 * `Content-Encoding: gzip`, in which case the browser has already inflated it; others serve the raw bytes. Look at
 * the gzip magic number instead of trusting either behaviour.
 */
async function gunzip(res: Response): Promise<Uint8Array> {
  const raw = new Uint8Array(await res.arrayBuffer());
  if (!(raw[0] === 0x1f && raw[1] === 0x8b)) return raw;
  if (typeof DecompressionStream === 'undefined') throw new AtlasLoadError('This browser cannot decompress the slice volumes (DecompressionStream is missing)');
  return new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
}

/** The MRI and region-id volumes for the slice view (about 2 MB, loaded only when a cut is first opened). */
export async function loadSlices(meta: SpecimenMeta): Promise<SliceVolumes> {
  const s = meta.slices;
  const [t1, region] = await Promise.all([gunzip(await get(`${ATLAS_BASE}${s.t1.file}`)), gunzip(await get(`${ATLAS_BASE}${s.region.file}`))]);
  const n = s.dims[0] * s.dims[1] * s.dims[2];
  if (t1.byteLength !== n || region.byteLength !== n) throw new AtlasLoadError('Slice volumes have an unexpected size');
  return { dims: s.dims, originMm: s.originMm, t1, region };
}

/** Load the whole atlas. `onProgress(done, total)` counts decoded structures. */
export async function loadAtlas(onProgress?: (done: number, total: number) => void): Promise<LoadedAtlas> {
  const manifest = (await (await get(`${ATLAS_BASE}manifest.json`)).json()) as AtlasManifest;
  if (manifest.format !== 'hbci-atlas/1') throw new AtlasLoadError(`Unsupported atlas format "${manifest.format}"`);
  await MeshoptDecoder.ready;
  const specimenP = loadSpecimen(manifest);
  const buffers = manifest.chunks.map(async (c) => {
    const buf = new Uint8Array(await (await get(`${ATLAS_BASE}${c.file}`)).arrayBuffer());
    if (buf.byteLength !== c.bytes) throw new AtlasLoadError(`${c.file}: ${buf.byteLength} bytes, manifest says ${c.bytes}`);
    return buf;
  });
  specimenP.catch(() => undefined); buffers.forEach((b) => b.catch(() => undefined));   // errors are reported once, below
  const specimen = await specimenP;
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
    await new Promise((r) => setTimeout(r, 0));
  }
  return { manifest, geometries, specimen };
}
