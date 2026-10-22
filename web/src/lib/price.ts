export function parsePrice(value: string): number {
  const normalized = value.trim().replace(/\s/g, '').replace(',', '.');
  return normalized ? Number(normalized) : 0;
}
