import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../app/providers';
import { ProductCard } from '../components/ProductCard';
import { Loader, Stars } from '../components/ui';
import { api } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { deliveryLabel } from '../lib/format';
import { openChat } from '../lib/telegram';
import type { Product } from '../types';

function Shelf({ title, items, to }: { title: string; items: Product[]; to?: string }) {
  if (!items.length) return null;
  return (
    <section className="section">
      <div className="head">
        <h2>{title}</h2>
        {to && <Link to={to} className="small">Смотреть все →</Link>}
      </div>
      <div className="hscroll">
        {items.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
    </section>
  );
}

export function Home() {
  const { store } = useStore();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const home = useAsync(() => api.home(), []);
  const cats = useAsync(() => api.categories(), []);

  if (!store) return null;
  const blocks = store.settings.blocks;

  return (
    <div className="page">
      <div className="hero">
        {store.coverUrl && <img className="cover" src={store.coverUrl} alt="" />}
        <div className="storehead">
          {store.logoUrl && <img className="avatar" src={store.logoUrl} alt="" />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1>{store.name}</h1>
            <Link to="/reviews"><Stars value={store.rating} count={store.reviewsCount} /></Link>
          </div>
        </div>
        {store.description && <p className="small muted" style={{ padding: '0 12px 12px' }}>{store.description}</p>}
        <div style={{ padding: '0 12px 12px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {store.city && <span className="tag">📍 {store.city}</span>}
          {store.settings.deliveryMethods.map((d) => (
            <span key={d} className="tag">{deliveryLabel[d]}</span>
          ))}
        </div>
        <div style={{ padding: '0 12px 14px' }}>
          <button className="btn" onClick={() => openChat(store.contactUsername)}>💬 Связаться с продавцом</button>
        </div>
      </div>

      <form
        className="searchbar"
        onSubmit={(e) => {
          e.preventDefault();
          nav(`/catalog?q=${encodeURIComponent(q)}`);
        }}
      >
        <span className="ico">🔎</span>
        <input placeholder="Поиск по магазину" value={q} onChange={(e) => setQ(e.target.value)} />
      </form>

      {cats.data && cats.data.categories.length > 0 && (
        <div className="chips">
          {cats.data.categories.map((c) => (
            <Link key={c.id} to={`/catalog?category=${c.id}`} className="chip">{c.name}</Link>
          ))}
        </div>
      )}

      {home.loading && <Loader />}
      {home.data && (
        <>
          {blocks.newArrivals && <Shelf title="Новинки" items={home.data.newArrivals} to="/catalog?sort=new" />}
          {blocks.discounted && <Shelf title="Со скидкой" items={home.data.discounted} to="/catalog?discounted=1" />}
          {blocks.recent && <Shelf title="Недавно добавлено" items={home.data.recent} to="/catalog" />}
        </>
      )}
    </div>
  );
}
