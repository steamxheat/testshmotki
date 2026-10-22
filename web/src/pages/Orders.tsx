import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../app/providers';
import { Empty, ErrorState, Loader } from '../components/ui';
import { Icon } from '../components/Icon';
import { api, ApiError, downloadReceipt } from '../lib/api';
import { assetUrl } from '../lib/asset';
import { useAsync } from '../lib/useAsync';
import { dateShort, deliveryLabel, money, orderStatusLabel, orderStatusTone, timeLeft } from '../lib/format';
import type { Order } from '../types';

export function Orders() {
  const toast = useToast();
  const { data, loading, error, reload } = useAsync(() => api.orders(), []);
  const [review, setReview] = useState<Order | null>(null);
  const [receiptBusy, setReceiptBusy] = useState<string | null>(null);

  async function uploadReceipt(order: Order, file?: File) {
    if (!file || receiptBusy) return;
    setReceiptBusy(order.id);
    try { await api.uploadReceipt(order.id, file); toast('Чек отправлен продавцу'); reload(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Не удалось отправить чек'); }
    finally { setReceiptBusy(null); }
  }

  return (
    <div className="page">
      <h1 style={{ marginBottom: 14 }}>Мои заказы</h1>
      {loading && <Loader />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && data.items.length === 0 && (
        <Empty icon="orders" title="У вас ещё нет заказов" hint="Найдите вещь в каталоге и отправьте заявку" action={<Link to="/catalog" className="btn small" style={{ width: 'auto' }}>В каталог</Link>} />
      )}

      <div className="list">
        {data?.items.map((o) => {
          const left = (o.status === 'pending' || (o.status === 'confirmed' && !o.paymentConfirmedAt && !o.receiptSubmittedAt)) ? timeLeft(o.reservedUntil) : null;
          return (
            <div key={o.id} className="card" style={{ padding: 12 }}>
              <div className="listitem" style={{ padding: 0 }}>
                {o.cover && <img className="thumb" src={assetUrl(o.cover)} alt="" />}
                <div className="grow">
                  <div className="small muted">№{o.publicNumber} · {dateShort(o.createdAt)}</div>
                  <div style={{ fontWeight: 600 }}>{o.productTitle}</div>
                  <div className="price">{money(o.price)}</div>
                  {o.items.length > 0 && <div className="order-lines small muted">{o.items.map((i) => <div key={i.variantId}>{i.title} · {i.size} · {i.quantity} шт.</div>)}</div>}
                  <div style={{ marginTop: 6 }}>
                    <span className={`status ${orderStatusTone[o.status]}`}>{orderStatusLabel[o.status]}</span>
                  </div>
                  {left && <div className="small muted" style={{ marginTop: 4 }}>{o.status === 'confirmed' && !(o.deliveryMethod === 'cdek' && o.deliveryPrice == null) ? 'Оплатите или отправьте чек в течение ' : 'Бронь ещё '}{left}</div>}
                  <div className="small muted" style={{ marginTop: 4 }}>{deliveryLabel[o.deliveryMethod]}</div>
                  {o.deliveryPoint && <div className="small muted">{o.deliveryPoint} · {o.deliveryAddress}</div>}
                  {o.deliveryPointCode && <div className="small muted">Код ПВЗ СДЭК: {o.deliveryPointCode}</div>}
                  {o.deliveryTariff && <div className="small muted">{o.deliveryTariff} · {o.deliveryPrice == null ? 'цена уточняется' : money(o.deliveryPrice)}{o.deliveryTariff !== 'Ручное оформление' && ' (ориентир продавца)'}</div>}
                  {o.deliveryPrice != null && <div className="small"><b>Итого с доставкой: {money(o.price + o.deliveryPrice)}</b></div>}
                  {(o.shipment?.mode === 'live' || o.shipment?.mode === 'manual') && o.shipment.trackingNumber && <div className="small"><b>{deliveryLabel[o.deliveryMethod]}: {o.shipment.trackingNumber}</b><div className="muted">{o.status === 'sent' ? 'Продавец подтвердил передачу отправления перевозчику.' : o.shipment.mode === 'manual' ? 'Трек-номер внесён продавцом; передача перевозчику ещё не подтверждена.' : 'Накладная создана; передача перевозчику ещё не подтверждена.'}</div></div>}
                  {o.refundConfirmedAt && <div className="small">Продавец отметил возврат {money(o.refundAmount ?? 0)}. Если деньги не поступили, напишите ему в чате.</div>}
                </div>
              </div>
              {(['confirmed', 'sent', 'completed'].includes(o.status)) && <div className="order-payment">
                <strong>{o.paymentConfirmedAt ? 'Оплата подтверждена' : o.deliveryMethod === 'cdek' && o.deliveryPrice == null ? 'Ожидаем стоимость доставки' : 'Оплата переводом'}</strong>
                {o.status === 'confirmed' && !o.paymentConfirmedAt && <>
                  {o.deliveryMethod === 'cdek' && o.deliveryPrice == null ? <p className="small muted">Продавец сообщит итоговую стоимость доставки. До этого ничего не переводите.</p> : <>{o.paymentDetails ? <p className="payment-details">{o.paymentDetails}</p> : <p className="small muted">Продавец ещё не указал реквизиты. Уточните их в чате до перевода.</p>}<label className="btn small outline receipt-upload">{receiptBusy === o.id ? 'Загружаем…' : o.receiptSubmittedAt ? 'Заменить чек' : 'Прикрепить чек (фото или PDF)'}<input type="file" accept="image/*,application/pdf" hidden disabled={receiptBusy === o.id} onChange={(e) => { uploadReceipt(o, e.target.files?.[0]); e.target.value = ''; }} /></label></>}
                  {o.receiptSubmittedAt && <span className="small muted">Чек отправлен, ожидаем проверки продавца.</span>}
                </>}
                {o.receiptSubmittedAt && <button className="text-action" onClick={() => downloadReceipt(o.id).catch(() => toast('Не удалось открыть чек'))}>Скачать чек</button>}
              </div>}
              <div className="row" style={{ marginTop: 10 }}>
                <Link className="btn small outline" to={`/chat?product=${o.productId}`}><Icon name="chat" size={17} />Продавец</Link>
                {o.status === 'completed' && (o.hasReview ? <span className="small muted">Отзыв оставлен</span> : <button className="btn small" onClick={() => setReview(o)}>Оставить отзыв</button>)}
              </div>
            </div>
          );
        })}
      </div>

      {review && <ReviewSheet order={review} onClose={() => setReview(null)} onDone={() => { setReview(null); toast('Спасибо за отзыв!'); reload(); }} />}
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
  useEffect(() => {
    const close = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose]);

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      const urls = await api.upload(files, order.id);
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
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="review-title" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head"><h2 id="review-title">Отзыв по заказу №{order.publicNumber}</h2><button className="iconbtn" aria-label="Закрыть отзыв" onClick={onClose} autoFocus><Icon name="close" size={20} /></button></div>
        <div className="rating-input" role="group" aria-label="Оценка продавца">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" onClick={() => setRating(n)} aria-label={`${n} из 5`} aria-pressed={n === rating}>
              <Icon name="star" size={30} filled={n <= rating} />
            </button>
          ))}
        </div>
        <div className="field">
          <label>Текст отзыва (до 1000 символов)</label>
          <textarea aria-label="Текст отзыва" value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} placeholder="Как прошла сделка?" />
        </div>

        <div className="field">
          <label>Фото (до 3, необязательно)</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {photos.map((url, i) => (
              <div key={url} style={{ position: 'relative' }}>
                <img src={assetUrl(url)} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 10 }} />
                <button className="iconbtn remove-image" aria-label={`Удалить фото ${i + 1}`} onClick={() => setPhotos((p) => p.filter((_, idx) => idx !== i))}><Icon name="close" size={18} /></button>
              </div>
            ))}
            {photos.length < 3 && (
              <button className="card" aria-label="Добавить фото к отзыву" style={{ width: 64, height: 64, border: '1px dashed var(--border)', color: 'var(--tg-text)' }} onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? '…' : <Icon name="add" size={22} />}
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
