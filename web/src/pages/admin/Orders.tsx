import { useEffect, useState } from 'react';
import { useStore, useToast } from '../../app/providers';
import { Empty, Loader } from '../../components/ui';
import { adminApi, ApiError } from '../../lib/api';
import { dateShort, deliveryLabel, money, orderStatusLabel, orderStatusTone } from '../../lib/format';
import { openChat } from '../../lib/telegram';
import type { Order } from '../../types';

const TABS = ['', 'pending', 'confirmed', 'completed', 'rejected', 'expired'];

export function AdminOrders() {
  const { store } = useStore();
  const toast = useToast();
  const [items, setItems] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');

  function load() {
    setLoading(true);
    adminApi.orders(store!.id, { status: status || undefined }).then((r) => setItems(r.items)).finally(() => setLoading(false));
  }
  useEffect(load, [store?.id, status]);

  async function action(o: Order, a: 'accept' | 'reject' | 'complete') {
    const labels = { accept: 'Принять заявку?', reject: 'Отклонить заявку?', complete: 'Завершить сделку? Товар станет «Продан».' };
    if (!confirm(labels[a])) return;
    try { await adminApi.orderAction(store!.id, o.id, a); toast('Статус обновлён'); load(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Ошибка'); }
  }

  return (
    <div className="page">
      <h1 style={{ marginBottom: 12 }}>Заказы</h1>
      <div className="tabs">
        {TABS.map((s) => (
          <button key={s || 'all'} className={`chip ${status === s ? 'active' : ''}`} onClick={() => setStatus(s)}>
            {s ? orderStatusLabel[s as keyof typeof orderStatusLabel] : 'Все'}
          </button>
        ))}
      </div>

      {loading ? <Loader /> : items.length === 0 ? (
        <Empty icon="📦" title="Заявок пока нет" />
      ) : (
        <div className="list">
          {items.map((o) => (
            <div key={o.id} className="card" style={{ padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span className="small muted">№{o.publicNumber} · {dateShort(o.createdAt)}</span>
                <span className={`status ${orderStatusTone[o.status]}`}>{orderStatusLabel[o.status]}</span>
              </div>
              <div className="listitem" style={{ padding: 0 }}>
                {o.cover && <img className="thumb" src={o.cover} alt="" />}
                <div className="grow">
                  <div style={{ fontWeight: 600 }}>{o.productTitle}</div>
                  <div className="price">{money(o.price)}</div>
                </div>
              </div>

              <div className="card" style={{ background: 'var(--tg-secondary-bg)', padding: 10, marginTop: 10 }}>
                <div className="small"><b>{o.buyerName}</b>{o.buyerUsername ? ` · @${o.buyerUsername}` : ''}</div>
                {o.buyerPhone && <div className="small">📞 {o.buyerPhone}</div>}
                <div className="small">{deliveryLabel[o.deliveryMethod]}{o.city ? ` · ${o.city}` : ''}</div>
                {o.comment && <div className="small muted" style={{ marginTop: 4 }}>«{o.comment}»</div>}
              </div>

              {o.history && o.history.length > 1 && (
                <div className="small muted" style={{ marginTop: 8 }}>
                  История: {o.history.map((hst) => orderStatusLabel[hst.newStatus]).join(' → ')}
                </div>
              )}

              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn small outline" onClick={() => openChat(o.buyerUsername)}>💬 Покупателю</button>
                {o.status === 'pending' && <button className="btn small" onClick={() => action(o, 'accept')}>Принять</button>}
                {(o.status === 'pending' || o.status === 'confirmed') && <button className="btn small danger" onClick={() => action(o, 'reject')}>Отклонить</button>}
                {(o.status === 'pending' || o.status === 'confirmed') && <button className="btn small" onClick={() => action(o, 'complete')}>Завершить</button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
