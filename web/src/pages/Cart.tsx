import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Empty, ErrorState, Loader } from '../components/ui';
import { Icon } from '../components/Icon';
import { api } from '../lib/api';
import { assetUrl } from '../lib/asset';
import { getCart, setCart, useCart } from '../lib/cart';
import { money } from '../lib/format';
import type { Product } from '../types';

export function Cart() {
  const items = useCart();
  const [products, setProducts] = useState<Record<string, Product>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const ids = [...new Set(items.map((i) => i.productId))].join(',');

  useEffect(() => {
    if (!ids) { setProducts({}); return; }
    let active = true;
    setLoading(true);
    Promise.allSettled(ids.split(',').map((id) => api.product(id)))
      .then((results) => {
        if (!active) return;
        const next: Record<string, Product> = {};
        results.forEach((r) => { if (r.status === 'fulfilled') next[r.value.product.id] = r.value.product; });
        setProducts(next);
        setError(results.some((r) => r.status === 'rejected') ? 'Некоторые товары недоступны. Удалите их из корзины или попробуйте обновить.' : null);
      }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [ids, retry]);

  const change = (variantId: string, quantity: number) => setCart(getCart().map((i) => i.variantId === variantId ? { ...i, quantity } : i));
  const remove = (variantId: string) => setCart(getCart().filter((i) => i.variantId !== variantId));
  const valid = items.length > 0 && items.every((i) => {
    const p = products[i.productId];
    return p?.isAvailable && (p.variants.find((v) => v.id === i.variantId)?.available ?? 0) >= i.quantity;
  });
  const total = items.reduce((sum, i) => sum + (products[i.productId]?.price ?? 0) * i.quantity, 0);

  return <div className="page cart-page">
    <h1>Корзина</h1>
    {loading && <Loader text="Проверяем наличие…" />}
    {error && <ErrorState message={error} onRetry={() => setRetry((n) => n + 1)} />}
    {!loading && items.length === 0 && <Empty icon="cart" title="Корзина пуста" hint="Добавьте вещи из каталога" action={<Link className="btn small" to="/catalog">В каталог</Link>} />}
    {!loading && items.length > 0 && <>
      <div className="list">
        {items.map((item) => {
          const p = products[item.productId];
          const v = p?.variants.find((variant) => variant.id === item.variantId);
          const available = p?.isAvailable ? v?.available ?? 0 : 0;
          return <div key={item.variantId} className="card cart-item">
            {p?.coverUrl && <img className="thumb" src={assetUrl(p.coverUrl)} alt="" />}
            <div className="grow">
              <Link to={`/product/${item.productId}`} className="cart-title">{p?.title ?? 'Товар больше недоступен'}</Link>
              <div className="small muted">Размер: {v?.size ?? 'недоступен'}</div>
              {p && <div className="price">{money(p.price * item.quantity)}</div>}
              {available < item.quantity && <div className="small cart-warning">Доступно: {available}. Измените количество или удалите позицию.</div>}
              <div className="cart-controls">
                <button type="button" aria-label={`Уменьшить количество ${p?.title ?? ''}`} onClick={() => change(item.variantId, Math.max(1, item.quantity - 1))} disabled={item.quantity <= 1}>−</button>
                <span aria-label={`Количество ${item.quantity}`}>{item.quantity}</span>
                <button type="button" aria-label={`Увеличить количество ${p?.title ?? ''}`} onClick={() => change(item.variantId, item.quantity + 1)} disabled={item.quantity >= available}>+</button>
                <button type="button" className="cart-remove" aria-label={`Убрать ${p?.title ?? ''}`} onClick={() => remove(item.variantId)}><Icon name="close" size={18} /></button>
              </div>
            </div>
          </div>;
        })}
      </div>
      <div className="cart-summary"><span>Товары</span><strong>{money(total)}</strong></div>
      <p className="small muted">Доставка рассчитывается отдельно. Наличие окончательно проверяется при отправке заявки.</p>
      <Link className={`btn ${valid ? '' : 'disabled-link'}`} to={valid ? '/checkout' : '/cart'} aria-disabled={!valid} onClick={(e) => { if (!valid) e.preventDefault(); }}>Оформить заявку</Link>
    </>}
  </div>;
}
