import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ErrorState, Loader } from '../components/ui';
import { Icon } from '../components/Icon';
import { api, ApiError } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { isTelegram } from '../lib/telegram';
import { useStore, useToast } from '../app/providers';

export function Profile() {
  const { store } = useStore();
  const toast = useToast();
  const { data, loading, error, reload } = useAsync(() => api.profile(), []);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [deliveryCity, setDeliveryCity] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');

  useEffect(() => {
    if (!data) return;
    setContactName(data.user.contactName ?? '');
    setPhone(data.user.phone ?? '');
    setContactEmail(data.user.contactEmail ?? '');
    setDeliveryCity(data.user.deliveryCity ?? '');
    setDeliveryAddress(data.user.deliveryAddress ?? '');
  }, [data]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.updateProfile({ contactName, phone, contactEmail, deliveryCity, deliveryAddress });
      setEditing(false);
      reload();
      toast('Данные сохранены');
    } catch (err) { toast(err instanceof ApiError ? err.message : 'Не удалось сохранить профиль'); }
    finally { setSaving(false); }
  }

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

      <section className="card" style={{ padding: 14, marginBottom: 14 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}><h2 style={{ margin: 0 }}>Мои данные</h2><button className="text-action" type="button" onClick={() => setEditing(!editing)}>{editing ? 'Свернуть' : 'Изменить'}</button></div>
        {editing ? <form onSubmit={save} style={{ marginTop: 14 }}>
          <div className="field"><label htmlFor="profile-name">ФИО</label><input id="profile-name" value={contactName} maxLength={100} autoComplete="name" onChange={(e) => setContactName(e.target.value)} /></div>
          <div className="field"><label htmlFor="profile-phone">Телефон</label><input id="profile-phone" type="tel" value={phone} maxLength={32} autoComplete="tel" onChange={(e) => setPhone(e.target.value)} /></div>
          <div className="field"><label htmlFor="profile-email">Почта</label><input id="profile-email" type="email" value={contactEmail} maxLength={200} autoComplete="email" onChange={(e) => setContactEmail(e.target.value)} /></div>
          <div className="field"><label htmlFor="profile-city">Город доставки</label><input id="profile-city" value={deliveryCity} maxLength={100} autoComplete="address-level2" onChange={(e) => setDeliveryCity(e.target.value)} /></div>
          <div className="field"><label htmlFor="profile-address">Адрес доставки</label><input id="profile-address" value={deliveryAddress} maxLength={300} autoComplete="street-address" onChange={(e) => setDeliveryAddress(e.target.value)} /></div>
          <p className="small muted">Данные подставятся в следующую заявку. Вы сможете изменить их перед отправкой.</p>
          <button className="btn" disabled={saving} type="submit">{saving ? 'Сохраняем…' : 'Сохранить'}</button>
        </form> : <p className="small muted" style={{ marginBottom: 0 }}>{data.user.contactName || data.user.phone || data.user.contactEmail || data.user.deliveryAddress ? [data.user.contactName, data.user.phone, data.user.contactEmail, data.user.deliveryCity, data.user.deliveryAddress].filter(Boolean).join(' · ') : 'Добавьте контакты и адрес для быстрого оформления заказа.'}</p>}
      </section>

      <div className="card" style={{ padding: '4px 14px', marginTop: 4 }}>
        <div className="kv"><span className="k">Мои заказы</span><Link className="text-action" to="/orders">Открыть</Link></div>
        <div className="kv"><span className="k">Уведомления</span><span className="small muted">Приходят в Telegram</span></div>
        <div className="kv"><span className="k">Политика конфиденциальности</span><Link className="text-action" to="/legal/privacy">Читать</Link></div>
        <div className="kv"><span className="k">Условия покупки и возврата</span><Link className="text-action" to="/legal/terms">Читать</Link></div>
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
