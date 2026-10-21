import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon, type IconName } from './Icon';

export function Loader({ text = 'Загрузка…' }: { text?: string }) {
  return (
    <div className="loader">
      <div className="spinner" />
      {text}
    </div>
  );
}

export function Empty({ icon = 'inbox', title, hint, action }: { icon?: IconName; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="ico"><Icon name={icon} size={40} /></div>
      <div style={{ fontWeight: 600, color: 'var(--tg-text)' }}>{title}</div>
      {hint && <div className="small" style={{ marginTop: 6 }}>{hint}</div>}
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  );
}

// Экран ошибки с кнопкой повторной попытки (§14)
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="empty">
      <div className="ico"><Icon name="alert" size={40} /></div>
      <div style={{ fontWeight: 600, color: 'var(--tg-text)' }}>Что-то пошло не так</div>
      <div className="small" style={{ marginTop: 6 }}>{message}</div>
      {onRetry && (
        <div style={{ marginTop: 16 }}>
          <button className="btn small" onClick={onRetry}>Повторить</button>
        </div>
      )}
    </div>
  );
}

export function Stars({ value, count }: { value: number; count?: number }) {
  return (
    <span className="small">
      <RatingStars value={value} />{' '}
      {value > 0 ? value.toFixed(1) : '—'}
      {count != null && <span className="muted"> · {count} отзывов</span>}
    </span>
  );
}

export function RatingStars({ value }: { value: number }) {
  return <span className="stars" role="img" aria-label={`Рейтинг ${value} из 5`}>
    {[1, 2, 3, 4, 5].map((n) => <Icon key={n} name="star" size={16} filled={n <= Math.round(value)} />)}
  </span>;
}

export function TopBar({ title, right, fallback = '/' }: { title: string; right?: ReactNode; fallback?: string }) {
  const nav = useNavigate();
  return (
    <div className="topbar">
      <button className="back" onClick={() => window.history.state?.idx > 0 ? nav(-1) : nav(fallback)} aria-label="Назад"><Icon name="back" /></button>
      <h1 style={{ flex: 1 }}>{title}</h1>
      {right}
    </div>
  );
}
