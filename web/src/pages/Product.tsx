import { useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useStore } from '../app/providers';
import { ErrorState, Loader, TopBar } from '../components/ui';
import { api } from '../lib/api';
import { assetUrl } from '../lib/asset';
import { useAsync } from '../lib/useAsync';
import { conditionLabel, dateShort, deliveryLabel, money } from '../lib/format';
import { haptic } from '../lib/telegram';
import { Icon } from '../components/Icon';
import { addToCart } from '../lib/cart';

export function ProductPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { store } = useStore();
  const { data, loading, error, reload } = useAsync(() => api.product(id!), [id]);
  const [active, setActive] = useState(0);
  const [fav, setFav] = useState<boolean | null>(null);
  const [favBusy, setFavBusy] = useState(false);
  const [variantId, setVariantId] = useState('');
  const [quantity, setQuantity] = useState(1);

  if (loading) return <div className="page"><Loader /></div>;
  if (error || !data) return <div className="page"><TopBar title="Товар" fallback="/catalog" /><ErrorState message={error ?? 'Не найдено'} onRetry={reload} /></div>;

  const p = data.product;
  const isFav = fav ?? p.isFavorite;
  const variant = p.variants.find((v) => v.id === variantId) ?? p.variants.find((v) => v.available > 0);

  async function toggleFav() {
    if (favBusy) return;
    setFavBusy(true);
    const next = !isFav;
    setFav(next);
    haptic('light');
    try {
      if (next) await api.addFavorite(p.id);
      else await api.removeFavorite(p.id);
    } catch { setFav(!next); }
    finally { setFavBusy(false); }
  }

  async function buy() {
    if (!variant || variant.available < quantity) return;
    haptic('medium');
    api.logEvent('buy_click', p.id);
    addToCart({ productId: p.id, variantId: variant.id, quantity });
    nav('/cart');
  }

  return (
    <div className="page" style={{ paddingBottom: 96 }}>
      <TopBar title="" fallback="/catalog" right={<button className="iconbtn" style={{ background: 'var(--tg-secondary-bg)', color: 'var(--tg-text)' }} onClick={toggleFav} disabled={favBusy} aria-label={isFav ? 'Убрать из избранного' : 'В избранное'} aria-pressed={isFav}><Icon name="heart" filled={isFav} size={22} /></button>} />

      <div className="gallery" onScroll={(e) => {
        const el = e.currentTarget;
        setActive(Math.round(el.scrollLeft / el.clientWidth));
      }}>
        {p.images.length ? p.images.map((im) => <img key={im.id} src={assetUrl(im.url)} alt={p.title} />) : <div style={{ aspectRatio: '3/4', background: 'var(--tg-secondary-bg)', width: '100%' }} />}
      </div>
      {p.images.length > 1 && (
        <div className="dots">{p.images.map((_, i) => <span key={i} className={`d ${i === active ? 'on' : ''}`} />)}</div>
      )}

      <div style={{ marginTop: 14 }}>
        {p.isSold && <div className="badge sold" style={{ position: 'static', display: 'inline-block', marginBottom: 8 }}>Продано</div>}
        {p.isReserved && !p.isSold && <div className="badge reserved" style={{ position: 'static', display: 'inline-block', marginBottom: 8 }}>Забронировано</div>}
        <h1>{p.title}</h1>
        <div style={{ margin: '8px 0' }}>
          <span className="price" style={{ fontSize: 22 }}>{money(p.price, store?.settings.currency)}</span>
          {p.oldPrice && <span className="oldprice" style={{ fontSize: 16 }}>{money(p.oldPrice, store?.settings.currency)}</span>}
          {p.discountPercent && <span className="badge sale" style={{ position: 'static', marginLeft: 8 }}>−{p.discountPercent}%</span>}
        </div>
      </div>

      <div className="card" style={{ padding: '4px 14px', marginTop: 12 }}>
        {p.brand && <Row k="Бренд" v={p.brand} />}
        {p.variants.length === 1 && <Row k="Размер" v={p.variants[0].size} />}
        {p.color && <Row k="Цвет" v={p.color} />}
        {p.gender && <Row k="Для кого" v={{ men: 'Мужское', women: 'Женское', unisex: 'Унисекс' }[p.gender]} />}
        {p.material && <Row k="Материал" v={p.material} />}
        <Row k="Состояние" v={conditionLabel[p.condition]} />
        {store?.city && <Row k="Город" v={store.city} />}
        {store && <Row k="Получение" v={store.settings.deliveryMethods.map((d) => deliveryLabel[d]).join(', ')} />}
        {p.publishedAt && <Row k="Опубликовано" v={dateShort(p.publishedAt)} />}
      </div>

      {p.isAvailable && <div className="product-pick">
        <div className="field"><label htmlFor="product-size">Размер</label><div className="select-wrap"><select id="product-size" value={variant?.id ?? ''} onChange={(e) => { setVariantId(e.target.value); setQuantity(1); }}>
          {p.variants.map((v) => <option key={v.id} value={v.id} disabled={!v.available}>{v.size} · {v.available ? `в наличии ${v.available}` : 'нет в наличии'}</option>)}
        </select><Icon name="chevronDown" size={18} /></div></div>
        {variant && variant.available > 1 && <div className="field"><label htmlFor="product-quantity">Количество</label><input id="product-quantity" type="number" inputMode="numeric" min={1} max={variant.available} value={quantity} onChange={(e) => setQuantity(Math.max(1, Math.min(variant.available, Number(e.target.value) || 1)))} /></div>}
      </div>}

      {p.description && (
        <div className="section">
          <h2>Описание</h2>
          <p style={{ whiteSpace: 'pre-wrap' }}>{p.description}</p>
        </div>
      )}
      {p.measurements && <div className="section"><h2>Замеры</h2><p style={{ whiteSpace: 'pre-wrap' }}>{p.measurements}</p></div>}
      {p.videoUrl && <div className="section"><h2>Видео товара</h2><video className="product-video-preview" src={assetUrl(p.videoUrl)} controls preload="metadata" /></div>}
      {p.defects && (
        <div className="section">
          <h2>Дефекты</h2>
          <p className="muted" style={{ whiteSpace: 'pre-wrap' }}>{p.defects}</p>
        </div>
      )}
      {p.defectImages.length > 0 && <div className="section"><h2>Фото дефектов</h2><div className="product-defect-gallery">{p.defectImages.map((url, index) => <a key={url} href={assetUrl(url)} target="_blank" rel="noreferrer" aria-label={`Открыть фото дефекта ${index + 1}`}><img src={assetUrl(url)} alt={`Дефект ${index + 1}`} loading="lazy" /></a>)}</div></div>}

      <Link to="/reviews" className="small">Профиль и отзывы продавца →</Link>

      <div className="bar">
        <Link className="btn outline" style={{ flex: '0 0 auto', width: 'auto' }} to={`/chat?product=${p.id}`}><Icon name="chat" size={18} />Вопрос</Link>
        {p.isAvailable ? (
          <button className="btn" onClick={buy} disabled={!variant || variant.available < quantity}><Icon name="cart" size={18} />В корзину</button>
        ) : (
          <button className="btn" disabled>{p.isSold ? 'Вещь уже забрали' : 'Недоступно'}</button>
        )}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="kv">
      <span className="k">{k}</span>
      <span style={{ textAlign: 'right' }}>{v}</span>
    </div>
  );
}
