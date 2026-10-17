import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { money } from '../lib/format';
import { haptic } from '../lib/telegram';
import type { Product } from '../types';

export function ProductCard({ product, onFav }: { product: Product; onFav?: (id: string, fav: boolean) => void }) {
  const [fav, setFav] = useState(product.isFavorite);
  const [busy, setBusy] = useState(false);

  async function toggleFav(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    const next = !fav;
    setFav(next); // оптимистично, без перезагрузки (§6.6)
    haptic('light');
    try {
      if (next) await api.addFavorite(product.id);
      else await api.removeFavorite(product.id);
      onFav?.(product.id, next);
    } catch {
      setFav(!next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Link to={`/product/${product.id}`} className="card pcard">
      <div className="thumb">
        {product.coverUrl ? (
          <img src={product.coverUrl} alt={product.title} loading="lazy" />
        ) : (
          <div style={{ width: '100%', height: '100%' }} />
        )}
        {product.discountPercent && !product.isSold && <span className="badge sale">−{product.discountPercent}%</span>}
        {product.isSold && <span className="badge sold">Продано</span>}
        {product.isReserved && !product.isSold && <span className="badge reserved">Забронировано</span>}
        <button className="iconbtn fav" onClick={toggleFav} aria-label={fav ? 'Убрать из избранного' : 'В избранное'} aria-pressed={fav}>
          {fav ? '❤️' : '🤍'}
        </button>
      </div>
      <div className="body">
        <div className="title">{product.title}</div>
        <div>
          <span className="price">{money(product.price)}</span>
          {product.oldPrice && <span className="oldprice">{money(product.oldPrice)}</span>}
        </div>
        <div className="small muted">
          {[product.size && `Размер ${product.size}`, product.brand].filter(Boolean).join(' · ')}
        </div>
      </div>
    </Link>
  );
}
