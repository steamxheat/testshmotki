import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore, useToast } from '../app/providers';
import { Empty, ErrorState, Loader } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { dateShort, deliveryLabel, money, orderStatusLabel, orderStatusTone, timeLeft } from '../lib/format';
import { openChat } from '../lib/telegram';
import type { Order } from '../types';

export function Orders() {
  const { store } = useStore();
  const toast = useToast();
  const { data, loading, error, reload } = useAsync(() => api.orders(), []);
  const [review, setReview] = useState<Order | null>(null);

  async function cancel(o: Order) {
    if (!confirm(`Отменить заявку №${o.publicNumber}?`)) return;
    try {
      await api.cancelOrder(o.id);
      toast('Заявка отменена');
      reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Ошибка');
    }
  }

  return (
    <div className="page">
      <h1 style={{ marginBottom: 14 }}>Мои заказы</h1>
      {loading && <Loader />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && data.items.length === 0 && (
        <Empty icon="🧾" title="У вас ещё нет заказов" hint="Найдите вещь в каталоге и отправьте заявку" action={<Link to="/catalog" className="btn small" style={{ width: 'auto' }}>В каталог</Link>} />
      )}

      <div className="list">
        {data?.items.map((o) => {
          const left = o.status === 'pending' ? timeLeft(o.reservedUntil) : null;
          return (
            <div key={o.id} className="card" style={{ padding: 12 }}>
              <div className="listitem" style={{ padding: 0 }}>
                {o.cover && <img className="thumb" src={o.cover} alt="" />}
                <div className="grow">
                  <div className="small muted">№{o.publicNumber} · {dateShort(o.createdAt)}</div>
                  <div style={{ fontWeight: 600 }}>{o.productTitle}</div>
                  <div className="price">{money(o.price)}</div>
                  <div style={{ marginTop: 6 }}>
                    <span className={`status ${orderStatusTone[o.status]}`}>{orderStatusLabel[o.status]}</span>
                  </div>
                  {left && <div className="small muted" style={{ marginTop: 4 }}>Бронь ещё {left}</div>}
                  <div className="small muted" style={{ marginTop: 4 }}>{deliveryLabel[o.deliveryMethod]}</div>
                </div>
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn small outline" onClick={() => openChat(store?.contactUsername)}>💬 Продавец</button>
                {o.status === 'pending' && <button className="btn small danger" onClick={() => cancel(o)}>Отменить</button>}
                {o.status === 'completed' && <button className="btn small" onClick={() => setReview(o)}>Оставить отзыв</button>}
              </div>
            </div>
          );
        })}
      </div>

      {review && <ReviewSheet order={review} onClose={() => setReview(null)} onDone={() => { setReview(null); toast('Спасибо за отзыв!'); }} />}
    </div>
  );
}

function ReviewSheet({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [rating, setRating] = useState(5);
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      const urls = await api.upload(files);
      setPhotos((prev) => [...prev, ...urls].slice(0, 3)); // до 3 фото (§6.9)
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Не удалось загрузить фото');
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    setBusy(true);
    try {
      await api.createReview({ orderId: order.id, rating, text: text.trim() || undefined, photos });
      onDone();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Не удалось отправить отзыв');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h2>Отзыв по заказу №{order.publicNumber}</h2>
        <div style={{ fontSize: 34, textAlign: 'center', margin: '10px 0' }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <span key={n} onClick={() => setRating(n)} style={{ cursor: 'pointer', color: n <= rating ? '#f59e0b' : 'var(--border)' }}>★</span>
          ))}
        </div>
        <div className="field">
          <label>Текст отзыва (до 1000 символов)</label>
          <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} placeholder="Как прошла сделка?" />
        </div>

        <div className="field">
          <label>Фото (до 3, необязательно)</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {photos.map((url, i) => (
              <div key={url} style={{ position: 'relative' }}>
                <img src={url} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 10 }} />
                <button className="iconbtn" style={{ position: 'absolute', top: -6, right: -6, minWidth: 22, minHeight: 22, background: '#e5484d' }} onClick={() => setPhotos((p) => p.filter((_, idx) => idx !== i))}>×</button>
              </div>
            ))}
            {photos.length < 3 && (
              <button className="card" style={{ width: 64, height: 64, fontSize: 24, border: '1px dashed var(--border)' }} onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? '…' : '+'}
              </button>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => onFiles(e.target.files)} />
        </div>

        <button className="btn" onClick={submit} disabled={busy || uploading}>{busy ? 'Отправляем…' : 'Опубликовать отзыв'}</button>
      </div>
    </div>
  );
}
