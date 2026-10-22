import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

const prisma = new PrismaClient();
const base = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:4050';
const marker = `smoke-${Date.now()}`;
const buyerTelegramId = BigInt(9_000_000_000_000 + crypto.randomInt(1_000_000_000));
let store;
let buyer;
let otherBuyer;
let otherStore;
let previousSettings;
const productIds = [];
const chatMediaFiles = [];
const uploadedFiles = [];
const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ffffff' } }).png().toBuffer();

function auth(id, name) {
  return Buffer.from(JSON.stringify({ id: String(id), first_name: name })).toString('base64');
}

async function call(path, userId, name, method = 'GET', body) {
  const res = await fetch(`${base}${path}?store=${store.slug}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Dev-User': auth(userId, name), 'X-Store-Slug': store.slug },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  return { status: res.status, data };
}

try {
  store = await prisma.store.findFirst({ where: { status: 'active' }, include: { members: { where: { role: 'owner' }, include: { user: true }, take: 1 } } });
  assert(store?.members[0], 'Нужен магазин с владельцем');
  previousSettings = store.settings;
  await prisma.store.update({ where: { id: store.id }, data: { settings: { ...store.settings, deliveryMethods: ['meetup', 'cdek', 'yandex_delivery'], paymentDetails: 'СБП +79990000000, Тестовый получатель', deliveryOptions: [{ id: 'smoke_point', method: 'cdek', city: 'Москва', point: 'Тестовый ПВЗ', address: 'Тверская, 1', tariff: 'Стандарт', price: 450, eta: '3–5 дней', lat: 55.758, lon: 37.613 }, { id: 'smoke_yandex', method: 'yandex_delivery', city: 'Москва', point: 'Тестовый пункт Яндекс', address: 'Арбат, 1', tariff: 'Стандарт', price: 350, eta: '2–3 дня', lat: 55.752, lon: 37.592 }] } } });
  const ownerId = store.members[0].user.telegramId;
  const ownerName = store.members[0].user.firstName ?? 'Продавец';
  const settingsResponse = await call(`/api/admin/${store.id}/settings`, ownerId, ownerName, 'PATCH', { settings: { deliveryMethods: ['meetup', 'cdek', 'yandex_delivery'], privacyUrl: 'https://example.org/privacy', termsUrl: 'https://example.org/terms', legalName: 'Тестовый продавец', legalInn: '123456789012', legalAddress: 'Москва, Тверская, 1', legalEmail: 'seller@example.org', deliveryOptions: [{ id: 'smoke_point', method: 'cdek', city: 'Москва', point: 'Тестовый ПВЗ', address: 'Тверская, 1', tariff: 'Стандарт', price: 450, lat: 55.758, lon: 37.613 }, { id: 'smoke_yandex', method: 'yandex_delivery', city: 'Москва', point: 'Тестовый пункт Яндекс', address: 'Арбат, 1', tariff: 'Стандарт', price: 350, lat: 55.752, lon: 37.592 }] } });
  assert.equal(settingsResponse.status, 200, JSON.stringify(settingsResponse.data));
  assert.equal(settingsResponse.data.store.settings.deliveryOptions[1].lat, 55.752);
  buyer = await prisma.user.create({ data: { telegramId: buyerTelegramId, firstName: marker } });
  otherBuyer = await prisma.user.create({ data: { telegramId: buyerTelegramId + 1n, firstName: `${marker}-other` } });
  assert.equal((await call('/api/store', buyerTelegramId, marker)).data.store.settings.privacyUrl, 'https://example.org/privacy');

  const firstProduct = await prisma.product.create({ data: { storeId: store.id, title: `${marker} встреча`, priceAmount: 10000, condition: 'good', status: 'published', publishedAt: new Date(), variants: { create: [{ size: 'M', stockQuantity: 2 }, { size: 'L', stockQuantity: 1 }] } }, include: { variants: true } });
  productIds.push(firstProduct.id);
  const secondProduct = await prisma.product.create({ data: { storeId: store.id, title: `${marker} второй товар`, priceAmount: 11000, condition: 'good', status: 'published', publishedAt: new Date(), variants: { create: { size: 'Единый размер', stockQuantity: 1 } } }, include: { variants: true } });
  productIds.push(secondProduct.id);
  const uploadForm = () => {
    const form = new FormData();
    form.append('files', new Blob([png], { type: 'image/png' }), 'photo.png');
    return form;
  };
  const storeUpload = await fetch(`${base}/api/uploads?store=${store.slug}&purpose=store`, { method: 'POST', headers: { 'X-Dev-User': auth(buyerTelegramId, marker) }, body: uploadForm() });
  assert.equal(storeUpload.status, 403, 'Покупатель не может загружать фото товара');
  const earlyReviewUpload = await fetch(`${base}/api/uploads?store=${store.slug}&purpose=review&orderId=missing`, { method: 'POST', headers: { 'X-Dev-User': auth(buyerTelegramId, marker) }, body: uploadForm() });
  assert.equal(earlyReviewUpload.status, 403, 'Фото отзыва доступны только после завершённой сделки');

  const sent = await call('/api/chat', buyerTelegramId, marker, 'POST', { text: 'Здравствуйте, можно посмотреть вещь?', productId: firstProduct.id });
  assert.equal(sent.status, 201, JSON.stringify(sent.data));
  const threads = await call(`/api/admin/${store.id}/chats`, ownerId, ownerName);
  assert.equal(threads.status, 200);
  assert(threads.data.items.some((item) => item.buyer.id === buyer.id), 'Продавец не видит диалог');
  const sellerChat = await call(`/api/admin/${store.id}/chats/${buyer.id}`, ownerId, ownerName);
  assert.equal(sellerChat.data.items[0].text, 'Здравствуйте, можно посмотреть вещь?');
  assert.equal(sellerChat.data.items[0].product.id, firstProduct.id);
  const reply = await call(`/api/admin/${store.id}/chats/${buyer.id}`, ownerId, ownerName, 'POST', { text: 'Да, договоримся о встрече.' });
  assert.equal(reply.status, 201, JSON.stringify(reply.data));
  const buyerChat = await call('/api/chat', buyerTelegramId, marker);
  assert.equal(buyerChat.data.items.length, 2);
  assert.equal(buyerChat.data.items[1].text, 'Да, договоримся о встрече.');
  const photoForm = new FormData();
  photoForm.append('file', new Blob([png], { type: 'image/png' }), 'photo.png');
  const photoUploadResponse = await fetch(`${base}/api/chat/media?store=${store.slug}`, { method: 'POST', headers: { 'X-Dev-User': auth(buyerTelegramId, marker) }, body: photoForm });
  const photoUpload = await photoUploadResponse.json();
  assert.equal(photoUploadResponse.status, 201, JSON.stringify(photoUpload));
  chatMediaFiles.push(path.resolve(process.cwd(), '../.runtime/chat-media', path.basename(photoUpload.url)));
  const photo = await call('/api/chat', buyerTelegramId, marker, 'POST', { text: '', productId: firstProduct.id, mediaUrl: photoUpload.url, mediaType: 'image' });
  assert.equal(photo.status, 201, JSON.stringify(photo.data));
  const sellerMedia = await call(`/api/admin/${store.id}/chats/${buyer.id}`, ownerId, ownerName);
  assert.equal(sellerMedia.data.items.at(-1).mediaUrl, photoUpload.url);
  const ownerFile = await fetch(`${base}/api/chat/media/${photo.data.id}?store=${store.slug}`, { headers: { 'X-Dev-User': auth(ownerId, ownerName) } });
  assert.equal(ownerFile.status, 200, 'Продавец видит фото покупателя');
  const strangerFile = await fetch(`${base}/api/chat/media/${photo.data.id}?store=${store.slug}`, { headers: { 'X-Dev-User': auth(otherBuyer.telegramId, otherBuyer.firstName) } });
  assert.equal(strangerFile.status, 404, 'Чужой покупатель не видит фото');
  const publicFile = await fetch(`${base}${photoUpload.url}`);
  assert.notEqual(publicFile.status, 200, 'Приватное фото не отдается публично');
  const legacyName = `smoke-${Date.now()}.webp`;
  const legacyFile = path.resolve(process.cwd(), 'uploads', legacyName);
  await fs.copyFile(path.resolve(process.cwd(), '../.runtime/chat-media', path.basename(photoUpload.url)), legacyFile);
  chatMediaFiles.push(legacyFile);
  const legacyMessage = await prisma.chatMessage.create({ data: { threadId: (await prisma.chatThread.findUniqueOrThrow({ where: { storeId_buyerId: { storeId: store.id, buyerId: buyer.id } } })).id, senderId: buyer.id, text: '', mediaUrl: `/uploads/${legacyName}`, mediaType: 'image' } });
  assert.equal((await fetch(`${base}/uploads/${legacyName}`)).status, 404, 'Старое вложение чата не должно быть публичным');
  assert.equal((await fetch(`${base}/uploads/${legacyName.replace('s', '%73')}`)).status, 404, 'Кодирование URL не должно обходить защиту вложения');
  assert.equal((await fetch(`${base}/api/chat/media/${legacyMessage.id}?store=${store.slug}`, { headers: { 'X-Dev-User': auth(ownerId, ownerName) } })).status, 200);
  const invalidMedia = await call('/api/chat', buyerTelegramId, marker, 'POST', { text: '', mediaUrl: '/chat-media/not-a-video.webp', mediaType: 'video' });
  assert.equal(invalidMedia.status, 400);

  otherStore = await prisma.store.create({ data: { slug: `smoke_${Date.now()}`, name: marker } });
  const foreignProduct = await prisma.product.create({ data: { storeId: otherStore.id, title: `${marker} другой магазин`, priceAmount: 10000, condition: 'good', status: 'published' } });
  await prisma.favorite.create({ data: { userId: buyer.id, productId: foreignProduct.id } });
  const scopedFavorites = await call('/api/favorites', buyerTelegramId, marker);
  assert.equal(scopedFavorites.status, 200);
  assert.equal(scopedFavorites.data.items.length, 0, 'Избранное другого магазина не должно появляться');
  const foreignFavorite = await call(`/api/favorites/${foreignProduct.id}`, buyerTelegramId, marker, 'POST');
  assert.equal(foreignFavorite.status, 404);

  const submit = (items) => call('/api/orders', buyerTelegramId, marker, 'POST', {
    items, buyerName: marker, deliveryMethod: 'meetup', city: 'Москва', consent: true, termsAccepted: true,
  });
  const firstLines = [{ productId: firstProduct.id, variantId: firstProduct.variants.find((v) => v.size === 'M').id, quantity: 2 }, { productId: secondProduct.id, variantId: secondProduct.variants[0].id, quantity: 1 }];
  const legalSettings = (await prisma.store.findUniqueOrThrow({ where: { id: store.id } })).settings;
  await prisma.store.update({ where: { id: store.id }, data: { settings: { ...legalSettings, legalName: null } } });
  const notice = await call('/api/store/legal-notice', buyerTelegramId, marker, 'POST', { decision: 'accepted' });
  assert.equal(notice.status, 200, 'Согласие доступно без реквизитов продавца');
  assert.equal(notice.data.decision, 'accepted');
  const first = await submit(firstLines);
  assert.equal(first.status, 201, 'Заявка с согласием доступна без реквизитов продавца');
  await prisma.store.update({ where: { id: store.id }, data: { settings: legalSettings } });
  assert((await prisma.order.findUniqueOrThrow({ where: { id: first.data.order.id } })).termsAcceptedAt, 'Принятие условий записано в заказ');
  assert.equal(first.data.order.status, 'pending');
  assert.equal(first.data.order.items.length, 2);
  assert.equal(first.data.order.price, 310);
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: firstProduct.id } })).status, 'published', 'Другой размер остаётся доступным');
  assert.equal((await call(`/api/admin/${store.id}/products/${firstProduct.id}/archive`, ownerId, ownerName, 'POST')).status, 409, 'Нельзя скрыть товар с активной бронью, даже если другой размер свободен');
  assert.equal((await call(`/api/admin/${store.id}/products/bulk-archive`, ownerId, ownerName, 'POST', { ids: [firstProduct.id] })).data.archived, 0);
  const duplicate = await submit(firstLines);
  assert.equal(duplicate.status, 409, 'Повторная заявка должна быть отклонена');
  const sellerOrders = await call(`/api/admin/${store.id}/orders`, ownerId, ownerName);
  assert(sellerOrders.data.items.some((order) => order.id === first.data.order.id && order.deliveryMethod === 'meetup'), 'Продавец не получил заявку');
  const accepted = await call(`/api/admin/${store.id}/orders/${first.data.order.id}/accept`, ownerId, ownerName, 'POST');
  assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
  const buyerOrders = await call('/api/orders', buyerTelegramId, marker);
  assert(buyerOrders.data.items.some((order) => order.id === first.data.order.id && order.status === 'confirmed'), 'Покупатель не видит подтверждение');
  assert(buyerOrders.data.items.find((order) => order.id === first.data.order.id).paymentDetails.includes('СБП'));
  assert.equal((await call(`/api/admin/${store.id}/orders/${first.data.order.id}/complete`, ownerId, ownerName, 'POST')).status, 400, 'Нельзя завершить без подтверждения оплаты');
  const receiptForm = new FormData();
  receiptForm.append('file', new Blob(['%PDF-1.4\n% smoke test'], { type: 'application/pdf' }), 'receipt.pdf');
  const receiptResponse = await fetch(`${base}/api/orders/${first.data.order.id}/receipt?store=${store.slug}`, { method: 'POST', headers: { 'X-Dev-User': auth(buyerTelegramId, marker) }, body: receiptForm });
  assert.equal(receiptResponse.status, 200, await receiptResponse.text());
  const receiptDownload = await fetch(`${base}/api/orders/${first.data.order.id}/receipt?store=${store.slug}`, { headers: { 'X-Dev-User': auth(ownerId, ownerName) } });
  assert.equal(receiptDownload.status, 200);
  assert.equal(receiptDownload.headers.get('content-type'), 'application/pdf');
  const deniedReceipt = await fetch(`${base}/api/orders/${first.data.order.id}/receipt?store=${store.slug}`, { headers: { 'X-Dev-User': auth(otherBuyer.telegramId, otherBuyer.firstName) } });
  assert.equal(deniedReceipt.status, 404, 'Чужой чек недоступен');
  await prisma.storeMember.create({ data: { storeId: store.id, userId: otherBuyer.id, role: 'manager' } });
  assert.equal((await call(`/api/admin/${store.id}/settings`, otherBuyer.telegramId, otherBuyer.firstName)).status, 403, 'Менеджер не видит реквизиты');
  assert.equal((await call(`/api/admin/${store.id}/settings`, otherBuyer.telegramId, otherBuyer.firstName, 'PATCH', { settings: { paymentDetails: 'подмена' } })).status, 403, 'Менеджер не может менять реквизиты');
  const paid = await call(`/api/admin/${store.id}/orders/${first.data.order.id}/payment-confirm`, ownerId, ownerName, 'POST');
  assert.equal(paid.status, 200, JSON.stringify(paid.data));
  const completed = await call(`/api/admin/${store.id}/orders/${first.data.order.id}/complete`, ownerId, ownerName, 'POST');
  assert.equal(completed.status, 200, JSON.stringify(completed.data));
  const reviewUploadResponse = await fetch(`${base}/api/uploads?store=${store.slug}&purpose=review&orderId=${first.data.order.id}`, { method: 'POST', headers: { 'X-Dev-User': auth(buyerTelegramId, marker) }, body: uploadForm() });
  const reviewUpload = await reviewUploadResponse.json();
  assert.equal(reviewUploadResponse.status, 200, JSON.stringify(reviewUpload));
  for (const url of [...reviewUpload.urls, ...reviewUpload.thumbs]) uploadedFiles.push(path.resolve(process.cwd(), 'uploads', path.basename(url)));
  assert.equal((await prisma.productVariant.findUniqueOrThrow({ where: { id: firstLines[0].variantId } })).soldQuantity, 2);
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: secondProduct.id } })).status, 'sold');
  const lastSize = firstProduct.variants.find((v) => v.size === 'L');
  const oneLeft = { items: [{ productId: firstProduct.id, variantId: lastSize.id, quantity: 1 }], buyerName: marker, deliveryMethod: 'meetup', city: 'Москва', consent: true, termsAccepted: true };
  const races = await Promise.all([
    call('/api/orders', buyerTelegramId, marker, 'POST', oneLeft),
    call('/api/orders', otherBuyer.telegramId, otherBuyer.firstName, 'POST', oneLeft),
  ]);
  assert.deepEqual(races.map((r) => r.status).sort(), [201, 409], 'Последний размер нельзя продать дважды');
  const raceWinner = races.find((r) => r.status === 201).data.order;
  assert.equal((await call(`/api/admin/${store.id}/orders/${raceWinner.id}/reject`, ownerId, ownerName, 'POST')).status, 200);
  assert.equal((await prisma.productVariant.findUniqueOrThrow({ where: { id: lastSize.id } })).reservedQuantity, 0, 'Отказ возвращает остаток');
  const review = await call('/api/reviews', buyerTelegramId, marker, 'POST', { orderId: first.data.order.id, rating: 5, text: 'Встреча прошла хорошо' });
  assert.equal(review.status, 201, JSON.stringify(review.data));
  const visibleReviews = await call('/api/reviews', buyerTelegramId, marker);
  assert(visibleReviews.data.items.some((item) => item.id === review.data.review.id));

  const rejectProduct = await prisma.product.create({ data: { storeId: store.id, title: `${marker} отказ`, priceAmount: 9000, condition: 'good', status: 'published', variants: { create: { size: 'XL', stockQuantity: 1 } } }, include: { variants: true } });
  productIds.push(rejectProduct.id);
  const second = await submit([{ productId: rejectProduct.id, variantId: rejectProduct.variants[0].id, quantity: 1 }]);
  assert.equal(second.status, 201, JSON.stringify(second.data));
  const rejected = await call(`/api/admin/${store.id}/orders/${second.data.order.id}/reject`, ownerId, ownerName, 'POST');
  assert.equal(rejected.status, 200, JSON.stringify(rejected.data));
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: rejectProduct.id } })).status, 'published');

  const thirdProduct = await prisma.product.create({ data: { storeId: store.id, title: `${marker} доставка`, priceAmount: 12000, condition: 'good', status: 'published', publishedAt: new Date(), variants: { create: { size: 'S', stockQuantity: 1 } } }, include: { variants: true } });
  productIds.push(thirdProduct.id);
  const incompleteDelivery = await call('/api/orders', buyerTelegramId, marker, 'POST', { items: [{ productId: thirdProduct.id, variantId: thirdProduct.variants[0].id, quantity: 1 }], buyerName: marker, deliveryMethod: 'cdek', consent: true, termsAccepted: true });
  assert.equal(incompleteDelivery.status, 400);
  const shipping = await call('/api/orders', buyerTelegramId, marker, 'POST', {
    items: [{ productId: thirdProduct.id, variantId: thirdProduct.variants[0].id, quantity: 1 }], buyerName: marker, buyerPhone: '+79991234567', buyerEmail: 'buyer@example.org',
    city: 'Москва', deliveryOptionId: 'smoke_point', deliveryMethod: 'cdek', consent: true, termsAccepted: true,
  });
  assert.equal(shipping.status, 201, JSON.stringify(shipping.data));
  const visible = await call(`/api/admin/${store.id}/orders`, ownerId, ownerName);
  assert(visible.data.items.some((item) => item.id === shipping.data.order.id && item.deliveryPoint === 'Тестовый ПВЗ' && item.deliveryPrice === 450 && item.deliveryLat === 55.758));

  const yandexProduct = await prisma.product.create({ data: { storeId: store.id, title: `${marker} Яндекс`, priceAmount: 13000, condition: 'good', status: 'published', publishedAt: new Date(), variants: { create: { size: 'M', stockQuantity: 1 } } }, include: { variants: true } });
  productIds.push(yandexProduct.id);
  const yandexRequest = { items: [{ productId: yandexProduct.id, variantId: yandexProduct.variants[0].id, quantity: 1 }], buyerName: marker, buyerPhone: '+79991234567', buyerEmail: 'buyer@example.org', city: 'Москва', deliveryOptionId: 'smoke_yandex', deliveryMethod: 'yandex_delivery', consent: true, termsAccepted: true };
  const yandex = await call('/api/orders', buyerTelegramId, marker, 'POST', yandexRequest);
  assert.equal(yandex.status, 201, JSON.stringify(yandex.data));
  assert.equal(yandex.data.order.deliveryPrice, 350);
  const disabledSettings = { ...(await prisma.store.findUniqueOrThrow({ where: { id: store.id } })).settings, deliveryMethods: ['meetup', 'cdek'] };
  await prisma.store.update({ where: { id: store.id }, data: { settings: disabledSettings } });
  assert.equal((await call('/api/orders', buyerTelegramId, marker, 'POST', yandexRequest)).status, 400, 'Отключённая доставка недоступна');

  const expiringProduct = await prisma.product.create({ data: { storeId: store.id, title: `${marker} срок оплаты`, priceAmount: 8000, condition: 'good', status: 'published', variants: { create: { size: 'M', stockQuantity: 1 } } }, include: { variants: true } });
  productIds.push(expiringProduct.id);
  const expiring = await submit([{ productId: expiringProduct.id, variantId: expiringProduct.variants[0].id, quantity: 1 }]);
  assert.equal(expiring.status, 201);
  await prisma.order.update({ where: { id: expiring.data.order.id }, data: { reservedUntil: new Date(Date.now() + 1000) } });
  assert.equal((await call(`/api/admin/${store.id}/orders/${expiring.data.order.id}/accept`, ownerId, ownerName, 'POST')).status, 200);
  const acceptedOrder = await prisma.order.findUniqueOrThrow({ where: { id: expiring.data.order.id } });
  assert(acceptedOrder.reservedUntil.getTime() > Date.now() + 60_000, 'Подтверждение продлевает бронь для оплаты');
  await prisma.order.update({ where: { id: acceptedOrder.id }, data: { reservedUntil: new Date(Date.now() - 1000) } });
  const { expireOverdueReservations } = await import('../dist/jobs/reservations.js');
  await expireOverdueReservations();
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: acceptedOrder.id } })).status, 'expired');
  assert.equal((await prisma.productVariant.findUniqueOrThrow({ where: { id: expiringProduct.variants[0].id } })).reservedQuantity, 0);

  console.log('OK: multi-item/size stock, chat, manual PVZ/tariff, payment receipt and confirmation, reject/complete, review');
} finally {
  if (buyer) {
    const receipts = await prisma.order.findMany({ where: { buyerId: buyer.id, storeId: store?.id }, select: { receiptFilename: true } });
    for (const receipt of receipts) if (receipt.receiptFilename) await fs.unlink(path.resolve(process.cwd(), '../.runtime/receipts', receipt.receiptFilename)).catch(() => undefined);
    await prisma.chatThread.deleteMany({ where: { storeId: store?.id, buyerId: buyer.id } });
    await prisma.order.deleteMany({ where: { buyerId: buyer.id, storeId: store?.id } });
    await prisma.user.delete({ where: { id: buyer.id } });
  }
  for (const filename of chatMediaFiles) await fs.unlink(filename).catch(() => undefined);
  for (const filename of uploadedFiles) await fs.unlink(filename).catch(() => undefined);
  if (otherBuyer) {
    await prisma.storeMember.deleteMany({ where: { storeId: store?.id, userId: otherBuyer.id } });
    await prisma.order.deleteMany({ where: { buyerId: otherBuyer.id, storeId: store?.id } });
    await prisma.user.delete({ where: { id: otherBuyer.id } });
  }
  if (productIds.length) await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  if (otherStore) await prisma.store.delete({ where: { id: otherStore.id } });
  if (store && previousSettings) await prisma.store.update({ where: { id: store.id }, data: { settings: previousSettings } });
  await prisma.$disconnect();
}
