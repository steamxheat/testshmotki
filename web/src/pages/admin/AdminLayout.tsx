import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useStore } from '../../app/providers';
import { Empty, Loader } from '../../components/ui';
import { api } from '../../lib/api';
import { useAsync } from '../../lib/useAsync';

const items = [
  { to: '/admin', icon: '📊', label: 'Обзор', end: true },
  { to: '/admin/products', icon: '🧥', label: 'Товары' },
  { to: '/admin/orders', icon: '📦', label: 'Заказы' },
  { to: '/admin/reviews', icon: '⭐', label: 'Отзывы' },
  { to: '/admin/settings', icon: '⚙️', label: 'Настройки' },
];

export function AdminLayout() {
  const { store } = useStore();
  const nav = useNavigate();
  const { data, loading } = useAsync(() => api.profile(), []);

  if (loading || !store) return <div className="page"><Loader /></div>;

  // доступ только у продавца этого магазина или суперадмина (§7, §9.8)
  const allowed = data?.isSuperadmin || data?.stores.some((s) => s.id === store.id);
  if (!allowed) {
    return (
      <div className="page">
        <Empty icon="🔒" title="Нет доступа к админ-панели" hint="Ваш Telegram ID не добавлен в сотрудники магазина." action={<button className="btn small" onClick={() => nav('/')}>На витрину</button>} />
      </div>
    );
  }

  return (
    <>
      <div style={{ paddingBottom: 'calc(var(--nav-h) + env(safe-area-inset-bottom))' }}>
        <Outlet />
      </div>
      <nav className="nav" aria-label="Админ-навигация">
        {items.map((i) => (
          <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => (isActive ? 'active' : '')}>
            <span className="ico" aria-hidden>{i.icon}</span>
            <span>{i.label}</span>
          </NavLink>
        ))}
      </nav>
    </>
  );
}
