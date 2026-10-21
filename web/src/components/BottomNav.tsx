import { NavLink } from 'react-router-dom';
import { Icon, type IconName } from './Icon';
import { useStore } from '../app/providers';
import { api } from '../lib/api';
import { useAsync } from '../lib/useAsync';

const items: { to: string; icon: IconName; label: string; end?: boolean }[] = [
  { to: '/', icon: 'home', label: 'Главная', end: true },
  { to: '/catalog', icon: 'catalog', label: 'Каталог' },
  { to: '/favorites', icon: 'heart', label: 'Избранное' },
  { to: '/cart', icon: 'cart', label: 'Корзина' },
  { to: '/profile', icon: 'profile', label: 'Профиль' },
];

export function BottomNav() {
  const { store } = useStore();
  const { data } = useAsync(() => api.profile(), []);
  const seller = data?.stores.some((s) => s.id === store?.id);
  const visibleItems = seller ? [...items.slice(0, 4), { to: '/admin/chats', icon: 'chat' as const, label: 'Чаты' }, items[4]] : items;
  return (
    <nav className="nav" aria-label="Основная навигация">
      {visibleItems.map((i) => (
        <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => (isActive ? 'active' : '')}>
          <Icon name={i.icon} size={22} />
          <span>{i.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
