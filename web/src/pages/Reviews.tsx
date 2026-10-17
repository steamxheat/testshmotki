import { Empty, ErrorState, Loader, Stars, TopBar } from '../components/ui';
import { api } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { dateShort } from '../lib/format';

export function Reviews() {
  const { data, loading, error, reload } = useAsync(() => api.reviews(), []);

  return (
    <div className="page">
      <TopBar title="Отзывы" />
      {loading && <Loader />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && (
        <>
          <div className="card" style={{ padding: 16, marginBottom: 14, textAlign: 'center' }}>
            <div style={{ fontSize: 34, fontWeight: 800 }}>{data.rating > 0 ? data.rating.toFixed(1) : '—'}</div>
            <Stars value={data.rating} count={data.reviewsCount} />
          </div>

          {data.items.length === 0 ? (
            <Empty icon="⭐" title="Отзывов пока нет" hint="Будьте первым после покупки" />
          ) : (
            <div className="list">
              {data.items.map((r) => (
                <div key={r.id} className="card" style={{ padding: 14 }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    {r.authorAvatar ? <img className="avatar sm" src={r.authorAvatar} alt="" /> : <div className="avatar sm" />}
                    <div className="grow">
                      <div style={{ fontWeight: 600 }}>{r.authorName}</div>
                      <div className="small muted">{dateShort(r.createdAt)}</div>
                    </div>
                    <span className="stars">{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</span>
                  </div>
                  {r.text && <p style={{ marginBottom: 0 }}>{r.text}</p>}
                  {r.photos.length > 0 && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                      {r.photos.map((url) => (
                        <img key={url} src={url} alt="" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 10 }} />
                      ))}
                    </div>
                  )}
                  {r.sellerReply && (
                    <div className="card" style={{ background: 'var(--tg-secondary-bg)', padding: 10, marginTop: 8 }}>
                      <div className="small muted" style={{ marginBottom: 4 }}>Ответ продавца</div>
                      <div className="small">{r.sellerReply}</div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
