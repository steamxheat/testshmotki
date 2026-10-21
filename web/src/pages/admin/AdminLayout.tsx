import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useStore } from '../../app/providers';
import { Empty, ErrorState, Loader } from '../../components/ui';
import { Icon, type IconName } from '../../components/Icon';
import { api } from '../../lib/api';
import { useAsync } from '../../lib/useAsync';

const items: { to: string; icon: IconName; label: string; end?: boolean }[] = [
  { to: '/admin', icon: 'overview', label: 'Обзор', end: true },
  { to: '/admin/products', icon: 'catalog', label: 'Товары' },
  { to: '/admin/orders', icon: 'package', label: 'Заказы' },
  { to: '/admin/chats', icon: 'chat', label: 'Чаты' },
  { to: '/admin/reviews', icon: 'star', label: 'Отзывы' },
  { to: '/admin/settings', icon: 'settings', label: 'Настройки' },
];

export function AdminLayout() {
  const { store } = useStore();
  const nav = useNavigate();
  const { data, loading, error, reload } = useAsync(() => api.profile(), []);

  if (loading || !store) return <div className="page"><Loader /></div>;
  if (error) return <div className="page"><ErrorState message={error} onRetry={reload} /></div>;

  const membership = data?.stores.find((s) => s.id === store.id);
  const allowed = Boolean(membership);
  if (!allowed) {
    return (
      <div className="page">
        <Empty icon="lock" title="Нет доступа к админ-панели" hint="Ваш Telegram ID не добавлен в сотрудники магазина." action={<button className="btn small" onClick={() => nav('/')}>На витрину</button>} />
      </div>
    );
  }

  return (
    <>
      <header className="admin-header">
        <div className="admin-header-title">
          <span className="small muted">Управление магазином</span>
          <strong>{store.name}</strong>
        </div>
        <Link className="btn small outline admin-exit" to="/" aria-label="Открыть витрину магазина">
          <Icon name="home" size={18} />В магазин
        </Link>
      </header>
      <div className="admin-view">
        <Outlet />
      </div>
      <nav className="nav" aria-label="Админ-навигация">
        {items.filter((i) => i.to !== '/admin/settings' || membership?.role === 'owner').map((i) => (
          <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => (isActive ? 'active' : '')}>
            <Icon name={i.icon} size={22} />
            <span>{i.label}</span>
          </NavLink>
        ))}
      </nav>
    </>
  );
}
