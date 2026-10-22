import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore, useToast } from '../../app/providers';
import { Empty, ErrorState, Loader } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { adminApi, ApiError } from '../../lib/api';
import { assetUrl } from '../../lib/asset';
import { money } from '../../lib/format';
import type { Product } from '../../types';

const STATUS_LABEL: Record<string, string> = {
  draft: 'Черновик', published: 'Опубликован', reserved: 'Забронирован', sold: 'Продан', archived: 'Архив',
};
const STATUS_TABS = ['', 'published', 'draft', 'reserved', 'sold', 'archived'];

export function AdminProducts() {
  const { store } = useStore();
  const toast = useToast();
  const nav = useNavigate();
  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('new');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    const timer = window.setTimeout(() => {
      adminApi.products(store!.id, { q: q || undefined, status: status || undefined, sort, page })
        .then((r) => { if (active) { setItems((prev) => page === 1 ? r.items : [...prev, ...r.items]); setHasMore(r.hasMore); } })
        .catch((e) => { if (active) setError(e instanceof ApiError ? e.message : 'Не удалось загрузить товары'); })
        .finally(() => { if (active) setLoading(false); });
    }, q ? 350 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [store?.id, q, status, sort, page, reloadKey]);

  const reload = () => { setPage(1); setReloadKey((n) => n + 1); };

  async function act(p: Product, fn: () => Promise<unknown>, msg: string) {
    try { await fn(); toast(msg); reload(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Ошибка'); }
  }

  function toggleSel(id: string) {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function bulkArchive() {
    if (!selected.size || !confirm(`Архивировать выбранные (${selected.size})?`)) return;
    try {
      await adminApi.bulkArchive(store!.id, [...selected]);
      toast('Готово');
      setSelected(new Set());
      reload();
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Не удалось архивировать товары'); }
  }

  return (
    <div className="page">
      <div className="topbar">
        <h1 style={{ flex: 1 }}>Товары</h1>
        <Link to="/admin/categories" className="btn small outline" style={{ width: 'auto' }}>Категории</Link>
        <Link to="/admin/products/new" className="btn small" style={{ width: 'auto' }}>+ Товар</Link>
      </div>

      <div className="searchbar">
        <span className="ico"><Icon name="search" /></span>
        <input aria-label="Поиск товаров" placeholder="Поиск по названию, бренду, артикулу" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); setSelected(new Set()); }} />
      </div>

      <div className="tabs">
        {STATUS_TABS.map((s) => (
          <button key={s || 'all'} className={`chip ${status === s ? 'active' : ''}`} onClick={() => { setStatus(s); setPage(1); setSelected(new Set()); }}>
            {s ? STATUS_LABEL[s] : 'Все'}
          </button>
        ))}
      </div>
      <div className="chips wrap-chips" style={{ marginBottom: 12 }}>
        {[['new', 'Новые'], ['price_desc', 'Дороже'], ['price_asc', 'Дешевле']].map(([v, l]) => (
          <button key={v} className={`chip ${sort === v ? 'active' : ''}`} onClick={() => { setSort(v); setPage(1); }}>{l}</button>
        ))}
      </div>

      {selected.size > 0 && (
        <div className="admin-bulk-actions" style={{ marginBottom: 12 }}>
          <button className="btn small outline" onClick={() => setSelected(new Set())}>Снять ({selected.size})</button>
          <button className="btn small danger" onClick={bulkArchive}>Архивировать выбранные</button>
        </div>
      )}

      {loading && page === 1 ? <Loader /> : error ? <ErrorState message={error} onRetry={reload} /> : items.length === 0 ? (
        <Empty icon="catalog" title="У вас пока нет товаров" action={<Link to="/admin/products/new" className="btn small" style={{ width: 'auto' }}>Добавить товар</Link>} />
      ) : (
        <div className="list">
          {items.map((p) => (
            <div key={p.id} className="card admin-product-card">
              <div className="listitem">
                <label className="admin-product-select">
                  <input type="checkbox" aria-label={`Выбрать ${p.title}`} checked={selected.has(p.id)} onChange={() => toggleSel(p.id)} />
                </label>
                {p.coverUrl ? <img className="thumb" src={assetUrl(p.coverUrl)} alt="" /> : <div className="thumb" />}
                <div className="grow">
                  <div style={{ fontWeight: 600 }}>{p.title}</div>
                  <div className="price">{money(p.price)}</div>
                  <span className="tag" style={{ marginTop: 4, display: 'inline-block' }}>{STATUS_LABEL[p.status]}</span>
                </div>
              </div>
              <div className="admin-product-actions">
                <button className="chip" onClick={() => nav(`/admin/products/${p.id}`)}><Icon name="edit" size={16} />Изменить</button>
                {p.status === 'draft' && <button className="chip" onClick={() => act(p, () => adminApi.setStatus(store!.id, p.id, 'published'), 'Опубликован')}>Опубликовать</button>}
                {p.status === 'published' && <button className="chip" onClick={() => act(p, () => adminApi.setStatus(store!.id, p.id, 'draft'), 'В черновик')}>Снять</button>}
                <button className="chip" onClick={() => act(p, () => adminApi.duplicate(store!.id, p.id), 'Дубль создан')}>Дублировать</button>
                {p.status !== 'archived' && p.status !== 'reserved' && <button className="chip" onClick={() => act(p, () => adminApi.archive(store!.id, p.id), 'В архив')}>Архив</button>}
              </div>
            </div>
          ))}
          {hasMore && <button className="btn outline" disabled={loading} onClick={() => setPage((n) => n + 1)}>{loading ? 'Загружаем…' : 'Показать ещё'}</button>}
        </div>
      )}
    </div>
  );
}
