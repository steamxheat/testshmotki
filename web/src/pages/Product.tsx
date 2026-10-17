import { useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useStore } from '../app/providers';
import { ErrorState, Loader, TopBar } from '../components/ui';
import { api } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { conditionLabel, dateShort, deliveryLabel, money } from '../lib/format';
import { haptic, openChat } from '../lib/telegram';

export function ProductPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { store } = useStore();
  const { data, loading, error, reload } = useAsync(() => api.product(id!), [id]);
  const [active, setActive] = useState(0);
  const [fav, setFav] = useState<boolean | null>(null);

  if (loading) return <div className="page"><Loader /></div>;
  if (error || !data) return <div className="page"><TopBar title="Товар" /><ErrorState message={error ?? 'Не найдено'} onRetry={reload} /></div>;

  const p = data.product;
  const isFav = fav ?? p.isFavorite;

  async function toggleFav() {
    const next = !isFav;
    setFav(next);
    haptic('light');
    try {
      if (next) await api.addFavorite(p.id);
      else await api.removeFavorite(p.id);
    } catch { setFav(!next); }
  }

  async function buy() {
    haptic('medium');
    api.logEvent('buy_click', p.id);
    nav(`/checkout/${p.id}`);
  }

  return (
    <div className="page" style={{ paddingBottom: 96 }}>
      <TopBar title="" right={<button className="iconbtn" style={{ background: 'var(--tg-secondary-bg)', color: 'var(--tg-text)' }} onClick={toggleFav} aria-pressed={isFav}>{isFav ? '❤️' : '🤍'}</button>} />

      <div className="gallery" onScroll={(e) => {
        const el = e.currentTarget;
        setActive(Math.round(el.scrollLeft / el.clientWidth));
      }}>
        {p.images.length ? p.images.map((im) => <img key={im.id} src={im.url} alt={p.title} />) : <div style={{ aspectRatio: '3/4', background: 'var(--tg-secondary-bg)', width: '100%' }} />}
      </div>
      {p.images.length > 1 && (
        <div className="dots">{p.images.map((_, i) => <span key={i} className={`d ${i === active ? 'on' : ''}`} />)}</div>
      )}

      <div style={{ marginTop: 14 }}>
        {p.isSold && <div className="badge sold" style={{ position: 'static', display: 'inline-block', marginBottom: 8 }}>Продано</div>}
        {p.isReserved && !p.isSold && <div className="badge reserved" style={{ position: 'static', display: 'inline-block', marginBottom: 8 }}>Забронировано</div>}
        <h1>{p.title}</h1>
        <div style={{ margin: '8px 0' }}>
          <span className="price" style={{ fontSize: 22 }}>{money(p.price)}</span>
          {p.oldPrice && <span className="oldprice" style={{ fontSize: 16 }}>{money(p.oldPrice)}</span>}
          {p.discountPercent && <span className="badge sale" style={{ position: 'static', marginLeft: 8 }}>−{p.discountPercent}%</span>}
        </div>
      </div>

      <div className="card" style={{ padding: '4px 14px', marginTop: 12 }}>
        {p.brand && <Row k="Бренд" v={p.brand} />}
        {p.size && <Row k="Размер" v={p.size} />}
        {p.color && <Row k="Цвет" v={p.color} />}
        <Row k="Состояние" v={conditionLabel[p.condition]} />
        {store?.city && <Row k="Город" v={store.city} />}
        {store && <Row k="Получение" v={store.settings.deliveryMethods.map((d) => deliveryLabel[d]).join(', ')} />}
        {p.publishedAt && <Row k="Опубликовано" v={dateShort(p.publishedAt)} />}
      </div>

      {p.description && (
        <div className="section">
          <h2>Описание</h2>
          <p style={{ whiteSpace: 'pre-wrap' }}>{p.description}</p>
        </div>
      )}
      {p.defects && (
        <div className="section">
          <h2>Дефекты</h2>
          <p className="muted" style={{ whiteSpace: 'pre-wrap' }}>{p.defects}</p>
        </div>
      )}

      <Link to="/reviews" className="small">Профиль и отзывы продавца →</Link>

      <div className="bar">
        <button className="btn outline" style={{ flex: '0 0 auto', width: 'auto' }} onClick={() => openChat(store?.contactUsername)}>💬 Вопрос</button>
        {p.isAvailable ? (
          <button className="btn" onClick={buy}>Хочу купить</button>
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
