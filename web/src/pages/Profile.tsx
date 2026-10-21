import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorState, Loader } from '../components/ui';
import { Icon } from '../components/Icon';
import { api } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { isTelegram } from '../lib/telegram';
import { useStore } from '../app/providers';

export function Profile() {
  const { store } = useStore();
  const { data, loading, error, reload } = useAsync(() => api.profile(), []);

  if (loading) return <div className="page"><Loader /></div>;
  if (error || !data) return <div className="page"><ErrorState message={error ?? 'Не удалось загрузить профиль'} onRetry={reload} /></div>;
  const u = data.user;

  return (
    <div className="page">
      <h1 style={{ marginBottom: 14 }}>Профиль</h1>

      <div className="card storehead" style={{ marginBottom: 14 }}>
        {u.avatarUrl ? <img className="avatar" src={u.avatarUrl} alt="" /> : <div className="avatar" />}
        <div>
          <div style={{ fontWeight: 700, fontSize: 17 }}>{u.firstName ?? 'Гость'} {u.lastName ?? ''}</div>
          {u.username && <div className="small muted">@{u.username}</div>}
          <div className="small muted">Заказов: {data.ordersCount}</div>
        </div>
      </div>

      {data.stores.some((s) => s.id === store?.id) && (
        <Link to="/admin" className="btn" style={{ marginBottom: 10 }}><Icon name="settings" />Управление магазином</Link>
      )}

      <div className="card" style={{ padding: '4px 14px', marginTop: 4 }}>
        <div className="kv"><span className="k">Мои заказы</span><Link className="text-action" to="/orders">Открыть</Link></div>
        <div className="kv"><span className="k">Уведомления</span><span className="small muted">Приходят в Telegram</span></div>
        <div className="kv"><span className="k">Политика конфиденциальности</span>{store?.settings.privacyUrl ? <a className="text-action" href={store.settings.privacyUrl} target="_blank" rel="noopener noreferrer">Открыть</a> : <span className="small muted">Не опубликована продавцом</span>}</div>
        <div className="kv"><span className="k">Пользовательское соглашение</span>{store?.settings.termsUrl ? <a className="text-action" href={store.settings.termsUrl} target="_blank" rel="noopener noreferrer">Открыть</a> : <span className="small muted">Не опубликовано продавцом</span>}</div>
        <div className="kv"><span className="k">Поддержка</span><Link className="text-action" to="/chat">Связаться</Link></div>
      </div>

      {import.meta.env.DEV && !isTelegram && <DevPanel />}
    </div>
  );
}

// Только для отладки в браузере: вход под нужным Telegram ID (например, владельца магазина).
function DevPanel() {
  const [id, setId] = useState(localStorage.getItem('devTelegramId') ?? '');
  return (
    <div className="card" style={{ padding: 14, marginTop: 16, borderStyle: 'dashed' }}>
      <div className="small muted" style={{ marginBottom: 8 }}>Dev-режим (вне Telegram)</div>
      <div className="field" style={{ marginBottom: 8 }}>
        <label>Войти как Telegram ID</label>
        <input value={id} onChange={(e) => setId(e.target.value)} placeholder="Ваш Telegram ID" inputMode="numeric" />
      </div>
      <div className="row">
        <button className="btn small" onClick={() => { if (id) localStorage.setItem('devTelegramId', id); else localStorage.removeItem('devTelegramId'); location.reload(); }}>Применить</button>
        <button className="btn small outline" onClick={() => { localStorage.removeItem('devTelegramId'); location.reload(); }}>Сбросить</button>
      </div>
    </div>
  );
}
