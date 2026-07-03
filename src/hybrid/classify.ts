import type { Cell, Design } from '../parser/types';
import type { HybridModel } from './model';

export const TAXONOMY: Record<'A' | 'D' | 'AMS', string[]> = {
  A: ['AMP', 'OSC', 'FILT', 'REF/BIAS', 'PM', 'CMP', 'S/H', 'RF', 'SENS', 'PROT'],
  D: ['LOGIC', 'CLK', 'SEQ', 'CTRL', 'MEM', 'IF', 'LS', 'TIM'],
  AMS: ['DC', 'PLL', 'SERDES', 'IO', 'XLS', 'DAA', 'TD', 'MON'],
};
export const UNCLASSIFIED = 'Unclassified';

const RULES: Array<[RegExp, string]> = [
  [/iobuf|obuf|ibuf|pad|slew|drv|io_/i, 'AMS:IO'],
  [/dac(?![a-z])|adc(?![a-z])|sar(?![a-z])/i, 'AMS:DC'],
  [/pll(?![a-z])|dll(?![a-z])|cdr(?![a-z])|pfd(?![a-z])|chgp(?![a-z])/i, 'AMS:PLL'],
  [/serdes|ffe(?![a-z])|dfe(?![a-z])|afe(?![a-z])/i, 'AMS:SERDES'],
  [/interp|deskew|tdc|_pi_|^pi_/i, 'AMS:TD'],
  [/lvl(?![a-z])|lvshift|shift/i, 'D:LS'],
  [/osc(?![a-z])|ring(?![a-z])|vco(?![a-z])|dco(?![a-z])/i, 'A:OSC'],
  [/bias|mirror|bgap|bg_|vref|iref/i, 'A:REF/BIAS'],
  [/amp(?![a-z])|ota(?![a-z])|tia(?![a-z])|vga(?![a-z])|_pa_|opamp(?![a-z])/i, 'A:AMP'],
  [/cmp(?![a-z])|comp(?![a-z])|slicer|senseamp|strongarm|sa_ff/i, 'A:CMP'],
  [/ldo(?![a-z])|pump(?![a-z])|dcdc(?![a-z])|por(?![a-z])|pgate(?![a-z])|psw(?![a-z])/i, 'A:PM'],
  [/div(?![a-z])|ck(?![a-z])|clk(?![a-z])|glitch(?![a-z])/i, 'D:CLK'],
  [/filt|ctle|eq_/i, 'A:FILT'],
  [/esd|decap|term|dmy|dummy/i, 'A:PROT'],
  [/sens|tmon(?![a-z])|vmon(?![a-z])/i, 'A:SENS'],
  [/sram|rom|regfile|efuse|otp/i, 'D:MEM'],
  [/spi(?![a-z])|i2c(?![a-z])|jtag(?![a-z])|bist(?![a-z])|dft(?![a-z])|scan(?![a-z])/i, 'D:IF'],
  [/dly(?![a-z])|delay|dline/i, 'D:TIM'],
  [/dff(?![a-z])|latch|_ff|flop(?![a-z])|fsm(?![a-z])|cnt(?![a-z])|count(?![a-z])/i, 'D:SEQ'],
  [/ctrl|decod|calib|trim|cfg|reg/i, 'D:CTRL'],
  [/inv(?![a-z])|nand(?![a-z])|nor(?![a-z])|mux(?![a-z])|buf(?![a-z])|and(?![a-z])|or_|xor(?![a-z])|xnor(?![a-z])|logic|gate/i, 'D:LOGIC'],
];

export interface Classifier { classify(cellName: string, cell: Cell | undefined): string | null }

export function ruleClassifier(): Classifier {
  return {
    classify(cellName, cell) {
      for (const [re, cat] of RULES) if (re.test(cellName)) return cat;
      if (cell && cell.instances.length === 0 && cell.primitives.length > 0 &&
          cell.primitives.every(p => p.kind === 'R' || p.kind === 'C')) return 'A:PROT';
      return null;
    },
  };
}

// localStorage-backed overrides with in-memory fallback for node tests.
const mem = new Map<string, Record<string, string>>();
const storeKey = (design: string) => `hybrid-class-overrides:${design}`;

export function loadOverrides(designName: string): Record<string, string> {
  if (typeof localStorage === 'undefined') return mem.get(designName) ?? {};
  try { return JSON.parse(localStorage.getItem(storeKey(designName)) ?? '{}'); } catch { return {}; }
}

export function saveOverride(designName: string, cellName: string, category: string | null): void {
  const all = loadOverrides(designName);
  if (category === null) delete all[cellName]; else all[cellName] = category;
  if (typeof localStorage === 'undefined') mem.set(designName, all);
  else localStorage.setItem(storeKey(designName), JSON.stringify(all));
}

export function classifyModel(model: HybridModel, design: Design, designName: string): void {
  const overrides = loadOverrides(designName);
  const rules = ruleClassifier();
  const perCell = new Map<string, string>();
  for (const b of model.blocks.values()) {
    let cat = perCell.get(b.master);
    if (!cat) {
      cat = overrides[b.master] ?? rules.classify(b.master, design.cells.get(b.master)) ?? UNCLASSIFIED;
      perCell.set(b.master, cat);
    }
    b.category = cat;
  }
}
