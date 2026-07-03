export function kopecksToRubles(value: number): string {
  return `${Math.round(value / 100)} ₽`;
}

export function rublesToKopecks(value: number): number {
  return Math.round(value * 100);
}
