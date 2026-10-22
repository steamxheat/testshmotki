import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import sharp from 'sharp';

const prisma = new PrismaClient();
const base = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:4050';
const marker = `catalog-smoke-${crypto.randomUUID().slice(0, 8)}`;
const ids = [BigInt(9_000_000_000_000 + crypto.randomInt(1_000_000_000)), BigInt(9_000_000_000_000 + crypto.randomInt(1_000_000_000)), BigInt(9_000_000_000_000 + crypto.randomInt(1_000_000_000))];
let store;
const users = [];
let videoFile;
let productImage;

async function call(route, telegramId, method = 'GET', body) {
  const url = new URL(route, base);
  url.searchParams.set('store', store.slug);
  const response = await fetch(url, { method, headers: {
    'Content-Type': 'application/json', 'X-Dev-User': Buffer.from(JSON.stringify({ id: String(telegramId), first_name: marker })).toString('base64'),
    'X-Store-Slug': store.slug,
  }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, data: await response.json() };
}

try {
  for (const telegramId of ids) users.push(await prisma.user.create({ data: { telegramId, firstName: marker } }));
  store = await prisma.store.create({ data: { slug: marker, name: marker, settings: { currency: 'USD' }, members: { create: { userId: users[0].id, role: 'owner' } }, categories: { create: { name: 'Тест' } } }, include: { categories: true } });
  const categoryId = store.categories[0].id;
  const owner = ids[0], matchingBuyer = ids[1], otherBuyer = ids[2];
  const imageForm = new FormData();
  imageForm.append('files', new Blob([await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ffffff' } }).png().toBuffer()], { type: 'image/png' }), 'product.png');
  const imageUpload = await fetch(`${base}/api/uploads?store=${store.slug}&purpose=store`, { method: 'POST', headers: { 'X-Dev-User': Buffer.from(JSON.stringify({ id: String(owner), first_name: marker })).toString('base64') }, body: imageForm });
  const uploadedImage = await imageUpload.json();
  assert.equal(imageUpload.status, 200, JSON.stringify(uploadedImage));
  productImage = uploadedImage.urls[0];
  assert.equal((await call('/api/subscriptions', matchingBuyer, 'PUT', { newArrivals: true, priceDrops: true, categoryIds: [], brands: ['Acme'], sizes: [] })).status, 200);
  assert.equal((await call('/api/subscriptions', otherBuyer, 'PUT', { newArrivals: true, priceDrops: true, categoryIds: [], brands: ['Other'], sizes: [] })).status, 200);
  assert.equal((await call('/api/subscriptions', matchingBuyer, 'PUT', { newArrivals: true, priceDrops: true, categoryIds: ['wrong-store'], brands: [], sizes: [] })).status, 400);
  const productBody = { title: `${marker} jacket`, categoryId, price: 100, condition: 'good', brand: 'Acme', gender: 'unisex', material: 'Хлопок', measurements: 'Длина 68 см', defects: 'Затяжка', defectImages: [productImage], videoUrl: null, variants: [{ size: 'M', stock: 2 }], images: [productImage], publish: true };
  assert.equal((await call(`/api/admin/${store.id}/products`, owner, 'POST', { ...productBody, images: ['https://example.org/item.png'] })).status, 400, 'Внешние фото товара запрещены');
  assert.equal((await call(`/api/admin/${store.id}/settings`, owner, 'PATCH', { settings: { socialLinks: { vk: 'javascript:alert(1)' } } })).status, 400, 'Небезопасная ссылка соцсети запрещена');
  const created = await call(`/api/admin/${store.id}/products`, owner, 'POST', productBody);
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const product = created.data.product;
  assert.equal(product.material, 'Хлопок');
  assert.equal(product.defectImages.length, 1);
  assert.equal((await call(`/api/catalog/product/${product.id}`, matchingBuyer)).data.product.measurements, 'Длина 68 см');
  assert.equal(await prisma.botNotification.count({ where: { telegramId: matchingBuyer, storeSlug: marker } }), 1);
  assert.equal(await prisma.botNotification.count({ where: { telegramId: otherBuyer, storeSlug: marker } }), 0);
  const discounted = await call(`/api/admin/${store.id}/products/bulk-price`, owner, 'POST', { ids: [product.id], percent: -20 });
  assert.equal(discounted.status, 200, JSON.stringify(discounted.data));
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).priceAmount, 8000);
  assert.equal(await prisma.botNotification.count({ where: { telegramId: matchingBuyer, storeSlug: marker } }), 2);
  const locked = await call(`/api/admin/${store.id}/settings`, owner, 'PATCH', { settings: { currency: 'BYN' } });
  assert.equal(locked.status, 409, 'После первой карточки смена валюты запрещена');
  const second = await call(`/api/admin/${store.id}/products`, owner, 'POST', { ...productBody, title: `${marker} hat`, brand: 'Other', price: 50 });
  assert.equal(second.status, 201);
  await prisma.event.createMany({ data: [1, 2, 3].map(() => ({ storeId: store.id, userId: users[1].id, productId: second.data.product.id, type: 'product_view' })) });
  const popular = await call('/api/catalog?sort=popular', matchingBuyer);
  assert.equal(popular.data.items[0].id, second.data.product.id);
  assert.equal((await call(`/api/admin/${store.id}/products/bulk-status`, owner, 'POST', { ids: [product.id], status: 'draft' })).status, 200);
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).status, 'draft');
  assert.equal((await call(`/api/admin/${store.id}/products/bulk-status`, owner, 'POST', { ids: [product.id], status: 'published' })).status, 200);
  assert.equal(await prisma.botNotification.count({ where: { telegramId: matchingBuyer, storeSlug: marker } }), 2, 'Повторная публикация не дублирует новинку');
  assert.equal((await call(`/api/admin/${store.id}/overview`, owner)).status, 200);
  const video = Buffer.from([0, 0, 0, 16, 102, 116, 121, 112, 113, 116, 32, 32, 0, 0, 0, 0]);
  const form = new FormData();
  form.append('file', new Blob([video], { type: 'video/quicktime' }), 'clip.mov');
  const uploadResponse = await fetch(`${base}/api/product-video?store=${marker}`, { method: 'POST', headers: { 'X-Dev-User': Buffer.from(JSON.stringify({ id: String(owner), first_name: marker })).toString('base64') }, body: form });
  const uploaded = await uploadResponse.json();
  assert.equal(uploadResponse.status, 201, JSON.stringify(uploaded));
  assert(uploaded.url.endsWith('.mov'));
  videoFile = path.resolve(process.cwd(), 'uploads', path.basename(uploaded.url));
  assert.equal((await call(`/api/admin/${store.id}/channel/status`, owner)).data.ready, false);
  console.log('OK: product fields/video, subscriptions and alerts, bulk price/status, popular sort, currency lock, overview');
} finally {
  if (videoFile) await fs.unlink(videoFile).catch(() => undefined);
  if (productImage) await Promise.all([productImage, productImage.replace('.webp', '_thumb.webp')].map((url) => fs.unlink(path.resolve(process.cwd(), 'uploads', path.basename(url))).catch(() => undefined)));
  await prisma.botNotification.deleteMany({ where: { telegramId: { in: ids } } });
  if (store) await prisma.store.delete({ where: { id: store.id } });
  for (const user of users) await prisma.user.delete({ where: { id: user.id } });
  await prisma.$disconnect();
}
