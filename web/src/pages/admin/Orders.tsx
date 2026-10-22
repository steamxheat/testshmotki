import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSearchParams } from 'react-router-dom';
import { useStore, useToast } from '../../app/providers';
import { Empty, ErrorState, Loader } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { adminApi, ApiError, downloadReceipt } from '../../lib/api';
import { assetUrl } from '../../lib/asset';
import { dateShort, deliveryLabel, money, orderStatusLabel, orderStatusTone } from '../../lib/format';
import type { Order } from '../../types';

const TABS = ['', 'pending', 'confirmed', 'completed', 'rejected', 'expired'];

export function AdminOrders() {
  const [params] = useSearchParams();
  const { store } = useStore();
  const toast = useToast();
  const [items, setItems] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(TABS.includes(params.get('status') ?? '') ? params.get('status')! : '');
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [cdekQuote, setCdekQuote] = useState<{ orderId: string; mode: 'test' | 'live'; originPoint: string; tariffCode: number; tariffName: string; price: number; periodMin?: number; periodMax?: number } | null>(null);
  const [cdekBusy, setCdekBusy] = useState<string | null>(null);
  const [manualPrice, setManualPrice] = useState<Record<string, string>>({});
  const [manualTracking, setManualTracking] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    adminApi.orders(store!.id, { status: status || undefined })
      .then((r) => { if (active) setItems(r.items); })
      .catch((e) => { if (active) setError(e instanceof ApiError ? e.message : 'Не удалось загрузить заказы'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [store?.id, status, reloadKey]);

  const reload = () => setReloadKey((n) => n + 1);

  async function action(o: Order, a: 'accept' | 'reject' | 'complete' | 'payment-confirm') {
    const labels = { accept: 'Принять заявку?', reject: 'Отклонить заявку?', complete: 'Завершить сделку? Остатки будут списаны.', 'payment-confirm': 'Вы проверили поступление денег и подтверждаете оплату?' };
    if (!confirm(labels[a])) return;
    try { await adminApi.orderAction(store!.id, o.id, a); toast('Статус обновлён'); reload(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Ошибка'); }
  }

  async function quoteShipment(o: Order) {
    setCdekBusy(o.id);
    try { const result = await adminApi.cdekQuote(store!.id, o.id); setCdekQuote({ orderId: o.id, mode: result.mode, ...result.quote }); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Не удалось рассчитать СДЭК'); }
    finally { setCdekBusy(null); }
  }
  async function createShipment(o: Order) {
    const quote = cdekQuote;
    if (!quote || quote.orderId !== o.id) return;
    const warning = quote.mode === 'live' ? 'Это создаст реальную накладную СДЭК и может привести к списанию денег по договору.' : 'Это создаст тестовую накладную СДЭК.';
    if (!confirm(`${warning}\n\n${quote.tariffName}: ${money(quote.price)}. Подтвердить?`)) return;
    setCdekBusy(o.id);
    try { await adminApi.cdekCreate(store!.id, o.id, quote.mode, quote.tariffCode, Math.round(quote.price * 100)); setCdekQuote(null); toast('Запрос принят СДЭК. Проверьте результат через несколько секунд.'); reload(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Не удалось создать отправление'); setCdekQuote(null); reload(); }
    finally { setCdekBusy(null); }
  }
  async function checkShipment(o: Order) {
    setCdekBusy(o.id);
    try { await adminApi.cdekCheck(store!.id, o.id); reload(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Не удалось проверить отправление'); }
    finally { setCdekBusy(null); }
  }

  async function saveManualPrice(o: Order) {
    const price = Number(manualPrice[o.id]);
    if (!Number.isFinite(price) || price < 0 || price > 100000 || manualPrice[o.id]?.trim() === '') { toast('Укажите стоимость доставки от 0 до 100 000 ₽'); return; }
    if (!confirm(`Подтвердить согласованную стоимость доставки ${money(price)}? Покупатель получит уведомление и итоговую сумму.`)) return;
    setCdekBusy(o.id);
    try { await adminApi.cdekManualPrice(store!.id, o.id, price); toast('Стоимость отправлена покупателю'); reload(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Не удалось сохранить стоимость'); }
    finally { setCdekBusy(null); }
  }
  async function saveManualTracking(o: Order) {
    const tracking = manualTracking[o.id]?.trim() ?? '';
    if (!/^[A-Za-z0-9-]{6,40}$/.test(tracking)) { toast('Проверьте трек-номер СДЭК'); return; }
    if (!confirm(`Отправление оформлено в СДЭК? Покупателю придёт трек-номер ${tracking}.`)) return;
    setCdekBusy(o.id);
    try { await adminApi.cdekManualTracking(store!.id, o.id, tracking); toast('Трек-номер отправлен покупателю'); reload(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Не удалось сохранить трек-номер'); }
    finally { setCdekBusy(null); }
  }

  return (
    <div className="page">
      <h1 style={{ marginBottom: 12 }}>Заказы</h1>
      <div className="tabs">
        {TABS.map((s) => (
          <button key={s || 'all'} className={`chip ${status === s ? 'active' : ''}`} onClick={() => setStatus(s)}>
            {s ? orderStatusLabel[s as keyof typeof orderStatusLabel] : 'Все'}
          </button>
        ))}
      </div>

      {loading ? <Loader /> : error ? <ErrorState message={error} onRetry={reload} /> : items.length === 0 ? (
        <Empty icon="package" title="Заявок пока нет" />
      ) : (
        <div className="list">
          {items.map((o) => (
            <div key={o.id} className="card" style={{ padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span className="small muted">№{o.publicNumber} · {dateShort(o.createdAt)}</span>
                <span className={`status ${orderStatusTone[o.status]}`}>{orderStatusLabel[o.status]}</span>
              </div>
              <div className="listitem" style={{ padding: 0 }}>
                {o.cover && <img className="thumb" src={assetUrl(o.cover)} alt="" />}
                <div className="grow">
                  <div style={{ fontWeight: 600 }}>{o.productTitle}</div>
                  <div className="price">{money(o.price)}</div>
                  {o.items.length > 0 && <div className="order-lines small muted">{o.items.map((i) => <div key={i.variantId}>{i.title} · {i.size} · {i.quantity} шт.</div>)}</div>}
                </div>
              </div>

              <div className="card" style={{ background: 'var(--tg-secondary-bg)', padding: 10, marginTop: 10 }}>
                <div className="small"><b>{o.buyerName}</b>{o.buyerUsername ? ` · @${o.buyerUsername}` : ''}</div>
                {o.buyerPhone && <div className="small inline-icon"><Icon name="phone" size={14} />{o.buyerPhone}</div>}
                {o.buyerEmail && <div className="small">Почта: {o.buyerEmail}</div>}
                <div className="small">{deliveryLabel[o.deliveryMethod]}{o.city ? ` · ${o.city}` : ''}</div>
                {o.deliveryAddress && <div className="small">Адрес / ПВЗ: {o.deliveryAddress}</div>}
                {o.deliveryPoint && <div className="small">Пункт: {o.deliveryPoint}</div>}
                {o.deliveryPointCode && <div className="small">Код ПВЗ СДЭК: {o.deliveryPointCode}</div>}
                {o.deliveryTariff && <div className="small">{o.deliveryTariff === 'Ручное оформление' ? 'Доставка' : 'Тариф продавца'}: {o.deliveryTariff} · {o.deliveryPrice == null ? 'стоимость не указана' : money(o.deliveryPrice)}</div>}
                {o.deliveryPrice != null && <div className="small"><b>С покупателя всего: {money(o.price + o.deliveryPrice)}</b></div>}
                {o.shipment && <div className="small" style={{ marginTop: 8 }}><b>СДЭК · {o.shipment.mode === 'manual' ? 'вручную' : o.shipment.mode === 'test' ? 'тест' : 'рабочая среда'}</b><div>Состояние: {o.shipment.mode === 'manual' ? 'трек-номер внесён продавцом' : o.shipment.state === 'created' ? 'накладная создана' : o.shipment.state === 'submitted' ? 'СДЭК обрабатывает запрос' : o.shipment.state === 'invalid' ? 'СДЭК отклонил накладную' : 'результат не подтверждён'}</div>{o.shipment.trackingNumber && <div>Трек-номер: {o.shipment.trackingNumber}</div>}{o.shipment.originPoint && <div>Пункт сдачи: {o.shipment.originPoint}</div>}{o.shipment.error && <div role="alert">{o.shipment.error}</div>}</div>}
                {o.comment && <div className="small muted" style={{ marginTop: 4 }}>«{o.comment}»</div>}
              </div>

              {o.deliveryMethod === 'cdek' && o.deliveryTariff === 'Ручное оформление' && o.status === 'confirmed' && o.deliveryPrice == null && <div className="order-shipment"><strong>Согласуйте доставку</strong><p className="small muted">Уточните стоимость СДЭК с покупателем в чате. До сохранения цены реквизиты и загрузка чека ему недоступны.</p><div className="row"><div className="field grow"><label htmlFor={`manual-price-${o.id}`}>Стоимость доставки, ₽</label><input id={`manual-price-${o.id}`} type="number" inputMode="decimal" min="0" max="100000" step="0.01" value={manualPrice[o.id] ?? ''} onChange={(e) => setManualPrice((prev) => ({ ...prev, [o.id]: e.target.value }))} /></div><button className="btn small" type="button" disabled={cdekBusy === o.id} onClick={() => saveManualPrice(o)}>Сообщить покупателю</button></div></div>}

              {o.deliveryMethod === 'cdek' && o.deliveryTariff === 'Ручное оформление' && o.status === 'confirmed' && o.paymentConfirmedAt && !o.shipment && <div className="order-shipment"><strong>Оформите СДЭК вручную</strong><p className="small muted">Создайте отправление в кабинете или отделении СДЭК. Затем внесите трек-номер; приложение само не создаёт накладную и QR-код.</p><div className="row"><div className="field grow"><label htmlFor={`manual-tracking-${o.id}`}>Трек-номер</label><input id={`manual-tracking-${o.id}`} value={manualTracking[o.id] ?? ''} maxLength={40} onChange={(e) => setManualTracking((prev) => ({ ...prev, [o.id]: e.target.value }))} /></div><button className="btn small" type="button" disabled={cdekBusy === o.id} onClick={() => saveManualTracking(o)}>Отправить трек-номер</button></div></div>}

              {o.deliveryMethod === 'cdek' && o.deliveryTariff !== 'Ручное оформление' && o.status === 'confirmed' && o.paymentConfirmedAt && <div className="order-shipment">
                {!o.shipment && <><button className="btn small outline" disabled={cdekBusy === o.id} onClick={() => quoteShipment(o)}>{cdekBusy === o.id ? 'Считаем тариф…' : 'Рассчитать СДЭК'}</button>{cdekQuote?.orderId === o.id && <div className="order-shipment-quote"><strong>{cdekQuote.tariffName} · {money(cdekQuote.price)}</strong><p className="small muted">{cdekQuote.periodMin && cdekQuote.periodMax ? `${cdekQuote.periodMin}–${cdekQuote.periodMax} дней · ` : ''}Сдача: {cdekQuote.originPoint} · {cdekQuote.mode === 'test' ? 'тестовая среда' : 'рабочая среда'}. Доставка оплачивается по договору продавца со СДЭК.</p><button className="btn small" disabled={cdekBusy === o.id} onClick={() => createShipment(o)}>Создать накладную</button></div>}</>}
                {o.shipment && o.shipment.state === 'submitted' && <button className="btn small outline" disabled={cdekBusy === o.id} onClick={() => checkShipment(o)}>{cdekBusy === o.id ? 'Проверяем…' : 'Проверить в СДЭК'}</button>}
              </div>}

              {(o.status === 'confirmed' || o.status === 'completed') && <div className="order-payment">
                <strong>{o.paymentConfirmedAt ? 'Оплата подтверждена' : o.deliveryMethod === 'cdek' && o.deliveryPrice == null ? 'Ожидаем согласования доставки' : o.receiptSubmittedAt ? 'Чек прислан — проверьте поступление' : 'Ожидаем оплату'}</strong>
                {o.receiptSubmittedAt && <button className="text-action" onClick={() => downloadReceipt(o.id).catch(() => toast('Не удалось скачать чек'))}>Скачать чек</button>}
                {o.status === 'confirmed' && !o.paymentConfirmedAt && !(o.deliveryMethod === 'cdek' && o.deliveryPrice == null) && <button className="btn small outline" onClick={() => action(o, 'payment-confirm')}>Подтвердить получение денег</button>}
                {!o.receiptSubmittedAt && !o.paymentConfirmedAt && <p className="small muted">Если покупатель оплатил вне приложения, подтвердите поступление вручную.</p>}
              </div>}

              {o.history && o.history.length > 1 && (
                <div className="small muted" style={{ marginTop: 8 }}>
                  История: {o.history.map((hst) => orderStatusLabel[hst.newStatus]).join(' → ')}
                </div>
              )}

              <div className="order-actions" style={{ marginTop: 10 }}>
                <Link className="btn small outline" to={`/admin/chats/${o.buyerId}`}><Icon name="chat" size={17} />Покупателю</Link>
                {o.status === 'pending' && <button className="btn small" onClick={() => action(o, 'accept')}>Принять</button>}
                {(o.status === 'pending' || o.status === 'confirmed') && <button className="btn small danger" onClick={() => action(o, 'reject')}>Отклонить</button>}
                {o.status === 'confirmed' && <button className="btn small" onClick={() => action(o, 'complete')} disabled={!o.paymentConfirmedAt}>Завершить</button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
