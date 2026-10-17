import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../app/providers';
import { Loader } from '../components/ui';
import { api } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { isTelegram } from '../lib/telegram';

export function Profile() {
  const toast = useToast();
  const { data, loading } = useAsync(() => api.profile(), []);
  const [notif, setNotif] = useState(() => localStorage.getItem('notif') !== '0');

  if (loading || !data) return <div className="page"><Loader /></div>;
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

      {data.stores.length > 0 && (
        <Link to="/admin" className="btn" style={{ marginBottom: 10 }}>🛠 Админ-панель продавца</Link>
      )}
      {data.isSuperadmin && (
        <Link to="/super" className="btn secondary" style={{ marginBottom: 10 }}>⚙️ Панель суперадмина</Link>
      )}

      <div className="card" style={{ padding: '4px 14px', marginTop: 4 }}>
        <label className="kv" style={{ cursor: 'pointer' }}>
          <span className="k">Уведомления</span>
          <input type="checkbox" style={{ width: 'auto', minHeight: 'auto' }} checked={notif} onChange={(e) => { setNotif(e.target.checked); localStorage.setItem('notif', e.target.checked ? '1' : '0'); }} />
        </label>
        <div className="kv"><span className="k">Политика конфиденциальности</span><Link to="#" onClick={(e) => { e.preventDefault(); toast('Документ появится перед запуском'); }}>Открыть</Link></div>
        <div className="kv"><span className="k">Пользовательское соглашение</span><Link to="#" onClick={(e) => { e.preventDefault(); toast('Документ появится перед запуском'); }}>Открыть</Link></div>
        <div className="kv"><span className="k">Поддержка</span><Link to="#" onClick={(e) => { e.preventDefault(); toast('Напишите в чат магазина'); }}>Связаться</Link></div>
      </div>

      {!isTelegram && <DevPanel />}
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
        <input value={id} onChange={(e) => setId(e.target.value)} placeholder="100100100 — владелец демо-магазина" inputMode="numeric" />
      </div>
      <div className="row">
        <button className="btn small" onClick={() => { if (id) localStorage.setItem('devTelegramId', id); else localStorage.removeItem('devTelegramId'); location.reload(); }}>Применить</button>
        <button className="btn small outline" onClick={() => { localStorage.removeItem('devTelegramId'); location.reload(); }}>Сбросить</button>
      </div>
    </div>
  );
}
