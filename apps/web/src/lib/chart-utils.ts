export function niceStep(range: number, targetTicks = 5): number {
  if (range <= 0) return 1;
  const rough = range / targetTicks;
  const exp = 10 ** Math.floor(Math.log10(rough));
  const norm = rough / exp;
  if (norm < 1.5) return exp;
  if (norm < 3.5) return exp * 2;
  if (norm < 7.5) return exp * 5;
  return exp * 10;
}
