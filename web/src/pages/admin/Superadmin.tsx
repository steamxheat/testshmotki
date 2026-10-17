import { useState } from 'react';
import { useToast } from '../../app/providers';
import { Empty, ErrorState, Loader, TopBar } from '../../components/ui';
import { superApi, ApiError } from '../../lib/api';
import { useAsync } from '../../lib/useAsync';

export function Superadmin() {
  const toast = useToast();
  const stats = useAsync(() => superApi.stats() as Promise<Record<string, number>>, []);
  const stores = useAsync(() => superApi.stores(), []);
  const reports = useAsync(() => superApi.reports(), []);
  const [form, setForm] = useState({ slug: '', name: '', ownerTelegramId: '', city: '' });

  if (stats.error) return <div className="page"><TopBar title="Суперадмин" /><ErrorState message={stats.error} onRetry={stats.reload} /></div>;

  async function createStore() {
    try {
      await superApi.createStore(form);
      toast('Магазин создан');
      setForm({ slug: '', name: '', ownerTelegramId: '', city: '' });
      stores.reload();
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Ошибка'); }
  }

  async function wrap(fn: () => Promise<unknown>, msg: string) {
    try { await fn(); toast(msg); stores.reload(); reports.reload(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Ошибка'); }
  }

  return (
    <div className="page">
      <TopBar title="Суперадмин" />

      {stats.loading ? <Loader /> : stats.data && (
        <div className="statgrid" style={{ marginBottom: 16 }}>
          <Stat n={stats.data.stores} l="Магазинов" />
          <Stat n={stats.data.activeStores} l="Активных" />
          <Stat n={stats.data.users} l="Пользователей" />
          <Stat n={stats.data.products} l="Товаров" />
          <Stat n={stats.data.orders} l="Заказов" />
          <Stat n={stats.data.reviews} l="Отзывов" />
        </div>
      )}

      <div className="section">
        <h2>Создать магазин</h2>
        <div className="field"><label>Адрес (slug)</label><input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="store_name" /></div>
        <div className="field"><label>Название</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div className="row">
          <div className="field"><label>Telegram ID владельца</label><input value={form.ownerTelegramId} onChange={(e) => setForm({ ...form, ownerTelegramId: e.target.value })} inputMode="numeric" /></div>
          <div className="field"><label>Город</label><input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
        </div>
        <button className="btn" onClick={createStore} disabled={!form.slug || !form.name || !form.ownerTelegramId}>Создать</button>
      </div>

      <div className="section">
        <h2>Магазины</h2>
        {stores.loading && <Loader />}
        <div className="list">
          {stores.data?.stores.map((s: any) => (
            <div key={s.id} className="card" style={{ padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{s.name} <span className="small muted">/{s.slug}</span></div>
                  <div className="small muted">Владелец: {s.owner ? `@${s.owner.username ?? s.owner.telegramId}` : '—'} · товаров {s.counts.products}</div>
                </div>
                <span className={`status ${s.status === 'active' ? 'tone-done' : 'tone-bad'}`}>{s.status === 'active' ? 'Активен' : 'Заблокирован'}</span>
              </div>
              <div className="chips" style={{ marginTop: 8 }}>
                {s.status === 'active'
                  ? <button className="chip" onClick={() => wrap(() => superApi.block(s.id), 'Заблокирован')}>Заблокировать</button>
                  : <button className="chip" onClick={() => wrap(() => superApi.unblock(s.id), 'Разблокирован')}>Разблокировать</button>}
                <button className="chip" onClick={() => { const id = prompt('Telegram ID нового владельца'); if (id) wrap(() => superApi.setOwner(s.id, id), 'Владелец назначен'); }}>Назначить владельца</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="section">
        <h2>Жалобы</h2>
        {reports.data && reports.data.reports.length === 0 && <Empty icon="🛡" title="Жалоб нет" />}
        <div className="list">
          {reports.data?.reports.map((r: any) => (
            <div key={r.id} className="card" style={{ padding: 12 }}>
              <div className="small">{r.targetType === 'review' ? 'Отзыв' : 'Товар'} · {r.reason ?? 'без причины'}</div>
              <div className="chips" style={{ marginTop: 8 }}>
                <button className="chip" onClick={() => wrap(() => superApi.moderate({ targetType: r.targetType, targetId: r.targetId, action: 'hide', reportId: r.id }), 'Скрыто')}>Скрыть</button>
                <button className="chip" onClick={() => wrap(() => superApi.moderate({ targetType: r.targetType, targetId: r.targetId, action: 'restore', reportId: r.id }), 'Восстановлено')}>Восстановить</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({ n, l }: { n: number; l: string }) {
  return <div className="stat"><div className="n">{n ?? 0}</div><div className="l">{l}</div></div>;
}
