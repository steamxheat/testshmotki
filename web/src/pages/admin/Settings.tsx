import { useEffect, useRef, useState } from 'react';
import { useStore, useToast } from '../../app/providers';
import { Loader } from '../../components/ui';
import { adminApi, api, ApiError } from '../../lib/api';
import { deliveryLabel } from '../../lib/format';
import type { DeliveryMethod, Store } from '../../types';

const DELIVERY: DeliveryMethod[] = ['meetup', 'cdek', 'russian_post', 'discuss'];

export function Settings() {
  const { store: ctxStore, reloadStore } = useStore();
  const toast = useToast();
  const [store, setStore] = useState<Store | null>(null);
  const [members, setMembers] = useState<{ userId: string; role: string; telegramId: string; firstName: string | null; username: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newMember, setNewMember] = useState('');
  const logoRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);

  function load() {
    adminApi.settings(ctxStore!.id).then((r) => { setStore(r.store); setMembers(r.members); }).finally(() => setLoading(false));
  }
  useEffect(load, [ctxStore?.id]);

  if (loading || !store) return <div className="page"><Loader /></div>;

  const upd = (patch: Partial<Store>) => setStore({ ...store, ...patch });
  const updSettings = (patch: Partial<Store['settings']>) => setStore({ ...store, settings: { ...store.settings, ...patch } });

  async function uploadTo(kind: 'logoUrl' | 'coverUrl', files: FileList | null) {
    if (!files?.length) return;
    try { const [url] = await api.upload(files); upd({ [kind]: url } as Partial<Store>); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Ошибка загрузки'); }
  }

  async function save() {
    setSaving(true);
    try {
      await adminApi.updateSettings(ctxStore!.id, {
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
          showSold: store!.settings.showSold,
          blocks: store!.settings.blocks,
          socialLinks: store!.settings.socialLinks,
        },
      });
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
    try { await adminApi.addMember(ctxStore!.id, newMember.trim()); setNewMember(''); toast('Сотрудник добавлен'); load(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Ошибка'); }
  }
  async function removeMember(userId: string) {
    if (!confirm('Удалить сотрудника?')) return;
    try { await adminApi.removeMember(ctxStore!.id, userId); load(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Ошибка'); }
  }

  const toggleDelivery = (d: DeliveryMethod) =>
    updSettings({ deliveryMethods: store.settings.deliveryMethods.includes(d) ? store.settings.deliveryMethods.filter((x) => x !== d) : [...store.settings.deliveryMethods, d] });

  return (
    <div className="page" style={{ paddingBottom: 96 }}>
      <h1 style={{ marginBottom: 14 }}>Настройки магазина</h1>

      <div className="field"><label>Название</label><input value={store.name} onChange={(e) => upd({ name: e.target.value })} /></div>
      <div className="field"><label>Адрес магазина (slug)</label><input value={store.slug} onChange={(e) => upd({ slug: e.target.value })} /><p className="small muted">Менять можно не чаще 1 раза в 30 дней. Ссылка: t.me/бот/app?startapp=store_{store.slug}</p></div>
      <div className="field"><label>Описание</label><textarea value={store.description ?? ''} onChange={(e) => upd({ description: e.target.value })} /></div>
      <div className="row">
        <div className="field"><label>Город</label><input value={store.city ?? ''} onChange={(e) => upd({ city: e.target.value })} /></div>
        <div className="field"><label>Telegram для связи</label><input value={store.contactUsername ?? ''} onChange={(e) => upd({ contactUsername: e.target.value })} placeholder="username" /></div>
      </div>

      <div className="row">
        <div className="field">
          <label>Логотип</label>
          {store.logoUrl && <img src={store.logoUrl} alt="" style={{ width: 56, height: 56, borderRadius: 12, objectFit: 'cover', marginBottom: 6 }} />}
          <button className="btn small outline" onClick={() => logoRef.current?.click()}>Загрузить</button>
          <input ref={logoRef} type="file" accept="image/*" hidden onChange={(e) => uploadTo('logoUrl', e.target.files)} />
        </div>
        <div className="field">
          <label>Обложка</label>
          {store.coverUrl && <img src={store.coverUrl} alt="" style={{ width: '100%', height: 56, borderRadius: 12, objectFit: 'cover', marginBottom: 6 }} />}
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
      </div>

      <div className="field"><label>График ответа</label><input value={store.settings.responseSchedule ?? ''} onChange={(e) => updSettings({ responseSchedule: e.target.value })} /></div>
      <div className="field"><label>Правила бронирования</label><input value={store.settings.reservationRules ?? ''} onChange={(e) => updSettings({ reservationRules: e.target.value })} /></div>

      <div className="field">
        <label>Акцентный цвет</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {['#ff5a1f', '#111827', '#2f6fed', '#10b981', '#e5484d', '#8b5cf6'].map((c) => (
            <button key={c} onClick={() => updSettings({ accentColor: c })} aria-label={c} style={{ width: 36, height: 36, borderRadius: 10, background: c, border: store.settings.accentColor === c ? '3px solid var(--tg-text)' : '1px solid var(--border)' }} />
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
              {m.role !== 'owner' && <button className="chip" onClick={() => removeMember(m.userId)}>Удалить</button>}
            </div>
          ))}
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <input placeholder="Telegram ID сотрудника" value={newMember} onChange={(e) => setNewMember(e.target.value)} inputMode="numeric" />
          <button className="btn small" style={{ flex: '0 0 auto', width: 'auto' }} onClick={addMember}>Добавить</button>
        </div>
      </div>

      <div className="bar">
        <button className="btn" onClick={save} disabled={saving}>{saving ? 'Сохраняем…' : 'Сохранить настройки'}</button>
      </div>
    </div>
  );
}
