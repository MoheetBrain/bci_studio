// Everything in the scene that can be pointed at, gathered from whoever draws it. Each part of the scene registers the
// stand-ins of what it draws under its own key (cells, context cells, connections, landmarks, instruments, handles);
// the view hands the whole list to the controller whenever it changes. Ids are stable: the same id is used for
// drawing, aiming, the inspector and what is saved.
import type { PickBody } from './flight';

const sets = new Map<string, PickBody[]>();
let version = 0;
export function setBodies(key: string, bodies: PickBody[] | null): void { if (bodies) sets.set(key, bodies); else sets.delete(key); version++; }
export const allBodies = (): PickBody[] => [...sets.values()].flat();
export const bodiesVersion = (): number => version;
export function clearBodies(): void { sets.clear(); version++; }
