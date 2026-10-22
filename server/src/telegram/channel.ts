import path from 'node:path';
import { InputFile } from 'grammy';
import type { Product, ProductImage } from '@prisma/client';
import { prisma } from '../db.js';
import { UPLOAD_DIR } from '../lib/upload.js';
import { presentStoreSettings } from '../lib/present.js';
import { bot, storeDeepLink } from './bot.js';

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

export async function publishProductToChannel(productId: string): Promise<void> {
  const product = await prisma.product.findUnique({ where: { id: productId }, include: { images: { orderBy: { sortOrder: 'asc' }, take: 1 }, store: true } });
  if (!product) return;
  const channel = presentStoreSettings(product.store).channelUsername;
  if (!channel || product.status !== 'published') return;
  if (product.channelPostId && product.channelPostChat === channel) return;
  try {
    if (!bot) throw new Error('Telegram-бот не настроен');
    const image = product.images[0]?.url;
    if (!image) throw new Error('У товара нет фотографии');
    const photo = image.startsWith('/uploads/') ? new InputFile(path.join(UPLOAD_DIR, path.basename(image))) : image;
    const settings = presentStoreSettings(product.store);
    const symbol = settings.currency === 'USD' ? '$' : settings.currency === 'BYN' ? 'Br' : '₽';
    const caption = `<b>${escapeHtml(product.title)}</b>\n${(product.priceAmount / 100).toLocaleString('ru-RU')} ${symbol}\n<a href="${storeDeepLink(product.store.slug)}">Открыть магазин</a>`;
    const message = await bot.api.sendPhoto(channel, photo, { caption, parse_mode: 'HTML' });
    await prisma.product.update({ where: { id: product.id }, data: { channelPostId: message.message_id, channelPostChat: channel, channelPostAt: new Date(), channelPostError: null } });
  } catch (error) {
    const message = (error as Error).message.slice(0, 300);
    await prisma.product.update({ where: { id: product.id }, data: { channelPostError: message } });
    console.warn('[channel] публикация не удалась:', message);
  }
}
