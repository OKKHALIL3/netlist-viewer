// Group a block's net names for the inspector chip list: scalarized bus
// siblings (therm<0>..therm<27>) collapse into one expandable group so a
// 28-bit bus reads as one chip, not twenty-eight.
export interface NetChipGroup {
  label: string;
  members: string[];
}

const BUS_RE = /^(.*?)<(\d+)>$/;

export function groupNetChips(names: string[], minGroup = 3): NetChipGroup[] {
  interface Entry { label: string; members: string[]; order: number }
  const out: Entry[] = [];
  const buses = new Map<string, { indices: number[]; members: string[]; order: number }>();

  names.forEach((name, i) => {
    const m = BUS_RE.exec(name);
    if (m) {
      let b = buses.get(m[1]);
      if (!b) { b = { indices: [], members: [], order: i }; buses.set(m[1], b); }
      b.indices.push(Number(m[2]));
      b.members.push(name);
    } else {
      out.push({ label: name, members: [name], order: i });
    }
  });

  for (const [base, b] of buses) {
    if (b.members.length >= minGroup) {
      const hi = Math.max(...b.indices);
      const lo = Math.min(...b.indices);
      out.push({ label: `${base}<${hi}:${lo}>`, members: b.members, order: b.order });
    } else {
      // Too few siblings to be worth a group — keep them as plain chips.
      b.members.forEach((name, j) => out.push({ label: name, members: [name], order: b.order + j / 1000 }));
    }
  }

  out.sort((a, b) => a.order - b.order);
  return out.map(({ label, members }) => ({ label, members }));
}
