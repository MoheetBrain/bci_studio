// Hardware-view navigation state (circuit / gates), owned by the main agent.
import { create } from 'zustand';

interface HwState {
  /** Verilog module the gates view should open (base module name). */
  gatesModule: string | null;
  setGatesModule: (m: string | null) => void;
}

export const useHw = create<HwState>((set) => ({
  gatesModule: 'hbci_refractory_ctrl',
  setGatesModule: (m) => set({ gatesModule: m }),
}));
