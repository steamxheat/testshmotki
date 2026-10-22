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

const TABS = ['', 'pending', 'confirmed', 'sent', 'completed', 'rejected', 'cancelled', 'expired'];

export function AdminOrders() {
  const [params] = useSearchParams();
  const { store } = useStore();
  const toast = useToast();
  const [items, setItems] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(TABS.includes(params.get('status') ?? '') ? params.get('status')! : '');
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [cdekQuote, setCdekQuote] = useState<{ orderId: string; mode: 'test' | 'live'; originPoint: string; tariffCode: number; tariffName: string; price: number; periodMin?: number; periodMax?: number } | null>(null);
  const [cdekBusy, setCdekBusy] = useState<string | null>(null);
  const [manualPrice, setManualPrice] = useState<Record<string, string>>({});
  const [manualTracking, setManualTracking] = useState<Record<string, string>>({});
  const [refundId, setRefundId] = useState<string | null>(null);
  const [refundReference, setRefundReference] = useState('');
  const [paymentRejectId, setPaymentRejectId] = useState<string | null>(null);
  const [paymentRejectReason, setPaymentRejectReason] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    adminApi.orders(store!.id, { status: status || undefined, page })
      .then((r) => { if (active) { setItems((prev) => page === 1 ? r.items : [...prev, ...r.items]); setHasMore(r.hasMore); } })
      .catch((e) => { if (active) setError(e instanceof ApiError ? e.message : 'Не удалось загрузить заказы'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [store?.id, status, page, reloadKey]);

  const reload = () => { setPage(1); setReloadKey((n) => n + 1); };

  async function action(o: Order, a: 'accept' | 'reject' | 'send' | 'complete' | 'payment-confirm') {
    const labels = { accept: 'Принять заявку?', reject: 'Отклонить заявку?', send: 'Вы действительно передали посылку перевозчику?', complete: 'Вещь уже вручена покупателю? После завершения остатки будут списаны, а покупатель сможет оставить отзыв.', 'payment-confirm': 'Вы проверили поступление денег и подтверждаете оплату?' };
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
    if (!confirm(`${warning}\n\n${quote.tariffName}: ${money(quote.price, store?.settings.currency)}. Подтвердить?`)) return;
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
    if (!Number.isFinite(price) || price < 0 || price > 100000 || manualPrice[o.id]?.trim() === '') { toast('Укажите стоимость доставки от 0 до 100 000'); return; }
    if (!confirm(`Подтвердить согласованную стоимость доставки ${money(price, store?.settings.currency)}? Покупатель получит уведомление и итоговую сумму.`)) return;
    setCdekBusy(o.id);
    try { await adminApi.cdekManualPrice(store!.id, o.id, price); toast('Стоимость отправлена покупателю'); reload(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Не удалось сохранить стоимость'); }
    finally { setCdekBusy(null); }
  }
  async function saveManualTracking(o: Order) {
    const tracking = manualTracking[o.id]?.trim() ?? '';
    if (!/^[A-Za-z0-9-]{6,40}$/.test(tracking)) { toast('Проверьте трек-номер'); return; }
    if (!confirm(`Отправление оформлено? Покупателю придёт трек-номер ${tracking}.`)) return;
    setCdekBusy(o.id);
    try { await (o.deliveryMethod === 'cdek' ? adminApi.cdekManualTracking(store!.id, o.id, tracking) : adminApi.manualShipment(store!.id, o.id, tracking)); toast('Трек-номер отправлен покупателю'); reload(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Не удалось сохранить трек-номер'); }
    finally { setCdekBusy(null); }
  }

  async function recordRefund(o: Order) {
    if (refundReference.trim().length < 3) { toast('Укажите номер операции или другое подтверждение возврата'); return; }
    if (!confirm(`Вы уже вернули покупателю ${money(o.price + (o.deliveryPrice ?? 0), store?.settings.currency)}? Приложение деньги не переводит.`)) return;
    try { await adminApi.orderRefund(store!.id, o.id, refundReference.trim()); toast('Возврат записан'); setRefundId(null); setRefundReference(''); reload(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Не удалось записать возврат'); }
  }

  async function rejectPayment(o: Order) {
    if (paymentRejectReason.trim().length < 10) { toast('Опишите, почему перевод не подтверждён'); return; }
    if (!confirm('Вы проверили поступления и уверены, что деньги не пришли? Заявка будет закрыта, остаток освобождён, а покупатель получит вашу причину.')) return;
    try { await adminApi.paymentReject(store!.id, o.id, paymentRejectReason.trim()); toast('Заявка закрыта, покупатель уведомлён'); setPaymentRejectId(null); setPaymentRejectReason(''); reload(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Не удалось закрыть заявку'); }
  }

  return (
    <div className="page">
      <h1 style={{ marginBottom: 12 }}>Заказы</h1>
      <div className="tabs">
        {TABS.map((s) => (
          <button key={s || 'all'} className={`chip ${status === s ? 'active' : ''}`} onClick={() => { setStatus(s); setPage(1); }}>
            {s ? orderStatusLabel[s as keyof typeof orderStatusLabel] : 'Все'}
          </button>
        ))}
      </div>

      {loading && page === 1 ? <Loader /> : error ? <ErrorState message={error} onRetry={reload} /> : items.length === 0 ? (
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
                  <div className="price">{money(o.price, store?.settings.currency)}</div>
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
                {o.deliveryTariff && <div className="small">{o.deliveryTariff === 'Ручное оформление' ? 'Доставка' : 'Тариф продавца'}: {o.deliveryTariff} · {o.deliveryPrice == null ? 'стоимость не указана' : money(o.deliveryPrice, store?.settings.currency)}</div>}
                {o.deliveryPrice != null && <div className="small"><b>С покупателя всего: {money(o.price + o.deliveryPrice, store?.settings.currency)}</b></div>}
                {o.shipment && <div className="small" style={{ marginTop: 8 }}><b>{deliveryLabel[o.deliveryMethod]} · {o.shipment.mode === 'manual' ? 'вручную' : o.shipment.mode === 'test' ? 'тест' : 'рабочая среда'}</b><div>Состояние: {o.shipment.mode === 'manual' ? 'трек-номер внесён продавцом' : o.shipment.state === 'created' ? 'накладная создана' : o.shipment.state === 'submitted' ? 'СДЭК обрабатывает запрос' : o.shipment.state === 'invalid' ? 'СДЭК отклонил накладную' : 'результат не подтверждён'}</div>{o.shipment.trackingNumber && <div>Трек-номер: {o.shipment.trackingNumber}</div>}{o.shipment.originPoint && <div>Пункт сдачи: {o.shipment.originPoint}</div>}{o.shipment.error && <div role="alert">{o.shipment.error}</div>}</div>}
                {o.refundConfirmedAt && <div className="small" style={{ marginTop: 8 }}>Возврат записан: {money(o.refundAmount ?? 0, store?.settings.currency)} · {dateShort(o.refundConfirmedAt)}. Подтверждение: {o.refundReference}</div>}
                {o.rejectionReason && <div className="small" style={{ marginTop: 8 }}>Причина отказа: {o.rejectionReason}</div>}
                {o.comment && <div className="small muted" style={{ marginTop: 4 }}>«{o.comment}»</div>}
              </div>

              {o.deliveryMethod === 'cdek' && o.deliveryTariff === 'Ручное оформление' && o.status === 'confirmed' && o.deliveryPrice == null && <div className="order-shipment"><strong>Согласуйте доставку</strong><p className="small muted">Уточните стоимость СДЭК с покупателем в чате. До сохранения цены реквизиты и загрузка чека ему недоступны.</p><div className="row"><div className="field grow"><label htmlFor={`manual-price-${o.id}`}>Стоимость доставки, {store?.settings.currency}</label><input id={`manual-price-${o.id}`} type="number" inputMode="decimal" min="0" max="100000" step="0.01" value={manualPrice[o.id] ?? ''} onChange={(e) => setManualPrice((prev) => ({ ...prev, [o.id]: e.target.value }))} /></div><button className="btn small" type="button" disabled={cdekBusy === o.id} onClick={() => saveManualPrice(o)}>Сообщить покупателю</button></div></div>}

              {o.deliveryMethod === 'cdek' && o.deliveryTariff === 'Ручное оформление' && o.status === 'confirmed' && o.paymentConfirmedAt && !o.shipment && <div className="order-shipment"><strong>Оформите СДЭК вручную</strong><p className="small muted">Создайте отправление в кабинете или отделении СДЭК. Затем внесите трек-номер; приложение само не создаёт накладную и QR-код.</p><div className="row"><div className="field grow"><label htmlFor={`manual-tracking-${o.id}`}>Трек-номер</label><input id={`manual-tracking-${o.id}`} value={manualTracking[o.id] ?? ''} maxLength={40} onChange={(e) => setManualTracking((prev) => ({ ...prev, [o.id]: e.target.value }))} /></div><button className="btn small" type="button" disabled={cdekBusy === o.id} onClick={() => saveManualTracking(o)}>Отправить трек-номер</button></div></div>}

              {['russian_post', 'yandex_delivery', 'dhl'].includes(o.deliveryMethod) && o.status === 'confirmed' && o.paymentConfirmedAt && !o.shipment && <div className="order-shipment"><strong>Оформите доставку вручную</strong><p className="small muted">После оформления у перевозчика внесите трек-номер. Приложение не создаёт отправление автоматически.</p><div className="row"><div className="field grow"><label htmlFor={`manual-tracking-${o.id}`}>Трек-номер</label><input id={`manual-tracking-${o.id}`} value={manualTracking[o.id] ?? ''} maxLength={40} onChange={(e) => setManualTracking((prev) => ({ ...prev, [o.id]: e.target.value }))} /></div><button className="btn small" type="button" disabled={cdekBusy === o.id} onClick={() => saveManualTracking(o)}>Сообщить трек</button></div></div>}

              {o.deliveryMethod === 'cdek' && o.deliveryTariff !== 'Ручное оформление' && o.status === 'confirmed' && o.paymentConfirmedAt && <div className="order-shipment">
                {!o.shipment && <><button className="btn small outline" disabled={cdekBusy === o.id} onClick={() => quoteShipment(o)}>{cdekBusy === o.id ? 'Считаем тариф…' : 'Рассчитать СДЭК'}</button>{cdekQuote?.orderId === o.id && <div className="order-shipment-quote"><strong>{cdekQuote.tariffName} · {money(cdekQuote.price, store?.settings.currency)}</strong><p className="small muted">{cdekQuote.periodMin && cdekQuote.periodMax ? `${cdekQuote.periodMin}–${cdekQuote.periodMax} дней · ` : ''}Сдача: {cdekQuote.originPoint} · {cdekQuote.mode === 'test' ? 'тестовая среда' : 'рабочая среда'}. Доставка оплачивается по договору продавца со СДЭК.</p><button className="btn small" disabled={cdekBusy === o.id} onClick={() => createShipment(o)}>Создать накладную</button></div>}</>}
                {o.shipment && o.shipment.state === 'submitted' && <button className="btn small outline" disabled={cdekBusy === o.id} onClick={() => checkShipment(o)}>{cdekBusy === o.id ? 'Проверяем…' : 'Проверить в СДЭК'}</button>}
              </div>}

              {['confirmed', 'sent', 'completed', 'cancelled'].includes(o.status) && <div className="order-payment">
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
                {(o.status === 'pending' || o.status === 'confirmed') && !o.paymentConfirmedAt && !o.receiptSubmittedAt && <button className="btn small danger" onClick={() => action(o, 'reject')}>Отклонить</button>}
                {o.status === 'confirmed' && o.paymentConfirmedAt && o.shipment?.state === 'created' && o.shipment.mode !== 'test' && o.shipment.trackingNumber && !['meetup', 'discuss'].includes(o.deliveryMethod) && <button className="btn small" onClick={() => action(o, 'send')}>Передано перевозчику</button>}
                {(o.status === 'sent' || (o.status === 'confirmed' && ['meetup', 'discuss'].includes(o.deliveryMethod))) && <button className="btn small" onClick={() => action(o, 'complete')} disabled={!o.paymentConfirmedAt}>Вручено покупателю</button>}
                {o.status === 'confirmed' && o.paymentConfirmedAt && !o.shipment && <button className="btn small outline" onClick={() => { setRefundId(o.id); setRefundReference(''); }}>Записать возврат</button>}
                {o.status === 'confirmed' && o.receiptSubmittedAt && !o.paymentConfirmedAt && <button className="btn small danger" onClick={() => { setPaymentRejectId(o.id); setPaymentRejectReason(''); }}>Платёж не поступил</button>}
              </div>
              {paymentRejectId === o.id && <div className="order-shipment"><strong>Платёж не подтверждён</strong><p className="small muted">Проверьте счёт и чек до закрытия заявки. Если деньги пришли, подтвердите оплату выше. При отказе покупатель увидит причину и сможет написать вам в чате.</p><div className="field"><label htmlFor={`reject-payment-${o.id}`}>Причина для покупателя</label><textarea id={`reject-payment-${o.id}`} value={paymentRejectReason} maxLength={500} onChange={(e) => setPaymentRejectReason(e.target.value)} /></div><div className="row"><button className="btn small danger" onClick={() => rejectPayment(o)}>Закрыть заявку</button><button className="btn small outline" onClick={() => setPaymentRejectId(null)}>Назад</button></div></div>}
              {refundId === o.id && <div className="order-shipment"><strong>Возврат всей суммы</strong><p className="small muted">Сначала переведите деньги покупателю вне приложения. После этого укажите номер операции или другое подтверждение; приложение только зафиксирует возврат.</p><div className="field"><label htmlFor={`refund-${o.id}`}>Подтверждение возврата</label><input id={`refund-${o.id}`} value={refundReference} maxLength={200} onChange={(e) => setRefundReference(e.target.value)} /></div><div className="row"><button className="btn small danger" onClick={() => recordRefund(o)}>Деньги возвращены</button><button className="btn small outline" onClick={() => setRefundId(null)}>Назад</button></div></div>}
            </div>
          ))}
          {hasMore && <button className="btn outline" disabled={loading} onClick={() => setPage((n) => n + 1)}>{loading ? 'Загружаем…' : 'Показать ещё'}</button>}
        </div>
      )}
    </div>
  );
}
