import { useState } from 'react';
import { useStore, useToast } from '../../app/providers';
import { ErrorState, Loader, TopBar } from '../../components/ui';
import { adminApi, ApiError } from '../../lib/api';
import { useAsync } from '../../lib/useAsync';

export function AdminCategories() {
  const { store } = useStore();
  const toast = useToast();
  const { data, loading, error, reload } = useAsync(() => adminApi.categories(store!.id), [store?.id]);
  const [name, setName] = useState('');

  async function create() {
    if (!name.trim()) return;
    try {
      await adminApi.createCategory(store!.id, { name: name.trim() });
      setName('');
      toast('Категория создана');
      reload();
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Не удалось создать категорию'); }
  }

  async function rename(id: string, current: string) {
    const next = prompt('Новое название', current);
    if (!next || next === current) return;
    try { await adminApi.updateCategory(store!.id, id, { name: next.trim() }); reload(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Не удалось переименовать категорию'); }
  }

  async function archive(id: string) {
    if (!confirm('Архивировать категорию? Она исчезнет из витрины.')) return;
    try { await adminApi.archiveCategory(store!.id, id); toast('Архивировано'); reload(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Ошибка'); }
  }

  return (
    <div className="page">
      <TopBar title="Категории" fallback="/admin/products" />
      <div className="row" style={{ marginBottom: 16 }}>
        <input aria-label="Новая категория" placeholder="Новая категория" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn small" style={{ flex: '0 0 auto', width: 'auto' }} onClick={create}>Добавить</button>
      </div>

      {loading && <Loader />}
      {error && <ErrorState message={error} onRetry={reload} />}
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
        Пустая категория видна покупателям. Архивировать можно только категорию без активных товаров.
      </p>
    </div>
  );
}
