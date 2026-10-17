import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

export function Loader({ text = 'Загрузка…' }: { text?: string }) {
  return (
    <div className="loader">
      <div className="spinner" />
      {text}
    </div>
  );
}

export function Empty({ icon = '📭', title, hint, action }: { icon?: string; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="ico">{icon}</div>
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
      <div className="ico">⚠️</div>
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
  const full = Math.round(value);
  return (
    <span className="small">
      <span className="stars" aria-label={`Рейтинг ${value} из 5`}>{'★'.repeat(full)}{'☆'.repeat(5 - full)}</span>{' '}
      {value > 0 ? value.toFixed(1) : '—'}
      {count != null && <span className="muted"> · {count} отзывов</span>}
    </span>
  );
}

export function TopBar({ title, right }: { title: string; right?: ReactNode }) {
  const nav = useNavigate();
  return (
    <div className="topbar">
      <button className="back" onClick={() => nav(-1)} aria-label="Назад">‹</button>
      <h1 style={{ flex: 1 }}>{title}</h1>
      {right}
    </div>
  );
}
