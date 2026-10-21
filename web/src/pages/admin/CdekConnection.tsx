import { useEffect, useState, type FormEvent } from 'react';
import { useStore, useToast } from '../../app/providers';
import { api, adminApi, ApiError } from '../../lib/api';

type City = { code: number; city: string; region: string };
type Form = { clientId: string; clientSecret: string; mode: 'test' | 'live'; originCityCode: number; originPoint: string; senderName: string; senderPhone: string; weight: number; length: number; width: number; height: number };

export function CdekConnection() {
  const { store } = useStore();
  const toast = useToast();
  const [status, setStatus] = useState<{ connected: boolean; clientId?: string; mode?: string; originCityCode?: number; originPoint?: string } | null>(null);
  const [owner, setOwner] = useState<boolean | null>(null);
  const [form, setForm] = useState<Form>({ clientId: '', clientSecret: '', mode: 'test', originCityCode: 0, originPoint: '', senderName: store?.name ?? '', senderPhone: '', weight: 500, length: 30, width: 25, height: 10 });
  const [editing, setEditing] = useState(false);
  const [cityQuery, setCityQuery] = useState(store?.city ?? '');
  const [cities, setCities] = useState<City[]>([]);
  const [points, setPoints] = useState<{ code: string; name: string; address: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!store) return;
    api.profile().then((profile) => {
      const canConnect = profile.stores.some((item) => item.id === store.id && item.role === 'owner');
      setOwner(canConnect);
      return canConnect ? adminApi.cdekConnection(store.id) : null;
    }).then((result) => {
      if (!result) return;
      const { connection } = result;
      setStatus(connection);
      setEditing(!connection.connected);
      if (connection.connected) setForm((f) => ({ ...f, clientId: connection.clientId ?? '', mode: connection.mode ?? 'test', originCityCode: connection.originCityCode ?? 0, originPoint: connection.originPoint ?? '', senderName: connection.senderName ?? f.senderName, senderPhone: connection.senderPhone ?? '', weight: connection.weight ?? 500, length: connection.length ?? 30, width: connection.width ?? 25, height: connection.height ?? 10 }));
    }).catch((e) => setError(e instanceof ApiError ? e.message : 'Не удалось проверить подключение'));
  }, [store?.id]);
  useEffect(() => {
    if (!editing || cityQuery.trim().length < 2 || form.originCityCode) { setCities([]); return; }
    const timer = window.setTimeout(() => api.cdekCities(cityQuery).then((r) => setCities(r.cities)).catch(() => setCities([])), 350);
    return () => window.clearTimeout(timer);
  }, [cityQuery, form.originCityCode, editing]);
  useEffect(() => {
    if (!editing || !form.originCityCode) { setPoints([]); return; }
    api.cdekPoints(form.originCityCode).then((r) => setPoints(r.points)).catch(() => setPoints([]));
  }, [form.originCityCode, editing]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!store || busy || !form.originCityCode || !form.originPoint) return;
    setBusy(true); setError('');
    try {
      await adminApi.saveCdekConnection(store.id, form);
      setStatus({ connected: true, mode: form.mode, originCityCode: form.originCityCode, originPoint: form.originPoint });
      setForm((f) => ({ ...f, clientSecret: '' }));
      setEditing(false); toast('Ключи СДЭК проверены и сохранены');
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Не удалось подключить СДЭК'); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!store || !window.confirm('Отключить СДЭК? Уже созданные накладные останутся у перевозчика, но автоматическая проверка ожидающих отправлений остановится.')) return;
    setBusy(true);
    try { await adminApi.removeCdekConnection(store.id); setStatus({ connected: false }); setEditing(true); toast('СДЭК отключён'); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Не удалось отключить СДЭК'); }
    finally { setBusy(false); }
  }
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));

  return <section className="delivery-guide-section cdek-connection">
    <h2>Подключение вашего кабинета</h2>
    {owner === false && <p className="small muted">Подключать ключи перевозчика может только владелец магазина. Обратитесь к нему, если нужно изменить доставку.</p>}
    {owner !== false && status === null && !error && <p className="small muted">Проверяем подключение…</p>}
    {status?.connected && !editing && <div className="cdek-connection-status"><strong>Ключи проверены · {status.mode === 'live' ? 'рабочая среда' : 'тестовая среда'}</strong><p className="small muted">Город отправления: код СДЭК {status.originCityCode}. Пункт сдачи: {status.originPoint}. Тариф рассчитывается по параметрам упаковки. Оформить накладную можно в подтверждённом и оплаченном заказе.</p><div className="row"><button type="button" className="btn small outline" onClick={() => setEditing(true)}>Изменить подключение</button><button type="button" className="btn small secondary" disabled={busy} onClick={remove}>Отключить</button></div></div>}
    {editing && <form onSubmit={save} className="cdek-connection-form">
      {status?.connected && <p className="small muted">Для изменения повторно введите оба ключа. Сохранённый секрет не показывается.</p>}
      <div className="field"><label htmlFor="cdek-mode">Среда СДЭК</label><select id="cdek-mode" value={form.mode} onChange={(e) => set('mode', e.target.value as Form['mode'])}><option value="test">Тестовая — без реальных отправлений</option><option value="live">Рабочая — создание платных накладных</option></select></div>
      <div className="field"><label htmlFor="cdek-id">Идентификатор аккаунта (client_id)</label><input id="cdek-id" autoComplete="off" required maxLength={200} value={form.clientId} onChange={(e) => set('clientId', e.target.value)} /></div>
      <div className="field"><label htmlFor="cdek-secret">Секретный ключ (client_secret)</label><input id="cdek-secret" type="password" autoComplete="new-password" required maxLength={500} value={form.clientSecret} onChange={(e) => set('clientSecret', e.target.value)} /></div>
      <div className="field"><label htmlFor="cdek-city">Город сдачи посылок</label><input id="cdek-city" required value={cityQuery} onChange={(e) => { setCityQuery(e.target.value); setForm((f) => ({ ...f, originCityCode: 0, originPoint: '' })); }} placeholder="Начните вводить город" aria-describedby="cdek-city-help" /><p id="cdek-city-help" className="small muted">Выберите город из списка. Покупатель сам выберет свой ПВЗ получения.</p>{cities.length > 0 && <div className="checkout-city-results" role="group" aria-label="Города СДЭК">{cities.map((city) => <button type="button" key={city.code} className="checkout-city-result" onClick={() => { setCityQuery(city.city); setForm((f) => ({ ...f, originCityCode: city.code, originPoint: '' })); setCities([]); }}>{city.city}<small>{city.region}</small></button>)}</div>}{form.originCityCode > 0 && <p className="small">Выбран код города {form.originCityCode}</p>}</div>
      {form.originCityCode > 0 && <div className="field"><label htmlFor="cdek-origin">Пункт, куда вы сдадите посылку</label><select id="cdek-origin" required value={form.originPoint} onChange={(e) => set('originPoint', e.target.value)}><option value="">Выберите пункт сдачи</option>{points.map((point) => <option key={point.code} value={point.code}>{point.address || point.name} · {point.code}</option>)}</select><p className="small muted">Он нужен для тарифа и накладной. Покупатель не ограничен этим пунктом.</p></div>}
      <div className="row"><div className="field"><label htmlFor="cdek-sender">ФИО отправителя</label><input id="cdek-sender" required maxLength={100} autoComplete="name" value={form.senderName} onChange={(e) => set('senderName', e.target.value)} /></div><div className="field"><label htmlFor="cdek-phone">Телефон отправителя</label><input id="cdek-phone" type="tel" required maxLength={24} autoComplete="tel" value={form.senderPhone} onChange={(e) => set('senderPhone', e.target.value)} placeholder="+79991234567" /></div></div>
      <p className="small muted">Размеры одной упакованной посылки по умолчанию. Перед оформлением каждого заказа проверьте фактические вес и габариты.</p>
      <div className="cdek-package-fields">{([['weight', 'Вес, г'], ['length', 'Длина, см'], ['width', 'Ширина, см'], ['height', 'Высота, см']] as const).map(([key, label]) => <div className="field" key={key}><label htmlFor={`cdek-${key}`}>{label}</label><input id={`cdek-${key}`} type="number" inputMode="numeric" required min={key === 'weight' ? 100 : 1} max={key === 'weight' ? 30000 : 200} value={form[key]} onChange={(e) => set(key, Number(e.target.value))} /></div>)}</div>
      {error && <p className="small" role="alert">{error}</p>}
      <div className="row"><button className="btn" disabled={busy || !form.originCityCode || !form.originPoint}>{busy ? 'Проверяем ключи…' : 'Проверить и сохранить'}</button>{status?.connected && <button type="button" className="btn outline" onClick={() => { setEditing(false); setError(''); }}>Отмена</button>}</div>
    </form>}
    {!editing && error && <p className="small" role="alert">{error}</p>}
  </section>;
}
