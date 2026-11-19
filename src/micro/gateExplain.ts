// Plain-English "Explain this gate" text and truth tables for the generic Yosys gate types shown at Level 3.
// Only the gate's logic function is described: no gate-level simulation exists, so no live values are shown.

export interface GateExplain {
  plain: string;
  /** Column names (inputs then output) and rows of 0/1. Absent for registers and word-level operators. */
  table?: { cols: string[]; rows: number[][] };
  /** One sentence on how this gate maps to transistors at Level 4 (NAND and NOT only, where the cell view shows one). */
  transistors?: string;
}

const T2 = (f: (a: number, b: number) => number) => [[0, 0], [0, 1], [1, 0], [1, 1]].map(([a, b]) => [a, b, f(a, b)]);

const TABLES: Record<string, { cols: string[]; rows: number[][] }> = {
  $_AND_: { cols: ['A', 'B', 'Y'], rows: T2((a, b) => a & b) },
  $_NAND_: { cols: ['A', 'B', 'Y'], rows: T2((a, b) => 1 - (a & b)) },
  $_OR_: { cols: ['A', 'B', 'Y'], rows: T2((a, b) => a | b) },
  $_NOR_: { cols: ['A', 'B', 'Y'], rows: T2((a, b) => 1 - (a | b)) },
  $_XOR_: { cols: ['A', 'B', 'Y'], rows: T2((a, b) => a ^ b) },
  $_XNOR_: { cols: ['A', 'B', 'Y'], rows: T2((a, b) => 1 - (a ^ b)) },
  $_ANDNOT_: { cols: ['A', 'B', 'Y'], rows: T2((a, b) => a & (1 - b)) },
  $_ORNOT_: { cols: ['A', 'B', 'Y'], rows: T2((a, b) => a | (1 - b)) },
  $_NOT_: { cols: ['A', 'Y'], rows: [[0, 1], [1, 0]] },
  $_BUF_: { cols: ['A', 'Y'], rows: [[0, 0], [1, 1]] },
  $_MUX_: { cols: ['S', 'A', 'B', 'Y'], rows: [[0, 0, 0, 0], [0, 1, 0, 1], [0, 0, 1, 0], [0, 1, 1, 1], [1, 0, 0, 0], [1, 1, 0, 0], [1, 0, 1, 1], [1, 1, 1, 1]] },
};

const PLAIN: Record<string, string> = {
  $_AND_: 'Outputs 1 only when both inputs are 1. Used to let a bit through only when a condition holds.',
  $_NAND_: 'An AND followed by a NOT: outputs 0 only when both inputs are 1. In CMOS it is the cheapest two-input gate, which is why it appears so often.',
  $_OR_: 'Outputs 1 when at least one input is 1.',
  $_NOR_: 'An OR followed by a NOT: outputs 1 only when both inputs are 0.',
  $_XOR_: 'Outputs 1 when the inputs differ. In an adder it produces the sum bit; in a comparator it spots a differing bit.',
  $_XNOR_: 'Outputs 1 when the inputs are equal. Chains of these test whether two numbers are the same.',
  $_ANDNOT_: 'A AND (NOT B): passes A only while B is 0.',
  $_ORNOT_: 'A OR (NOT B): outputs 1 if A is 1 or B is 0.',
  $_NOT_: 'Flips one bit: 0 becomes 1 and 1 becomes 0.',
  $_BUF_: 'Copies its input unchanged. Kept to strengthen or separate a signal.',
  $_MUX_: 'A two-way switch: when S is 0 the output copies A, when S is 1 it copies B. This is how the hardware chooses between two results.',
};

export function explainGate(type: string): GateExplain {
  if (/DFF|\$adff|\$dff|\$sdff/.test(type)) {
    return {
      plain: 'A flip-flop: a one-bit memory. On each rising clock edge it copies D to Q and then holds that value until the next edge, whatever D does in between. Every stored number in this block (filter history, counters, accumulators) is a row of these. "Async reset" means a reset pulse clears it at once, without waiting for the clock.',
    };
  }
  if (PLAIN[type]) {
    return {
      plain: PLAIN[type],
      table: TABLES[type],
      transistors: type === '$_NAND_' ? 'In silicon a two-input NAND is 4 transistors: two in parallel to the supply, two in series to ground. Level 4 shows the real SKY130 NAND2 cell.'
        : type === '$_NOT_' ? 'In silicon an inverter is 2 transistors: one to the supply, one to ground. Level 4 shows the real SKY130 inverter cell.'
        : undefined,
    };
  }
  if (type.startsWith('$') && !type.startsWith('$_')) {
    return { plain: 'A word-level operator: Yosys has not yet broken this into single-bit gates. Switch to the "Gates" view to see it after technology mapping.' };
  }
  return { plain: 'A submodule or uncommon cell type. Its function comes from its own Verilog module.' };
}
