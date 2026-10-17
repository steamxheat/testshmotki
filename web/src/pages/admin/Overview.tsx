import { Link } from 'react-router-dom';
import { useStore } from '../../app/providers';
import { Loader } from '../../components/ui';
import { adminApi } from '../../lib/api';
import { useAsync } from '../../lib/useAsync';

interface OverviewData {
  activeProducts: number;
  reservedProducts: number;
  newOrders: number;
  completedOrders: { d7: number; d30: number };
  catalogViews: { d7: number; d30: number };
  favoriteAdds: number;
  conversion: number;
  recentEvents: { type: string; createdAt: string }[];
}

const eventLabels: Record<string, string> = {
  store_view: 'Открытие магазина',
  catalog_view: 'Просмотр каталога',
  product_view: 'Просмотр товара',
  favorite_add: 'Добавление в избранное',
  buy_click: 'Нажатие «Хочу купить»',
  order_created: 'Новая заявка',
  order_status_change: 'Смена статуса заказа',
  review_published: 'Новый отзыв',
  search_query: 'Поиск',
  filter_apply: 'Применён фильтр',
};

export function Overview() {
  const { store } = useStore();
  const { data, loading } = useAsync(() => adminApi.overview(store!.id) as Promise<OverviewData>, [store?.id]);

  if (loading || !data) return <div className="page"><Loader /></div>;

  return (
    <div className="page">
      <h1 style={{ marginBottom: 14 }}>Обзор · {store!.name}</h1>

      {data.newOrders > 0 && (
        <Link to="/admin/orders" className="card" style={{ display: 'block', padding: 14, marginBottom: 14, background: 'var(--accent)', color: '#fff' }}>
          🔔 Новых заявок: <b>{data.newOrders}</b> — нажмите, чтобы открыть
        </Link>
      )}

      <div className="statgrid">
        <Stat n={data.activeProducts} l="Активных товаров" />
        <Stat n={data.reservedProducts} l="На брони" />
        <Stat n={data.newOrders} l="Новых заявок" />
        <Stat n={data.favoriteAdds} l="В избранном (30д)" />
        <Stat n={data.completedOrders.d7} l="Завершено за 7 дней" />
        <Stat n={data.completedOrders.d30} l="Завершено за 30 дней" />
        <Stat n={data.catalogViews.d7} l="Просмотры каталога (7д)" />
        <Stat n={data.catalogViews.d30} l="Просмотры каталога (30д)" />
        <Stat n={`${data.conversion}%`} l="Конверсия в заявку" />
      </div>

      <div className="section">
        <h2>Последние события</h2>
        <div className="list" style={{ marginTop: 10 }}>
          {data.recentEvents.length === 0 && <div className="muted small">Пока пусто</div>}
          {data.recentEvents.map((e, i) => (
            <div key={i} className="card" style={{ padding: 10, display: 'flex', justifyContent: 'space-between' }}>
              <span className="small">{eventLabels[e.type] ?? e.type}</span>
              <span className="small muted">{new Date(e.createdAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          ))}
        </div>
      </div>

      <p className="small muted">Статистика носит справочный характер.</p>
    </div>
  );
}

function Stat({ n, l }: { n: number | string; l: string }) {
  return (
    <div className="stat">
      <div className="n">{n}</div>
      <div className="l">{l}</div>
    </div>
  );
}
