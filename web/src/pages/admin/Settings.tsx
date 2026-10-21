import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useStore, useToast } from '../../app/providers';
import { Icon } from '../../components/Icon';
import { ErrorState, Loader } from '../../components/ui';
import { adminApi, api, ApiError } from '../../lib/api';
import { assetUrl } from '../../lib/asset';
import { deliveryLabel } from '../../lib/format';
import { setCurrentStoreSlug } from '../../lib/telegram';
import type { DeliveryMethod, DeliveryOption, Store } from '../../types';

const DeliveryMap = lazy(() => import('../../components/DeliveryMap').then((m) => ({ default: m.DeliveryMap })));
const DELIVERY: DeliveryMethod[] = ['meetup', 'cdek', 'russian_post', 'yandex_delivery', 'dhl', 'discuss'];
const POINT_METHODS: DeliveryOption['method'][] = ['meetup', 'russian_post', 'yandex_delivery', 'dhl'];
const DELIVERY_GUIDES = ['cdek', 'russian_post', 'yandex_delivery'] as const;

export function Settings() {
  const location = useLocation();
  const { store: ctxStore, reloadStore } = useStore();
  const toast = useToast();
  const [store, setStore] = useState<Store | null>(null);
  const [members, setMembers] = useState<{ userId: string; role: string; telegramId: string; firstName: string | null; username: string | null }[]>([]);
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [newMember, setNewMember] = useState('');
  const [paymentDetails, setPaymentDetails] = useState('');
  const [mapOptionId, setMapOptionId] = useState<string | null>(null);
  const logoRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);
  const backgroundRef = useRef<HTMLInputElement>(null);

  function load() {
    setLoading(true);
    setError(null);
    adminApi.settings(ctxStore!.id)
      .then((r) => { setStore(r.store); setPaymentDetails(r.paymentDetails ?? ''); setMembers(r.members); setIsOwner(r.myRole === 'owner'); })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Не удалось загрузить настройки'))
      .finally(() => setLoading(false));
  }
  useEffect(load, [ctxStore?.id]);

  if (loading) return <div className="page"><Loader /></div>;
  if (error || !store) return <div className="page"><ErrorState message={error ?? 'Настройки недоступны'} onRetry={load} /></div>;

  const upd = (patch: Partial<Store>) => setStore((current) => current ? { ...current, ...patch } : current);
  const updSettings = (patch: Partial<Store['settings']>) => setStore((current) => current ? { ...current, settings: { ...current.settings, ...patch } } : current);

  async function uploadTo(kind: 'logoUrl' | 'coverUrl', files: FileList | null) {
    if (!files?.length) return;
    try { const [url] = await api.upload(files); upd({ [kind]: url } as Partial<Store>); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Ошибка загрузки'); }
  }

  async function save() {
    setSaving(true);
    try {
      const previousSlug = ctxStore!.slug;
      const result = await adminApi.updateSettings(ctxStore!.id, {
        name: store!.name,
        slug: store!.slug,
        description: store!.description,
        city: store!.city,
        contactUsername: store!.contactUsername,
        logoUrl: store!.logoUrl,
        coverUrl: store!.coverUrl,
        settings: {
          deliveryMethods: store!.settings.deliveryMethods,
          responseSchedule: store!.settings.responseSchedule,
          reservationRules: store!.settings.reservationRules,
          accentColor: store!.settings.accentColor,
          backgroundUrl: store!.settings.backgroundUrl,
          privacyUrl: store!.settings.privacyUrl,
          termsUrl: store!.settings.termsUrl,
          paymentDetails,
          deliveryOptions: store!.settings.deliveryOptions,
          showSold: store!.settings.showSold,
          blocks: store!.settings.blocks,
          socialLinks: store!.settings.socialLinks,
        },
      });
      if (result.store.slug !== previousSlug) setCurrentStoreSlug(result.store.slug);
      toast('Сохранено');
      reloadStore();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  }

  async function addMember() {
    if (!newMember.trim()) return;
    try { await adminApi.addMember(ctxStore!.id, newMember.trim()); setNewMember(''); toast('Сотрудник добавлен'); refreshMembers(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Ошибка'); }
  }
  async function removeMember(userId: string) {
    if (!confirm('Удалить сотрудника?')) return;
    try { await adminApi.removeMember(ctxStore!.id, userId); refreshMembers(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Ошибка'); }
  }

  async function refreshMembers() {
    try {
      const r = await adminApi.settings(ctxStore!.id);
      setMembers(r.members);
      setIsOwner(r.myRole === 'owner');
    } catch { toast('Не удалось обновить список сотрудников'); }
  }

  const toggleDelivery = (d: DeliveryMethod) => {
    const next = store.settings.deliveryMethods.includes(d) ? store.settings.deliveryMethods.filter((x) => x !== d) : [...store.settings.deliveryMethods, d];
    if (!next.length) { toast('Оставьте хотя бы один способ получения'); return; }
    updSettings({ deliveryMethods: next });
  };
  const updateOption = (id: string, patch: Partial<DeliveryOption>) => updSettings({ deliveryOptions: store.settings.deliveryOptions.map((o) => o.id === id ? { ...o, ...patch } : o) });

  return (
    <div className="page" style={{ paddingBottom: 96 }}>
      <h1 style={{ marginBottom: 14 }}>Настройки магазина</h1>

      <div className="field"><label>Название</label><input aria-label="Название магазина" value={store.name} onChange={(e) => upd({ name: e.target.value })} /></div>
      <div className="field"><label>Адрес магазина (slug)</label><input aria-label="Адрес магазина" value={store.slug} onChange={(e) => upd({ slug: e.target.value })} /><p className="small muted">Менять можно не чаще 1 раза в 30 дней. После смены адреса старые ссылки на магазин перестанут работать.</p></div>
      <div className="field"><label>Описание</label><textarea aria-label="Описание магазина" value={store.description ?? ''} onChange={(e) => upd({ description: e.target.value })} /></div>
      <div className="row">
        <div className="field"><label>Город</label><input aria-label="Город" value={store.city ?? ''} onChange={(e) => upd({ city: e.target.value })} /></div>
        <div className="field"><label>Telegram для связи</label><input aria-label="Telegram для связи" value={store.contactUsername ?? ''} onChange={(e) => upd({ contactUsername: e.target.value })} placeholder="username" /></div>
      </div>

      <div className="field">
        <label>Фон всей витрины</label>
        {store.settings.backgroundUrl && <img className="settings-wallpaper-preview" src={assetUrl(store.settings.backgroundUrl)} alt="Текущий фон витрины" />}
        <div className="row">
          <button className="btn small outline" onClick={() => backgroundRef.current?.click()}>Загрузить фон</button>
          {store.settings.backgroundUrl && <button className="btn small secondary" onClick={() => updSettings({ backgroundUrl: null })}>Убрать фон</button>}
        </div>
        <input ref={backgroundRef} type="file" accept="image/*" hidden onChange={async (e) => {
          if (!e.target.files?.length) return;
          try { const [url] = await api.upload(e.target.files); updSettings({ backgroundUrl: url }); }
          catch (err) { toast(err instanceof ApiError ? err.message : 'Не удалось загрузить фон'); }
          e.target.value = '';
        }} />
        <p className="small muted">Фото будет видно на всех экранах магазина. Рекомендуем вертикальный снимок без текста.</p>
      </div>

      <div className="row">
        <div className="field">
          <label>Логотип</label>
          {store.logoUrl && <img src={assetUrl(store.logoUrl)} alt="" style={{ width: 56, height: 56, borderRadius: 12, objectFit: 'cover', marginBottom: 6 }} />}
          <button className="btn small outline" onClick={() => logoRef.current?.click()}>Загрузить</button>
          <input ref={logoRef} type="file" accept="image/*" hidden onChange={(e) => uploadTo('logoUrl', e.target.files)} />
        </div>
        <div className="field">
          <label>Обложка</label>
          {store.coverUrl && <img src={assetUrl(store.coverUrl)} alt="" style={{ width: '100%', height: 56, borderRadius: 12, objectFit: 'cover', marginBottom: 6 }} />}
          <button className="btn small outline" onClick={() => coverRef.current?.click()}>Загрузить</button>
          <input ref={coverRef} type="file" accept="image/*" hidden onChange={(e) => uploadTo('coverUrl', e.target.files)} />
        </div>
      </div>

      <div className="field">
        <label>Способы получения</label>
        <div className="chips" style={{ flexWrap: 'wrap' }}>
          {DELIVERY.map((d) => (
            <button key={d} className={`chip ${store.settings.deliveryMethods.includes(d) ? 'active' : ''}`} onClick={() => toggleDelivery(d)}>{deliveryLabel[d]}</button>
          ))}
        </div>
        <p className="small muted">Включение способа показывает его покупателю. Для СДЭК отдельно подключите кабинет ниже: тогда покупатель увидит тариф, а продавец сможет создать накладную после оплаты. Ярлык и код сдачи пока оформляются через кабинет СДЭК.</p>
      </div>

      <div className="section delivery-guides">
        <h2>Подключение автоматической доставки</h2>
        <p className="small muted">СДЭК можно подключить для расчёта тарифа и оформления отправления из оплаченного заказа. Почта России и Яндекс пока работают вручную. Сохраните изменения настроек перед переходом.</p>
        <div className="delivery-guide-links">
          {DELIVERY_GUIDES.map((method) => (
            <Link key={method} to={{ pathname: `/admin/settings/delivery/${method}`, search: location.search }} className="delivery-guide-link">
              <span className="delivery-guide-link-icon"><Icon name="package" size={20} /></span>
              <span><strong>{deliveryLabel[method]}</strong><small>{method === 'cdek' ? 'Подключить кабинет и проверить ключи' : 'Что потребуется для подключения'}</small></span>
              <Icon name="chevronRight" size={20} />
            </Link>
          ))}
        </div>
      </div>

      <div className="section settings-delivery">
        <h2>Места встречи и ручные варианты</h2>
        <p className="small muted">Здесь можно указать место личной встречи или отдельный ручной вариант для других служб. ПВЗ СДЭК сюда добавлять не нужно: покупатель выбирает его сам.</p>
        {store.settings.deliveryOptions.filter((o) => o.method !== 'cdek').map((o) => <div className="card delivery-option-editor" key={o.id}>
          <div className="row"><div className="field"><label>Способ</label><div className="select-wrap"><select aria-label="Способ получения точки" value={o.method} onChange={(e) => updateOption(o.id, { method: e.target.value as DeliveryOption['method'] })}>{POINT_METHODS.map((method) => <option key={method} value={method}>{deliveryLabel[method]}</option>)}</select></div></div><div className="field"><label>Город</label><input aria-label="Город пункта" value={o.city} onChange={(e) => updateOption(o.id, { city: e.target.value })} /></div></div>
          <div className="field"><label>Название места</label><input aria-label="Название пункта" value={o.point} onChange={(e) => updateOption(o.id, { point: e.target.value })} placeholder="У метро Тверская" /></div>
          <div className="field"><label>Адрес</label><input aria-label="Адрес пункта" value={o.address} onChange={(e) => updateOption(o.id, { address: e.target.value })} /></div>
          <div className="row"><div className="field"><label>Тариф</label><input aria-label="Тариф" value={o.tariff} onChange={(e) => updateOption(o.id, { tariff: e.target.value })} placeholder="Стандарт" /></div><div className="field"><label>Стоимость, ₽</label><input aria-label="Стоимость доставки" type="number" min={0} max={100000} value={o.price} onChange={(e) => updateOption(o.id, { price: Math.max(0, Number(e.target.value) || 0) })} /></div></div>
          <div className="row"><div className="field"><label>Срок (необязательно)</label><input aria-label="Срок доставки" value={o.eta ?? ''} onChange={(e) => updateOption(o.id, { eta: e.target.value })} placeholder="3–5 дней" /></div><button className="btn small outline" onClick={() => updSettings({ deliveryOptions: store.settings.deliveryOptions.filter((item) => item.id !== o.id) })}>Убрать</button></div>
          <button className="btn small secondary" type="button" aria-expanded={mapOptionId === o.id} onClick={() => setMapOptionId(mapOptionId === o.id ? null : o.id)}>{o.lat == null ? 'Указать точку на карте' : 'Изменить точку на карте'}</button>
          {mapOptionId === o.id && <div className="delivery-editor-map"><p className="small muted">Перемещайте карту двумя пальцами, затем нажмите на нужное место. Адрес пункта выше заполняется отдельно.</p><Suspense fallback={<div className="delivery-map-placeholder">Загружаем карту…</div>}><DeliveryMap points={[]} location={o.lat != null && o.lon != null ? { lat: o.lat, lon: o.lon } : undefined} onPickLocation={(position) => updateOption(o.id, position)} /></Suspense>
            <div className="row"><div className="field"><label>Широта</label><input aria-label="Широта точки" type="number" step="any" min={-90} max={90} value={o.lat ?? ''} onChange={(e) => updateOption(o.id, { lat: e.target.value === '' ? undefined : Number(e.target.value) })} /></div><div className="field"><label>Долгота</label><input aria-label="Долгота точки" type="number" step="any" min={-180} max={180} value={o.lon ?? ''} onChange={(e) => updateOption(o.id, { lon: e.target.value === '' ? undefined : Number(e.target.value) })} /></div></div>
          </div>}
        </div>)}
        <button className="btn small outline" onClick={() => updSettings({ deliveryOptions: [...store.settings.deliveryOptions, { id: crypto.randomUUID(), method: 'meetup', city: store.city ?? '', point: '', address: '', tariff: 'Встреча', price: 0, eta: '' }] })}>Добавить место или вариант</button>
      </div>

      <div className="field settings-payment"><label htmlFor="payment-details">Реквизиты для перевода</label><textarea id="payment-details" value={paymentDetails} onChange={(e) => setPaymentDetails(e.target.value)} maxLength={1000} placeholder="Банк, номер карты или СБП, получатель" /><p className="small muted">Покупатель увидит реквизиты только после подтверждения заявки. Перевод происходит вне приложения; чек и поступление денег нужно проверить вручную.</p></div>

      <div className="section">
        <h2>Документы магазина</h2>
        <p className="small muted">Добавьте утверждённые для вашего магазина HTTPS-ссылки. Пока обе ссылки не сохранены, покупатели не смогут отправить заявку. Приложение не создаёт юридические тексты автоматически.</p>
        <div className="field"><label htmlFor="privacy-url">Политика конфиденциальности</label><input id="privacy-url" type="url" inputMode="url" value={store.settings.privacyUrl ?? ''} onChange={(e) => updSettings({ privacyUrl: e.target.value || null })} placeholder="https://…" /></div>
        <div className="field"><label htmlFor="terms-url">Пользовательское соглашение</label><input id="terms-url" type="url" inputMode="url" value={store.settings.termsUrl ?? ''} onChange={(e) => updSettings({ termsUrl: e.target.value || null })} placeholder="https://…" /></div>
      </div>

      <div className="field"><label>График ответа</label><input aria-label="График ответа" value={store.settings.responseSchedule ?? ''} onChange={(e) => updSettings({ responseSchedule: e.target.value })} /></div>
      <div className="field"><label>Правила бронирования</label><input aria-label="Правила бронирования" value={store.settings.reservationRules ?? ''} onChange={(e) => updSettings({ reservationRules: e.target.value })} /></div>

      <div className="field">
        <label>Акцентный цвет</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {['#486876', '#32434d', '#555f86', '#28665d', '#806171', '#625c80'].map((c) => (
            <button key={c} onClick={() => updSettings({ accentColor: c })} aria-label={`Акцентный цвет ${c}`} aria-pressed={store.settings.accentColor === c} style={{ width: 44, height: 44, borderRadius: 10, background: c, border: store.settings.accentColor === c ? '3px solid var(--tg-text)' : '1px solid var(--border)' }} />
          ))}
        </div>
      </div>

      <div className="card" style={{ padding: '4px 14px', marginBottom: 14 }}>
        {(['newArrivals', 'discounted', 'recent'] as const).map((b) => (
          <label key={b} className="kv" style={{ cursor: 'pointer' }}>
            <span className="k">Блок «{{ newArrivals: 'Новинки', discounted: 'Со скидкой', recent: 'Недавно добавлено' }[b]}»</span>
            <input type="checkbox" style={{ width: 'auto', minHeight: 'auto' }} checked={store.settings.blocks[b]} onChange={(e) => updSettings({ blocks: { ...store.settings.blocks, [b]: e.target.checked } })} />
          </label>
        ))}
        <label className="kv" style={{ cursor: 'pointer' }}>
          <span className="k">Показывать проданные товары</span>
          <input type="checkbox" style={{ width: 'auto', minHeight: 'auto' }} checked={store.settings.showSold} onChange={(e) => updSettings({ showSold: e.target.checked })} />
        </label>
      </div>

      <div className="section">
        <h2>Сотрудники</h2>
        <div className="list" style={{ marginTop: 10 }}>
          {members.map((m) => (
            <div key={m.userId} className="card listitem" style={{ alignItems: 'center' }}>
              <div className="grow">
                <div style={{ fontWeight: 600 }}>{m.firstName ?? 'Без имени'} {m.username ? `@${m.username}` : ''}</div>
                <div className="small muted">ID {m.telegramId} · {m.role === 'owner' ? 'владелец' : 'менеджер'}</div>
              </div>
              {isOwner && m.role !== 'owner' && <button className="chip" onClick={() => removeMember(m.userId)}>Удалить</button>}
            </div>
          ))}
        </div>
        {isOwner && <div className="row" style={{ marginTop: 10 }}>
          <input aria-label="Telegram ID сотрудника" placeholder="Telegram ID сотрудника" value={newMember} onChange={(e) => setNewMember(e.target.value)} inputMode="numeric" />
          <button className="btn small" style={{ flex: '0 0 auto', width: 'auto' }} onClick={addMember}>Добавить</button>
        </div>}
      </div>

      <div className="bar">
        <button className="btn" onClick={save} disabled={saving}>{saving ? 'Сохраняем…' : 'Сохранить настройки'}</button>
      </div>
    </div>
  );
}
