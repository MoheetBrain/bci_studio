// Which 3D level / System preset a subtree belongs to (kept in its own module so hot reloads keep identity).
import { createContext } from 'react';
import type { Preset } from '../model/types';
import type { Level3D } from './viewStore';

export const LevelContext = createContext<Level3D>('system');
/** System-level preset of a subtree (null outside the System presets). */
export const PresetContext = createContext<Preset | null>(null);
