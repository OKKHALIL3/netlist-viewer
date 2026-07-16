// Engineering-unit formatting for tool payloads: answers cite human-readable
// figures while data keeps the raw SI values alongside.

export function fmtF(farads: number | null): string {
  if (farads === null) return 'n/a';
  const fF = farads * 1e15;
  if (fF >= 1000) return `${(fF / 1000).toFixed(2)} pF`;
  if (fF >= 1) return `${fF.toFixed(2)} fF`;
  return `${fF.toFixed(3)} fF`;
}

export function fmtOhm(ohms: number | null): string {
  if (ohms === null) return 'n/a';
  if (ohms >= 1e6) return `${(ohms / 1e6).toFixed(2)} MΩ`;
  if (ohms >= 1e3) return `${(ohms / 1e3).toFixed(2)} kΩ`;
  return `${ohms.toFixed(1)} Ω`;
}

export function fmtS(seconds: number | null): string {
  if (seconds === null) return 'n/a';
  const ps = seconds * 1e12;
  if (ps >= 1000) return `${(ps / 1000).toFixed(2)} ns`;
  return `${ps.toFixed(2)} ps`;
}
