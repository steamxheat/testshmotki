import { useState } from 'react';
import { useStore, useToast } from '../../app/providers';
import { Empty, ErrorState, Loader, RatingStars } from '../../components/ui';
import { adminApi, ApiError } from '../../lib/api';
import { assetUrl } from '../../lib/asset';
import { useAsync } from '../../lib/useAsync';
import { dateShort } from '../../lib/format';
import type { Review } from '../../types';

export function AdminReviews() {
  const { store } = useStore();
  const { data, loading, error, reload } = useAsync(() => adminApi.reviews(store!.id), [store?.id]);

  return (
    <div className="page">
      <h1 style={{ marginBottom: 12 }}>Отзывы</h1>
      {loading && <Loader />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && data.items.length === 0 && <Empty icon="star" title="Отзывов пока нет" />}
      <div className="list">
        {data?.items.map((r) => <ReviewRow key={r.id} review={r} storeId={store!.id} onChange={reload} />)}
      </div>
    </div>
  );
}

function ReviewRow({ review, storeId, onChange }: { review: Review; storeId: string; onChange: () => void }) {
  const toast = useToast();
  const [reply, setReply] = useState(review.sellerReply ?? '');
  const [editing, setEditing] = useState(!review.sellerReply);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try { await adminApi.replyReview(storeId, review.id, reply.trim()); toast('Ответ сохранён'); setEditing(false); onChange(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Ошибка'); }
    finally { setBusy(false); }
  }

  async function toggleVisibility() {
    const status = review.status === 'published' ? 'hidden' : 'published';
    try {
      await adminApi.setReviewVisibility(storeId, review.id, status);
      toast(status === 'hidden' ? 'Отзыв скрыт' : 'Отзыв опубликован');
      onChange();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Не удалось изменить видимость');
    }
  }

  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <div><b>{review.authorName}</b> <span className="small muted">· заказ №{review.orderNumber}</span></div>
        <RatingStars value={review.rating} />
      </div>
      <div className="small muted">{dateShort(review.createdAt)}{review.status === 'hidden' ? ' · скрыт' : ''}</div>
      {review.text && <p>{review.text}</p>}
      {review.photos.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          {review.photos.map((url) => (
            <img key={url} src={assetUrl(url)} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 10 }} />
          ))}
        </div>
      )}

      {editing ? (
        <>
          <textarea aria-label="Ответ продавца" value={reply} onChange={(e) => setReply(e.target.value)} maxLength={1000} placeholder="Ответ продавца" />
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn small outline" onClick={toggleVisibility}>{review.status === 'published' ? 'Скрыть отзыв' : 'Опубликовать'}</button>
            <button className="btn small" onClick={save} disabled={busy || !reply.trim()}>Ответить</button>
          </div>
        </>
      ) : (
        <>
          <div className="card" style={{ background: 'var(--tg-secondary-bg)', padding: 10, marginTop: 8 }}>
            <div className="small muted" style={{ marginBottom: 4 }}>Ваш ответ</div>
            <div className="small">{review.sellerReply}</div>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn small outline" onClick={toggleVisibility}>{review.status === 'published' ? 'Скрыть отзыв' : 'Опубликовать'}</button>
            <button className="btn small outline" onClick={() => setEditing(true)}>Изменить ответ</button>
          </div>
        </>
      )}
    </div>
  );
}
