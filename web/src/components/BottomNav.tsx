import { NavLink } from 'react-router-dom';

const items = [
  { to: '/', icon: '🏠', label: 'Главная', end: true },
  { to: '/catalog', icon: '🧥', label: 'Каталог' },
  { to: '/favorites', icon: '❤️', label: 'Избранное' },
  { to: '/orders', icon: '🧾', label: 'Заказы' },
  { to: '/profile', icon: '👤', label: 'Профиль' },
];

export function BottomNav() {
  return (
    <nav className="nav" aria-label="Основная навигация">
      {items.map((i) => (
        <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => (isActive ? 'active' : '')}>
          <span className="ico" aria-hidden>{i.icon}</span>
          <span>{i.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
