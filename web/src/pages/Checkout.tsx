import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useStore, useToast } from '../app/providers';
import { Empty, ErrorState, Loader, TopBar } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { deliveryLabel, money } from '../lib/format';
import { getUser, haptic, openChat } from '../lib/telegram';
import type { DeliveryMethod } from '../types';

export function Checkout() {
  const { productId } = useParams();
  const nav = useNavigate();
  const { store } = useStore();
  const toast = useToast();
  const { data, loading, error, reload } = useAsync(() => api.product(productId!), [productId]);

  const tgUser = getUser();
  const [name, setName] = useState(tgUser.first_name ?? '');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState(store?.city ?? '');
  const [delivery, setDelivery] = useState<DeliveryMethod>(store?.settings.deliveryMethods[0] ?? 'discuss');
  const [comment, setComment] = useState('');
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ number: string; chatUrl: string | null } | null>(null);

  if (loading) return <div className="page"><Loader /></div>;
  if (error || !data) return <div className="page"><TopBar title="Оформление" /><ErrorState message={error ?? 'Ошибка'} onRetry={reload} /></div>;

  const p = data.product;

  if (done) {
    return (
      <div className="page">
        <Empty
          icon="✅"
          title={`Заявка №${done.number} отправлена`}
          hint="Товар забронирован на 24 часа. Продавцу придёт уведомление — он свяжется с вами."
          action={
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: 240 }}>
              <button className="btn" onClick={() => openChat(store?.contactUsername)}>💬 Перейти в чат с продавцом</button>
              <button className="btn secondary" onClick={() => nav('/orders')}>Мои заказы</button>
            </div>
          }
        />
      </div>
    );
  }

  if (!p.isAvailable) {
    return (
      <div className="page">
        <TopBar title="Оформление" />
        <Empty icon="🚫" title="Товар уже недоступен" hint="Похоже, его только что забронировали." action={<button className="btn small" onClick={() => nav('/catalog')}>В каталог</button>} />
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!consent || submitting) return;
    setSubmitting(true);
    try {
      const r = await api.createOrder({
        productId: p.id,
        buyerName: name.trim(),
        buyerPhone: phone.trim() || undefined,
        city: city.trim() || undefined,
        deliveryMethod: delivery,
        comment: comment.trim() || undefined,
        consent: true,
      });
      haptic('success');
      setDone({ number: r.order.publicNumber, chatUrl: r.chatUrl });
    } catch (err) {
      haptic('error');
      const msg = err instanceof ApiError ? err.message : 'Не удалось отправить заявку';
      toast(msg);
      if (err instanceof ApiError && (err.code === 'unavailable' || err.code === 'already_requested')) reload();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page" style={{ paddingBottom: 24 }}>
      <TopBar title="Оформление заявки" />

      <div className="card listitem" style={{ marginBottom: 16 }}>
        {p.coverUrl && <img className="thumb" src={p.coverUrl} alt="" />}
        <div className="grow">
          <div style={{ fontWeight: 600 }}>{p.title}</div>
          <div className="price">{money(p.price)}</div>
        </div>
      </div>

      <form onSubmit={submit}>
        <div className="field">
          <label>Имя</label>
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} />
        </div>
        {tgUser.username && <p className="small muted" style={{ marginTop: -8 }}>Telegram: @{tgUser.username}</p>}

        <div className="field">
          <label>Телефон (необязательно)</label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="+7…" />
        </div>
        <div className="field">
          <label>Город</label>
          <input value={city} onChange={(e) => setCity(e.target.value)} />
        </div>
        <div className="field">
          <label>Способ получения</label>
          <select value={delivery} onChange={(e) => setDelivery(e.target.value as DeliveryMethod)}>
            {(store?.settings.deliveryMethods ?? ['discuss']).map((d) => (
              <option key={d} value={d}>{deliveryLabel[d]}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Комментарий</label>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} placeholder="Пожелания, замеры, вопросы" />
        </div>

        <label className="checkbox" style={{ marginBottom: 16 }}>
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span className="small">Согласен передать указанные данные продавцу для обработки заявки.</span>
        </label>

        <button className="btn" type="submit" disabled={!consent || !name.trim() || submitting}>
          {submitting ? 'Отправляем…' : 'Отправить заявку'}
        </button>
      </form>
    </div>
  );
}
