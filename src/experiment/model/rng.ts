// Deterministic random numbers for the experiment models. Same seed → same numbers on any machine.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal samples from a uniform generator (Box–Muller, both values of each pair are used). */
export function gaussian(r: () => number): () => number {
  let spare = 0, has = false;
  return () => {
    if (has) { has = false; return spare; }
    let u = 0;
    while (u === 0) u = r();
    const m = Math.sqrt(-2 * Math.log(u)), a = 2 * Math.PI * r();
    spare = m * Math.sin(a); has = true;
    return m * Math.cos(a);
  };
}

/** A different, well-mixed seed for each (seed, stream) pair. */
export function subSeed(seed: number, stream: number): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (stream + 0x85ebca6b), 0xc2b2ae35) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x27d4eb2f) >>> 0; h ^= h >>> 13;
  return h >>> 0;
}
