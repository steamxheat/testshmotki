import { Link } from 'react-router-dom';
import { useToast } from '../app/providers';
import { ProductCard } from '../components/ProductCard';
import { Empty, ErrorState, Loader } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { useAsync } from '../lib/useAsync';

export function Favorites() {
  const toast = useToast();
  const { data, loading, error, reload } = useAsync(() => api.favorites(), []);

  async function clear() {
    if (!confirm('Очистить избранное?')) return;
    try {
      await api.clearFavorites();
      toast('Избранное очищено');
      reload();
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Не удалось очистить избранное'); }
  }

  return (
    <div className="page">
      <div className="topbar">
        <h1 style={{ flex: 1 }}>Избранное</h1>
        {data && data.items.length > 0 && <button className="btn small outline" onClick={clear}>Очистить</button>}
      </div>

      {loading && <Loader />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && data.items.length === 0 && (
        <Empty icon="heart" title="В избранном пока пусто" hint="Добавляйте вещи сердечком — они появятся здесь" action={<Link to="/catalog" className="btn small" style={{ width: 'auto' }}>В каталог</Link>} />
      )}
      {data && data.items.length > 0 && (
        <div className="grid">
          {data.items.map((p) => (
            <ProductCard key={p.id} product={p} onFav={(_, fav) => !fav && reload()} />
          ))}
        </div>
      )}
    </div>
  );
}
