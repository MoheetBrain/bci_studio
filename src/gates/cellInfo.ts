// Plain-language descriptions of Yosys internal cell types.

const GATE: Record<string, { name: string; fn: string }> = {
  $_AND_: { name: 'AND gate', fn: 'Y = A & B' },
  $_NAND_: { name: 'NAND gate', fn: 'Y = ~(A & B)' },
  $_OR_: { name: 'OR gate', fn: 'Y = A | B' },
  $_NOR_: { name: 'NOR gate', fn: 'Y = ~(A | B)' },
  $_XOR_: { name: 'XOR gate', fn: 'Y = A ^ B (difference / sum bit)' },
  $_XNOR_: { name: 'XNOR gate', fn: 'Y = ~(A ^ B) (equality bit)' },
  $_ANDNOT_: { name: 'AND-NOT gate', fn: 'Y = A & ~B' },
  $_ORNOT_: { name: 'OR-NOT gate', fn: 'Y = A | ~B' },
  $_NOT_: { name: 'Inverter', fn: 'Y = ~A' },
  $_BUF_: { name: 'Buffer', fn: 'Y = A' },
  $_MUX_: { name: '2:1 multiplexer', fn: 'Y = S ? B : A' },
  $_DFF_P_: { name: 'D flip-flop', fn: 'Q ← D on rising clock' },
  $_DFFE_PN0P_: { name: 'D flip-flop, enable, async reset to 0', fn: 'Q ← 0 when R=0; else Q ← D on rising clock when E=1' },
  $_DFFE_PN1P_: { name: 'D flip-flop, enable, async set to 1', fn: 'Q ← 1 when R=0; else Q ← D on rising clock when E=1' },
  $_DFF_PN0_: { name: 'D flip-flop, async reset to 0', fn: 'Q ← 0 when R=0; else Q ← D on rising clock' },
  $_DFF_PN1_: { name: 'D flip-flop, async set to 1', fn: 'Q ← 1 when R=0; else Q ← D on rising clock' },
};

const COARSE: Record<string, string> = {
  $add: 'Adder', $sub: 'Subtractor', $neg: 'Negation (two’s complement)', $mul: 'Multiplier',
  $ge: 'Comparator ≥', $gt: 'Comparator >', $le: 'Comparator ≤', $lt: 'Comparator <', $eq: 'Equality', $ne: 'Inequality',
  $mux: 'Multiplexer', $pmux: 'Parallel multiplexer', $shr: 'Logical right shift', $sshr: 'Arithmetic right shift', $shl: 'Left shift',
  $and: 'Bitwise AND', $or: 'Bitwise OR', $xor: 'Bitwise XOR', $not: 'Bitwise NOT',
  $logic_and: 'Logical AND', $logic_or: 'Logical OR', $logic_not: 'Logical NOT', $reduce_or: 'OR-reduce (≠ 0 test)', $reduce_and: 'AND-reduce', $reduce_bool: 'Bool reduce',
  $adff: 'Register with async reset', $adffe: 'Register with async reset and enable', $dff: 'Register', $dffe: 'Register with enable',
  $memrd: 'Memory read port', $memwr: 'Memory write port', $mem_v2: 'Memory',
};

export function describeCell(type: string): { name: string; fn: string } {
  if (GATE[type]) return GATE[type];
  if (COARSE[type]) return { name: COARSE[type], fn: 'Word-level RTL operator (before technology mapping)' };
  if (type.startsWith('$_DFF')) return { name: 'Flip-flop variant', fn: type };
  if (type.startsWith('$paramod') || !type.startsWith('$')) return { name: 'Submodule instance', fn: type.replace(/^\$paramod.*\\/, '') };
  return { name: type, fn: '' };
}

export function isFlop(type: string) {
  return /DFF|\$adff|\$dff|\$sdff/.test(type);
}

/** Parse a Yosys src attribute like "rtl/hbci_event_core.v:283.12-283.50|other" into line numbers. */
export function srcLines(src: string | undefined): { file: string; line: number }[] {
  if (!src) return [];
  return src.split('|').flatMap((part) => {
    const m = /^(.*):(\d+)(?:\.\d+)?(?:-(\d+)(?:\.\d+)?)?$/.exec(part.trim());
    if (!m) return [];
    const a = +m[2];
    const b = m[3] ? +m[3] : a;
    const out: { file: string; line: number }[] = [];
    for (let l = a; l <= Math.min(b, a + 20); l++) out.push({ file: m[1], line: l });
    return out;
  });
}
