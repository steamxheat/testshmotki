import { lazy, Suspense, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useStore, useToast } from '../app/providers';
import { Empty, ErrorState, Loader, TopBar } from '../components/ui';
import { Icon } from '../components/Icon';
import { api, ApiError } from '../lib/api';
import { assetUrl } from '../lib/asset';
import { getCart, setCart, useCart, type CartItem } from '../lib/cart';
import { deliveryLabel, money } from '../lib/format';
import { getUser, haptic } from '../lib/telegram';
import type { DeliveryMethod, DeliveryOption, Product } from '../types';

const DeliveryMap = lazy(() => import('../components/DeliveryMap').then((m) => ({ default: m.DeliveryMap })));
const SHIPPING: DeliveryMethod[] = ['cdek', 'russian_post', 'yandex_delivery', 'dhl'];
type CdekCity = { code: number; city: string; region: string };
type CdekPoint = { code: string; name: string; address: string; city: string; cityCode: number; lat?: number; lon?: number };

export function Checkout() {
  const { productId } = useParams();
  const nav = useNavigate();
  const { store } = useStore();
  const toast = useToast();
  const cart = useCart();
  const [products, setProducts] = useState<Record<string, Product>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const tgUser = getUser();
  const [name, setName] = useState(tgUser.first_name ?? '');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [city, setCity] = useState(store?.city ?? '');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [delivery, setDelivery] = useState<DeliveryMethod>(store?.settings.deliveryMethods[0] ?? 'discuss');
  const [optionId, setOptionId] = useState('');
  const [cdekConnected, setCdekConnected] = useState<boolean | null>(null);
  const [cdekCityCode, setCdekCityCode] = useState<number | null>(null);
  const [cdekCities, setCdekCities] = useState<CdekCity[]>([]);
  const [cdekPoints, setCdekPoints] = useState<CdekPoint[]>([]);
  const [cdekPointCode, setCdekPointCode] = useState('');
  const [cdekLoading, setCdekLoading] = useState(false);
  const [cdekError, setCdekError] = useState('');
  const [cdekQuote, setCdekQuote] = useState<{ tariffCode: number; tariffName: string; price: number; periodMin?: number; periodMax?: number } | null>(null);
  const [cdekQuoteLoading, setCdekQuoteLoading] = useState(false);
  const [cdekQuoteReady, setCdekQuoteReady] = useState(false);
  const [cdekQuoteError, setCdekQuoteError] = useState('');
  const [comment, setComment] = useState('');
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ number: string } | null>(null);
  const [step, setStep] = useState(1);
  const ids = [...new Set(cart.map((i) => i.productId).concat(productId && !cart.length ? [productId] : []))].join(',');

  useEffect(() => {
    if (!ids) { setProducts({}); setLoading(false); return; }
    let active = true;
    setLoading(true);
    Promise.all(ids.split(',').map((id) => api.product(id))).then((results) => {
      if (active) { setProducts(Object.fromEntries(results.map((r) => [r.product.id, r.product]))); setLoadError(null); }
    }).catch((e) => { if (active) setLoadError(e instanceof ApiError ? e.message : 'Не удалось проверить корзину'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [ids, retry]);

  const lines: CartItem[] = cart.length ? cart : productId && products[productId] ? [{ productId, variantId: products[productId].variants.find((v) => v.available > 0)?.id ?? '', quantity: 1 }] : [];
  const invalid = lines.some((line) => {
    const p = products[line.productId];
    return !p?.isAvailable || (p.variants.find((v) => v.id === line.variantId)?.available ?? 0) < line.quantity;
  });
  const shipping = SHIPPING.includes(delivery);
  const options = useMemo(() => store?.settings.deliveryOptions.filter((o) => delivery !== 'cdek' && o.method === delivery && o.city.toLocaleLowerCase('ru-RU') === city.trim().toLocaleLowerCase('ru-RU')) ?? [], [store, delivery, city]);
  const points = useMemo(() => options.filter((o, i, all) => all.findIndex((item) => item.point === o.point && item.address === o.address) === i), [options]);
  const cities = [...new Set(store?.settings.deliveryOptions.filter((o) => o.method === delivery).map((o) => o.city) ?? [])];
  const option = options.find((o) => o.id === optionId);
  const cdekPoint = cdekPoints.find((point) => point.code === cdekPointCode);
  const mappedCdekPoints = useMemo(() => cdekPoints.map((point) => ({ id: point.code, method: 'cdek' as const, city, point: point.name, address: point.address, tariff: '', price: 0, lat: point.lat, lon: point.lon })), [cdekPoints, city]);
  const selectedPoint = option && points.find((point) => point.point === option.point && point.address === option.address);
  const tariffs = selectedPoint ? options.filter((item) => item.point === selectedPoint.point && item.address === selectedPoint.address) : [];
  const productsTotal = lines.reduce((sum, item) => sum + (products[item.productId]?.price ?? 0) * item.quantity, 0);
  const methods: DeliveryMethod[] = store?.settings.deliveryMethods.length ? store.settings.deliveryMethods : ['discuss'];

  useEffect(() => {
    if (store && !store.settings.deliveryMethods.includes(delivery)) setDelivery(store.settings.deliveryMethods[0] ?? 'discuss');
  }, [store, delivery]);

  useEffect(() => {
    if (delivery !== 'cdek') return;
    let active = true;
    api.cdekStatus().then(({ connected }) => { if (active) setCdekConnected(connected); })
      .catch(() => { if (active) setCdekConnected(false); });
    return () => { active = false; };
  }, [delivery]);

  useEffect(() => {
    if (delivery !== 'cdek' || !cdekConnected || cdekCityCode || city.trim().length < 2) { setCdekCities([]); return; }
    let active = true;
    const timer = window.setTimeout(() => {
      setCdekLoading(true);
      api.cdekCities(city).then(({ cities }) => { if (active) { setCdekCities(cities); setCdekError(''); } })
        .catch(() => { if (active) setCdekError('Не удалось получить города СДЭК. Попробуйте ещё раз или укажите ПВЗ вручную.'); })
        .finally(() => { if (active) setCdekLoading(false); });
    }, 350);
    return () => { active = false; window.clearTimeout(timer); };
  }, [delivery, cdekConnected, cdekCityCode, city]);

  useEffect(() => {
    if (delivery !== 'cdek' || !cdekCityCode) return;
    let active = true;
    setCdekLoading(true);
    api.cdekPoints(cdekCityCode).then(({ points }) => { if (active) { setCdekPoints(points); setCdekError(''); } })
      .catch(() => { if (active) setCdekError('Не удалось получить ПВЗ СДЭК. Попробуйте ещё раз или укажите ПВЗ вручную.'); })
      .finally(() => { if (active) setCdekLoading(false); });
    return () => { active = false; };
  }, [delivery, cdekCityCode, retry]);

  useEffect(() => {
    if (delivery !== 'cdek' || !cdekCityCode || !cdekPointCode) { setCdekQuote(null); setCdekQuoteReady(false); setCdekQuoteError(''); return; }
    let active = true;
    setCdekQuote(null); setCdekQuoteReady(false); setCdekQuoteLoading(true); setCdekQuoteError('');
    api.cdekQuote(cdekCityCode, cdekPointCode).then(({ available, quote }) => {
      if (active) { setCdekQuote(available ? quote ?? null : null); setCdekQuoteReady(true); }
    }).catch((e) => { if (active) setCdekQuoteError(e instanceof ApiError ? e.message : 'Не удалось рассчитать доставку СДЭК'); })
      .finally(() => { if (active) setCdekQuoteLoading(false); });
    return () => { active = false; };
  }, [delivery, cdekCityCode, cdekPointCode, retry]);

  function selectPoint(point: DeliveryOption) {
    const first = options.find((item) => item.point === point.point && item.address === point.address);
    setOptionId(first?.id ?? '');
  }

  function selectCdekPoint(code: string) {
    setCdekPointCode(code);
    setDeliveryAddress('');
  }

  function next(e: FormEvent) {
    e.preventDefault();
    if (step === 1) { setStep(2); return; }
    if (step === 2) {
      if (shipping && !city.trim()) { toast('Укажите город доставки'); return; }
      if (shipping && !optionId && !cdekPointCode && !deliveryAddress.trim()) { toast('Выберите пункт или укажите адрес'); return; }
      if (delivery === 'cdek' && cdekPointCode && (cdekQuoteLoading || (!cdekQuoteReady && !cdekQuoteError))) { toast('Дождитесь расчёта доставки'); return; }
      if (delivery === 'cdek' && cdekPointCode && cdekQuoteError) { toast('Не удалось рассчитать СДЭК. Повторите запрос или укажите ПВЗ вручную'); return; }
      setStep(3);
      return;
    }
    void submit();
  }

  async function submit() {
    if (!consent || submitting || invalid || !lines.length || !name.trim() || !phone.trim() || !email.trim()) return;
    setSubmitting(true);
    try {
      const r = await api.createOrder({
        items: lines, buyerName: name.trim(), buyerPhone: phone.trim() || undefined,
        buyerEmail: email.trim() || undefined, city: city.trim() || undefined,
        deliveryAddress: option || cdekPoint ? undefined : deliveryAddress.trim() || undefined,
        deliveryOptionId: option?.id, deliveryMethod: delivery,
        deliveryCityCode: cdekPoint?.cityCode, deliveryPointCode: cdekPoint?.code,
        expectedDeliveryPrice: cdekQuote?.price, expectedTariffCode: cdekQuote?.tariffCode,
        comment: comment.trim() || undefined, consent: true,
      });
      if (cart.length) setCart(getCart().filter((i) => !lines.some((line) => line.variantId === i.variantId)));
      haptic('success');
      setDone({ number: r.order.publicNumber });
    } catch (err) {
      haptic('error');
      toast(err instanceof ApiError ? err.message : 'Не удалось отправить заявку');
      if (err instanceof ApiError && ['unavailable', 'out_of_stock', 'already_requested', 'delivery_price_changed'].includes(err.code)) { setRetry((n) => n + 1); if (err.code === 'delivery_price_changed') setStep(2); }
    } finally { setSubmitting(false); }
  }

  if (loading) return <div className="page"><Loader text="Проверяем корзину…" /></div>;
  if (loadError) return <div className="page"><TopBar title="Оформление" fallback="/cart" /><ErrorState message={loadError} onRetry={() => setRetry((n) => n + 1)} /></div>;
  if (done) return <div className="page"><Empty icon="check" title={`Заявка №${done.number} отправлена`} hint="Вещи забронированы. Продавец получит заявку и подтвердит её вручную." action={<div className="checkout-success-actions"><button className="btn" onClick={() => nav('/orders')}>Мои заказы</button><button className="btn secondary" onClick={() => nav('/chat')}><Icon name="chat" size={18} />Чат с продавцом</button></div>} /></div>;
  if (!lines.length) return <div className="page"><TopBar title="Оформление" fallback="/cart" /><Empty icon="cart" title="Корзина пуста" action={<Link className="btn small" to="/catalog">В каталог</Link>} /></div>;
  if (!store?.settings.privacyUrl?.startsWith('https://') || !store.settings.termsUrl?.startsWith('https://')) {
    return <div className="page"><TopBar title="Оформление" fallback="/cart" /><Empty icon="lock" title="Оформление пока недоступно" hint="Продавец ещё не добавил документы магазина. Напишите ему в чате или попробуйте позже." action={<Link className="btn" to="/chat">Написать продавцу</Link>} /></div>;
  }
  if (invalid) return <div className="page"><TopBar title="Оформление" fallback="/cart" /><Empty icon="unavailable" title="Наличие изменилось" hint="Вернитесь в корзину и проверьте размеры и количество." action={<Link className="btn small" to="/cart">Проверить корзину</Link>} /></div>;

  return <div className="page checkout-page">
    <TopBar title="Оформление заявки" fallback="/cart" />
    <nav className="checkout-steps" aria-label="Этапы оформления">{['Контакты', 'Получение', 'Проверка'].map((label, index) => <span key={label} className={step === index + 1 ? 'active' : step > index + 1 ? 'complete' : ''}><b>{index + 1}</b>{label}</span>)}</nav>
    <form onSubmit={next}>
      {step === 1 && <section className="checkout-panel"><h2>Контактная информация</h2><p className="small muted">Продавец свяжется с вами по заявке. Оплата появится только после подтверждения.</p>
        <div className="field"><label htmlFor="checkout-name">ФИО *</label><input id="checkout-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} autoComplete="name" /></div>
        <div className="field"><label htmlFor="checkout-phone">Телефон *</label><input id="checkout-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required maxLength={32} autoComplete="tel" placeholder="+7…" /></div>
        <div className="field"><label htmlFor="checkout-email">Почта *</label><input id="checkout-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={200} autoComplete="email" /></div>
      </section>}
      {step === 2 && <section className="checkout-panel"><h2>Способ получения</h2><p className="small muted">Выберите доступный вариант для этого магазина.</p>
        <div className="checkout-methods" role="group" aria-label="Способ получения">{methods.map((method) => <button type="button" key={method} className={`checkout-method ${delivery === method ? 'active' : ''}`} aria-pressed={delivery === method} onClick={() => { setDelivery(method); setOptionId(''); setCdekPointCode(''); }}><Icon name={method === 'meetup' ? 'location' : method === 'discuss' ? 'chat' : 'package'} size={19} />{deliveryLabel[method]}</button>)}</div>
        {(shipping || delivery === 'meetup') && <div className="field"><label htmlFor="checkout-city">Город{shipping ? ' *' : ''}</label><input id="checkout-city" value={city} onChange={(e) => { setCity(e.target.value); setOptionId(''); setCdekCityCode(null); setCdekPointCode(''); setCdekPoints([]); }} required={shipping} list={delivery === 'cdek' ? undefined : 'delivery-cities'} maxLength={100} autoComplete="address-level2" placeholder="Например, Москва" /><datalist id="delivery-cities">{cities.map((name) => <option key={name} value={name} />)}</datalist></div>}
        {delivery === 'cdek' && cdekConnected && !cdekCityCode && cdekCities.length > 0 && <div className="checkout-city-results" role="group" aria-label="Города СДЭК">{cdekCities.map((item) => <button type="button" key={item.code} className="checkout-city-result" onClick={() => { setCity(item.city); setCdekCityCode(item.code); setCdekCities([]); setCdekPointCode(''); setDeliveryAddress(''); }}>{item.city}{item.region ? <small>{item.region}</small> : null}</button>)}</div>}
        {delivery === 'cdek' && cdekLoading && <p className="small muted" role="status">Загружаем пункты СДЭК…</p>}
        {delivery === 'cdek' && cdekError && <p className="checkout-no-points small" role="alert">{cdekError} <button className="text-action" type="button" onClick={() => setRetry((n) => n + 1)}>Повторить</button></p>}
        {delivery === 'cdek' && cdekConnected === false && <p className="checkout-no-points small">Онлайн-список СДЭК пока не подключён. Укажите желаемый ПВЗ ниже — продавец уточнит оформление и стоимость.</p>}
        {delivery === 'cdek' && cdekCityCode && !cdekLoading && !cdekError && !cdekPoints.length && <p className="checkout-no-points small">В выбранном городе СДЭК не вернул доступные ПВЗ. Укажите нужный пункт вручную.</p>}
        {shipping && delivery !== 'cdek' && city.trim() && !points.length && <p className="checkout-no-points small">В {city.trim()} продавец пока не добавил пункты выдачи. Укажите желаемый адрес или ПВЗ ниже — продавец уточнит возможность и стоимость.</p>}
        {delivery === 'cdek' && cdekPoints.length > 0 && <div className="checkout-pickup"><div className="checkout-pickup-title"><strong>ПВЗ СДЭК</strong><small>{cdekPoints.length} точек в городе</small></div>
          {mappedCdekPoints.some((point) => point.lat != null && point.lon != null) && <Suspense fallback={<div className="delivery-map-placeholder">Загружаем карту…</div>}><DeliveryMap points={mappedCdekPoints} selectedId={cdekPointCode} onSelect={selectCdekPoint} /></Suspense>}
          {cdekPoint && <div className="checkout-selected-point" role="status"><Icon name="check" size={19} /><span><strong>ПВЗ выбран: {cdekPoint.name}</strong><small>{cdekPoint.address}</small></span></div>}
          {cdekPoint && <div className="small" role="status" style={{ padding: '10px 2px' }}>{cdekQuoteLoading ? 'Рассчитываем доставку СДЭК…' : cdekQuote ? `${cdekQuote.tariffName} · ${money(cdekQuote.price)}${cdekQuote.periodMin && cdekQuote.periodMax ? ` · ${cdekQuote.periodMin}–${cdekQuote.periodMax} дней` : ''}` : cdekQuoteError ? <>{cdekQuoteError} <button className="text-action" type="button" onClick={() => setRetry((n) => n + 1)}>Повторить</button></> : 'Стоимость уточнит продавец'}</div>}
          <div className="checkout-point-list">{cdekPoints.map((point) => <button type="button" key={point.code} className={`checkout-point ${cdekPointCode === point.code ? 'active' : ''}`} onClick={() => selectCdekPoint(point.code)} aria-pressed={cdekPointCode === point.code}><span className="checkout-point-icon"><Icon name="location" size={19} /></span><span><strong>{point.name}</strong><small>{point.address}</small><small>Код {point.code}</small></span><Icon name="chevronRight" size={17} /></button>)}</div>
        </div>}
        {delivery !== 'cdek' && city.trim() && points.length > 0 && <div className="checkout-pickup"><div className="checkout-pickup-title"><strong>{delivery === 'meetup' ? 'Места встречи' : 'Пункты выдачи'}</strong><small>{points.length} точек в городе</small></div>
          {points.some((point) => point.lat != null && point.lon != null) && <Suspense fallback={<div className="delivery-map-placeholder">Загружаем карту…</div>}><DeliveryMap points={points} selectedId={selectedPoint?.id} onSelect={(id) => { const point = points.find((item) => item.id === id); if (point) selectPoint(point); }} /></Suspense>}
          <div className="checkout-point-list">{points.map((point) => <button type="button" key={point.id} className={`checkout-point ${selectedPoint?.id === point.id ? 'active' : ''}`} onClick={() => selectPoint(point)} aria-pressed={selectedPoint?.id === point.id}><span className="checkout-point-icon"><Icon name="location" size={19} /></span><span><strong>{point.point}</strong><small>{point.address}</small><small>от {money(Math.min(...options.filter((item) => item.point === point.point && item.address === point.address).map((item) => item.price)))}</small></span><Icon name="chevronRight" size={17} /></button>)}</div>
          {selectedPoint && <fieldset className="checkout-tariffs"><legend>Тариф для «{selectedPoint.point}»</legend>{tariffs.map((item) => <label key={item.id} className={optionId === item.id ? 'active' : ''}><input type="radio" name="delivery-tariff" checked={optionId === item.id} onChange={() => setOptionId(item.id)} /><span><strong>{item.tariff}</strong>{item.eta && <small>{item.eta}</small>}</span><b>{money(item.price)}</b></label>)}</fieldset>}
        </div>}
        {shipping && <div className="checkout-manual"><button type="button" className="text-action" onClick={() => { setOptionId(''); setCdekPointCode(''); }}>Указать другой адрес или ПВЗ</button>{!optionId && !cdekPointCode && <div className="field"><label htmlFor="checkout-address">Адрес или желаемый ПВЗ *</label><input id="checkout-address" value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} required maxLength={300} autoComplete="street-address" placeholder={delivery === 'cdek' ? 'Адрес или код ПВЗ СДЭК' : 'Город, улица, дом или название пункта'} /></div>}</div>}
        {delivery === 'meetup' && !optionId && <p className="small muted">Место и время встречи согласуете с продавцом после подтверждения.</p>}
        {shipping && <p className="small muted">{delivery === 'cdek' ? 'Если магазин подключил СДЭК, цена рассчитана по типовой упаковке и сохраняется в заявке. Продавец создаст накладную после подтверждения оплаты; сдача и оплата перевозчику идут по его договору.' : 'Точки, сроки и цены добавлены продавцом вручную. Это не онлайн-расчёт и не бронь у перевозчика.'}</p>}
      </section>}
      {step === 3 && <section className="checkout-panel"><h2>Проверьте заявку</h2><div className="checkout-review"><span>Покупатель</span><strong>{name} · {phone}</strong><span>Получение</span><strong>{deliveryLabel[delivery]}{cdekPoint ? ` · ${cdekPoint.name}, ${cdekPoint.address}` : option ? ` · ${option.point}` : deliveryAddress ? ` · ${deliveryAddress}` : ''}</strong>{(option || cdekQuote) && <><span>Тариф</span><strong>{option?.tariff ?? cdekQuote?.tariffName}{option?.eta ? ` · ${option.eta}` : cdekQuote?.periodMin && cdekQuote?.periodMax ? ` · ${cdekQuote.periodMin}–${cdekQuote.periodMax} дней` : ''}</strong></>}</div>
        <div className="field"><label htmlFor="checkout-comment">Комментарий продавцу</label><textarea id="checkout-comment" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} placeholder="Пожелания или вопросы" /></div>
      </section>}
      <section className="checkout-summary"><h2>Ваш заказ</h2><div className="checkout-lines">{lines.map((line) => { const p = products[line.productId]; const v = p.variants.find((item) => item.id === line.variantId); return <div key={line.variantId} className="checkout-line">{p.coverUrl && <img className="thumb" src={assetUrl(p.coverUrl)} alt="" />}<div className="grow"><strong>{p.title}</strong><div className="small muted">Размер {v?.size} · {line.quantity} шт.</div></div><b>{money(p.price * line.quantity)}</b></div>; })}</div>
        <div className="checkout-total"><span>Товары</span><b>{money(productsTotal)}</b></div><div className="checkout-total"><span>Доставка</span><b>{option || cdekQuote ? money(option?.price ?? cdekQuote!.price) : 'Уточнит продавец'}</b></div>{(option || cdekQuote) && <div className="checkout-total final"><span>Предварительно всего</span><b>{money(productsTotal + (option?.price ?? cdekQuote!.price))}</b></div>}
      </section>
      {step === 3 && <label className="checkbox checkout-consent"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /><span className="small">Согласен передать указанные данные продавцу для обработки заявки.{store?.settings.privacyUrl && <> <a href={store.settings.privacyUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>Политика конфиденциальности</a>.</>}{store?.settings.termsUrl && <> <a href={store.settings.termsUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>Соглашение</a>.</>}</span></label>}
      <div className="checkout-actions">{step > 1 && <button type="button" className="btn outline" onClick={() => setStep(step - 1)}>Назад</button>}<button className="btn" type="submit" disabled={step === 3 && (!consent || submitting)}>{step === 3 ? submitting ? 'Отправляем…' : 'Отправить заявку' : 'Продолжить'}</button></div>
    </form>
  </div>;
}
