// Цены хранятся в сотых долях выбранной для магазина валюты.

export function rublesToKopecks(rub: number): number {
  return Math.round(rub * 100);
}

export function kopecksToRubles(kop: number): number {
  return Math.round(kop) / 100;
}

export function discountPercent(price: number, oldPrice?: number | null): number | null {
  if (!oldPrice || oldPrice <= price) return null;
  return Math.round((1 - price / oldPrice) * 100);
}
