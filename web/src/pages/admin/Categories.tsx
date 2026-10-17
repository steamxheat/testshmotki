import { useState } from 'react';
import { useStore, useToast } from '../../app/providers';
import { Loader, TopBar } from '../../components/ui';
import { adminApi, ApiError } from '../../lib/api';
import { useAsync } from '../../lib/useAsync';

export function AdminCategories() {
  const { store } = useStore();
  const toast = useToast();
  const { data, loading, reload } = useAsync(() => adminApi.categories(store!.id), [store?.id]);
  const [name, setName] = useState('');

  async function create() {
    if (!name.trim()) return;
    await adminApi.createCategory(store!.id, { name: name.trim() });
    setName('');
    toast('Категория создана');
    reload();
  }

  async function rename(id: string, current: string) {
    const next = prompt('Новое название', current);
    if (!next || next === current) return;
    await adminApi.updateCategory(store!.id, id, { name: next });
    reload();
  }

  async function archive(id: string) {
    try { await adminApi.archiveCategory(store!.id, id); toast('Архивировано'); reload(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Ошибка'); }
  }

  return (
    <div className="page">
      <TopBar title="Категории" />
      <div className="row" style={{ marginBottom: 16 }}>
        <input placeholder="Новая категория" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn small" style={{ flex: '0 0 auto', width: 'auto' }} onClick={create}>Добавить</button>
      </div>

      {loading && <Loader />}
      <div className="list">
        {data?.categories.filter((c) => !c.parentId).map((c) => (
          <div key={c.id} className="card listitem" style={{ alignItems: 'center' }}>
            <div className="grow">
              <div style={{ fontWeight: 600 }}>{c.name}</div>
              <div className="small muted">Товаров: {c.productCount ?? 0}</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="chip" onClick={() => rename(c.id, c.name)}>Переименовать</button>
              <button className="chip" onClick={() => archive(c.id)}>Архив</button>
            </div>
          </div>
        ))}
      </div>
      <p className="small muted" style={{ marginTop: 14 }}>
        Пустая категория не показывается покупателям. Архивировать можно только категорию без активных товаров.
      </p>
    </div>
  );
}
