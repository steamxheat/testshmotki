import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore, useToast } from '../../app/providers';
import { Empty, Loader } from '../../components/ui';
import { adminApi, ApiError } from '../../lib/api';
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

  function load() {
    setLoading(true);
    adminApi.products(store!.id, { q: q || undefined, status: status || undefined, sort })
      .then((r) => setItems(r.items))
      .finally(() => setLoading(false));
  }
  useEffect(load, [store?.id, status, sort]);
  useEffect(() => { const t = setTimeout(load, 350); return () => clearTimeout(t); }, [q]);

  async function act(p: Product, fn: () => Promise<unknown>, msg: string) {
    try { await fn(); toast(msg); load(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Ошибка'); }
  }

  function toggleSel(id: string) {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function bulkArchive() {
    if (!selected.size || !confirm(`Архивировать выбранные (${selected.size})?`)) return;
    await adminApi.bulkArchive(store!.id, [...selected]);
    toast('Готово');
    setSelected(new Set());
    load();
  }

  return (
    <div className="page">
      <div className="topbar">
        <h1 style={{ flex: 1 }}>Товары</h1>
        <Link to="/admin/categories" className="btn small outline" style={{ width: 'auto' }}>Категории</Link>
        <Link to="/admin/products/new" className="btn small" style={{ width: 'auto' }}>+ Товар</Link>
      </div>

      <div className="searchbar">
        <span className="ico">🔎</span>
        <input placeholder="Поиск по названию, бренду, артикулу" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="tabs">
        {STATUS_TABS.map((s) => (
          <button key={s || 'all'} className={`chip ${status === s ? 'active' : ''}`} onClick={() => setStatus(s)}>
            {s ? STATUS_LABEL[s] : 'Все'}
          </button>
        ))}
      </div>
      <div className="chips" style={{ marginBottom: 12 }}>
        {[['new', 'Новые'], ['price_desc', 'Дороже'], ['price_asc', 'Дешевле']].map(([v, l]) => (
          <button key={v} className={`chip ${sort === v ? 'active' : ''}`} onClick={() => setSort(v)}>{l}</button>
        ))}
      </div>

      {selected.size > 0 && (
        <div className="row" style={{ marginBottom: 12 }}>
          <button className="btn small outline" onClick={() => setSelected(new Set())}>Снять ({selected.size})</button>
          <button className="btn small danger" onClick={bulkArchive}>Архивировать выбранные</button>
        </div>
      )}

      {loading ? <Loader /> : items.length === 0 ? (
        <Empty icon="🧥" title="У вас пока нет товаров" action={<Link to="/admin/products/new" className="btn small" style={{ width: 'auto' }}>Добавить товар</Link>} />
      ) : (
        <div className="list">
          {items.map((p) => (
            <div key={p.id} className="card listitem" style={{ alignItems: 'stretch' }}>
              <input type="checkbox" style={{ width: 'auto', minHeight: 'auto', alignSelf: 'center' }} checked={selected.has(p.id)} onChange={() => toggleSel(p.id)} />
              {p.coverUrl ? <img className="thumb" src={p.coverUrl} alt="" /> : <div className="thumb" />}
              <div className="grow">
                <div style={{ fontWeight: 600 }}>{p.title}</div>
                <div className="price">{money(p.price)}</div>
                <span className="tag" style={{ marginTop: 4, display: 'inline-block' }}>{STATUS_LABEL[p.status]}</span>
                <div className="chips" style={{ marginTop: 8 }}>
                  <button className="chip" onClick={() => nav(`/admin/products/${p.id}`)}>✏️ Изменить</button>
                  {p.status === 'draft' && <button className="chip" onClick={() => act(p, () => adminApi.setStatus(store!.id, p.id, 'published'), 'Опубликован')}>Опубликовать</button>}
                  {p.status === 'published' && <button className="chip" onClick={() => act(p, () => adminApi.setStatus(store!.id, p.id, 'draft'), 'В черновик')}>Снять</button>}
                  <button className="chip" onClick={() => act(p, () => adminApi.duplicate(store!.id, p.id), 'Дубль создан')}>Дублировать</button>
                  {p.status !== 'archived' && p.status !== 'reserved' && <button className="chip" onClick={() => act(p, () => adminApi.archive(store!.id, p.id), 'В архив')}>Архив</button>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
