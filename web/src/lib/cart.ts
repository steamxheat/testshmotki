import { useEffect, useState } from 'react';
import { getStoreSlug } from './telegram';

export type CartItem = { productId: string; variantId: string; quantity: number };
const key = () => `cart_${getStoreSlug()}`;
let fallback: CartItem[] = [];

export function getCart(): CartItem[] {
  try {
    const value = JSON.parse(localStorage.getItem(key()) ?? '[]');
    return Array.isArray(value) ? value.filter((i) => typeof i.productId === 'string' && typeof i.variantId === 'string' && Number.isInteger(i.quantity) && i.quantity > 0).slice(0, 30) : [];
  } catch { return fallback; }
}

export function setCart(items: CartItem[]) {
  fallback = items;
  try { localStorage.setItem(key(), JSON.stringify(items)); } catch { /* private mode */ }
  window.dispatchEvent(new Event('shmotki-cart'));
}

export function addToCart(item: CartItem) {
  const items = getCart();
  const found = items.find((i) => i.variantId === item.variantId);
  if (found) found.quantity += item.quantity;
  else items.push(item);
  setCart(items);
}

export function useCart() {
  const [items, setItems] = useState(getCart);
  useEffect(() => {
    const refresh = () => setItems(getCart());
    window.addEventListener('shmotki-cart', refresh);
    window.addEventListener('storage', refresh);
    return () => { window.removeEventListener('shmotki-cart', refresh); window.removeEventListener('storage', refresh); };
  }, []);
  return items;
}
