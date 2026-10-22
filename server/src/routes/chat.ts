import { Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import sharp from 'sharp';
import { z } from 'zod';
import { prisma } from '../db.js';
import { badRequest, h, notFound } from '../lib/http.js';
import { UPLOAD_DIR } from '../lib/upload.js';
import { authenticate } from '../middleware/auth.js';
import { chatMediaLimiter, orderLimiter } from '../middleware/rateLimit.js';
import { requireStoreMember, resolveStore } from '../middleware/store.js';
import { notifyBuyer, notifySeller } from '../telegram/notify.js';

export const chatRouter = Router();
export const adminChatRouter = Router();

const messageSchema = z.object({
  text: z.string().trim().max(2000).default(''),
  productId: z.string().optional(),
  mediaUrl: z.string().regex(/^\/chat-media\/[\w-]+\.(?:webp|mp4|webm|mov)$/).optional(),
  mediaType: z.enum(['image', 'video']).optional(),
}).refine((m) => Boolean(m.text || (m.mediaUrl && m.mediaType)), 'Напишите сообщение или приложите файл')
  .refine((m) => Boolean(m.mediaUrl) === Boolean(m.mediaType), 'Некорректное вложение')
  .refine((m) => !m.mediaUrl || (m.mediaType === 'image' ? m.mediaUrl.endsWith('.webp') : /\.(?:mp4|webm|mov)$/.test(m.mediaUrl)), 'Тип вложения не совпадает с файлом');

const chatMediaDir = path.resolve(process.cwd(), '../.runtime/chat-media');

export async function removeUnusedChatMedia(): Promise<number> {
  const entries = await fs.readdir(chatMediaDir, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  let removed = 0;
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (let offset = 0; offset < entries.length; offset += 100) {
    const candidates = (await Promise.all(entries.slice(offset, offset + 100).filter((entry) => entry.isFile() && /^[\w-]+\.(?:webp|mp4|webm|mov)$/.test(entry.name)).map(async (entry) => {
      const stat = await fs.stat(path.join(chatMediaDir, entry.name));
      return stat.mtimeMs < cutoff ? entry.name : null;
    }))).filter((name): name is string => Boolean(name));
    if (!candidates.length) continue;
    const used = await prisma.chatMessage.findMany({ where: { mediaUrl: { in: candidates.map((name) => `/chat-media/${name}`) } }, select: { mediaUrl: true } });
    const keep = new Set(used.map((message) => message.mediaUrl));
    for (const name of candidates) {
      if (keep.has(`/chat-media/${name}`)) continue;
      await fs.unlink(path.join(chatMediaDir, name)).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
      removed++;
    }
  }
  return removed;
}
const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'video/mp4', 'video/webm', 'video/quicktime'].includes(file.mimetype)) return cb(badRequest('Поддерживаются фото, MP4, WebM и MOV до 20 МБ'));
    cb(null, true);
  },
});

async function messages(threadId: string, userId: string, before?: string) {
  if (before && !(await prisma.chatMessage.findFirst({ where: { id: before, threadId }, select: { id: true } }))) {
    throw badRequest('Страница переписки не найдена');
  }
  const rows = await prisma.chatMessage.findMany({
    where: { threadId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 50,
    ...(before ? { cursor: { id: before }, skip: 1 } : {}),
    include: { product: { select: { id: true, title: true } } },
  });
  return {
    items: rows.reverse().map((m) => ({
      id: m.id, text: m.text, mediaUrl: m.mediaUrl, mediaType: m.mediaType,
      createdAt: m.createdAt, mine: m.senderId === userId, product: m.product,
    })),
    nextCursor: rows.length === 50 ? rows[0].id : null,
  };
}

chatRouter.use(authenticate, resolveStore());

chatRouter.post('/media', chatMediaLimiter, mediaUpload.single('file'), h(async (req, res) => {
  const file = req.file;
  if (!file) throw badRequest('Выберите фото или видео');
  const isImage = file.mimetype.startsWith('image/');
  const isMp4 = !isImage && file.buffer.subarray(4, 8).toString() === 'ftyp';
  const isWebm = !isImage && file.buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  if (!isImage && !(isMp4 || isWebm)) throw badRequest('Файл не является видео MP4, MOV или WebM');
  let buffer = file.buffer;
  if (isImage) {
    try { buffer = await sharp(file.buffer, { failOn: 'error' }).rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer(); }
    catch { throw badRequest('Не удалось прочитать фото'); }
  }
  await fs.mkdir(chatMediaDir, { recursive: true, mode: 0o700 });
  const disk = await fs.statfs(chatMediaDir);
  if (disk.bavail * disk.bsize < 1024 ** 3 + file.size) throw badRequest('На сервере недостаточно места для вложения');
  const extension = isImage ? 'webp' : isWebm ? 'webm' : file.mimetype === 'video/quicktime' ? 'mov' : 'mp4';
  const name = `${req.auth!.user.id}_${crypto.randomUUID()}.${extension}`;
  await fs.writeFile(path.join(chatMediaDir, name), buffer, { flag: 'wx', mode: 0o600 });
  res.status(201).json({ url: `/chat-media/${name}`, mediaType: isImage ? 'image' : 'video' });
}));

chatRouter.get('/media/:id', h(async (req, res) => {
  const message = await prisma.chatMessage.findFirst({ where: { id: req.params.id, thread: { storeId: req.store!.id } }, include: { thread: true } });
  if (!message?.mediaUrl) throw notFound('Вложение не найдено');
  if (message.thread.buyerId !== req.auth!.user.id) {
    const member = await prisma.storeMember.findUnique({ where: { storeId_userId: { storeId: req.store!.id, userId: req.auth!.user.id } } });
    if (!member) throw notFound('Вложение не найдено');
  }
  const legacy = message.mediaUrl.startsWith('/uploads/');
  if (!legacy && !message.mediaUrl.startsWith('/chat-media/')) throw notFound('Вложение не найдено');
  const filename = path.basename(message.mediaUrl);
  if (!/^[\w-]+\.(?:webp|mp4|webm|mov)$/.test(filename)) throw notFound('Вложение не найдено');
  res.setHeader('Cache-Control', 'private, no-store');
  res.sendFile(path.join(legacy ? UPLOAD_DIR : chatMediaDir, filename), (error) => {
    if (error && !res.headersSent) res.status(404).end();
  });
}));

chatRouter.get('/', h(async (req, res) => {
  const thread = await prisma.chatThread.findUnique({
    where: { storeId_buyerId: { storeId: req.store!.id, buyerId: req.auth!.user.id } },
  });
  res.json(thread ? await messages(thread.id, req.auth!.user.id, req.query.before as string | undefined) : { items: [], nextCursor: null });
}));

chatRouter.post('/', orderLimiter, h(async (req, res) => {
  const data = messageSchema.parse(req.body);
  const storeId = req.store!.id;
  if (data.mediaUrl) {
    if (!path.basename(data.mediaUrl).startsWith(`${req.auth!.user.id}_`)) throw badRequest('Это вложение другого пользователя');
    await fs.stat(path.join(chatMediaDir, path.basename(data.mediaUrl))).catch(() => { throw badRequest('Вложение не найдено'); });
  }
  if (data.productId) {
    const product = await prisma.product.findFirst({ where: { id: data.productId, storeId, status: { in: ['published', 'reserved', 'sold'] } }, select: { id: true } });
    if (!product) throw notFound('Товар не найден в этом магазине');
  }
  const thread = await prisma.chatThread.upsert({
    where: { storeId_buyerId: { storeId, buyerId: req.auth!.user.id } },
    create: { storeId, buyerId: req.auth!.user.id },
    update: {},
  });
  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.chatMessage.create({ data: {
      threadId: thread.id, senderId: req.auth!.user.id, productId: data.productId ?? null,
      text: data.text, mediaUrl: data.mediaUrl ?? null, mediaType: data.mediaType ?? null,
    } });
    await tx.chatThread.update({ where: { id: thread.id }, data: { updatedAt: new Date() } });
    return created;
  });
  const members = await prisma.storeMember.findMany({ where: { storeId }, include: { user: true } });
  for (const member of members) {
    if (member.userId !== req.auth!.user.id) notifySeller.newChatMessage(member.user.telegramId, req.store!.name, req.store!.slug, req.auth!.user.id);
  }
  res.status(201).json({ id: message.id });
}));

adminChatRouter.use('/:storeId', authenticate, requireStoreMember);

adminChatRouter.get('/:storeId/chats', h(async (req, res) => {
  const threads = await prisma.chatThread.findMany({
    where: { storeId: req.store!.id }, orderBy: { updatedAt: 'desc' }, take: 100,
    include: {
      buyer: { select: { id: true, firstName: true, lastName: true, username: true, avatarUrl: true } },
      messages: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1, select: { text: true, mediaType: true, product: { select: { id: true, title: true } } } },
    },
  });
  res.json({ items: threads.map((t) => ({ buyer: t.buyer, updatedAt: t.updatedAt, preview: t.messages[0]?.text || (t.messages[0]?.mediaType === 'video' ? 'Видео' : t.messages[0]?.mediaType === 'image' ? 'Фото' : ''), product: t.messages[0]?.product ?? null })) });
}));

adminChatRouter.get('/:storeId/chats/:buyerId', h(async (req, res) => {
  const thread = await prisma.chatThread.findUnique({
    where: { storeId_buyerId: { storeId: req.store!.id, buyerId: req.params.buyerId } },
    include: { buyer: { select: { firstName: true, lastName: true, username: true } } },
  });
  if (!thread) {
    const order = await prisma.order.findFirst({ where: { storeId: req.store!.id, buyerId: req.params.buyerId }, include: { buyer: { select: { firstName: true, lastName: true, username: true } } } });
    if (!order) throw notFound('Диалог не найден');
    return res.json({ items: [], nextCursor: null, participantName: [order.buyer.firstName, order.buyer.lastName].filter(Boolean).join(' ') || (order.buyer.username ? `@${order.buyer.username}` : 'Покупатель') });
  }
  res.json({ ...(await messages(thread.id, req.auth!.user.id, req.query.before as string | undefined)), participantName: [thread.buyer.firstName, thread.buyer.lastName].filter(Boolean).join(' ') || (thread.buyer.username ? `@${thread.buyer.username}` : 'Покупатель') });
}));

adminChatRouter.post('/:storeId/chats/:buyerId', orderLimiter, h(async (req, res) => {
  const { text, mediaUrl, mediaType, productId } = messageSchema.parse(req.body);
  if (mediaUrl) {
    if (!path.basename(mediaUrl).startsWith(`${req.auth!.user.id}_`)) throw badRequest('Это вложение другого пользователя');
    await fs.stat(path.join(chatMediaDir, path.basename(mediaUrl))).catch(() => { throw badRequest('Вложение не найдено'); });
  }
  let thread = await prisma.chatThread.findUnique({
    where: { storeId_buyerId: { storeId: req.store!.id, buyerId: req.params.buyerId } },
    include: { buyer: true },
  });
  if (!thread) {
    const order = await prisma.order.findFirst({ where: { storeId: req.store!.id, buyerId: req.params.buyerId }, select: { id: true } });
    if (!order) throw notFound('Диалог не найден');
    thread = await prisma.chatThread.upsert({
      where: { storeId_buyerId: { storeId: req.store!.id, buyerId: req.params.buyerId } },
      create: { storeId: req.store!.id, buyerId: req.params.buyerId }, update: {}, include: { buyer: true },
    });
  }
  if (productId) {
    const product = await prisma.product.findFirst({ where: { id: productId, storeId: req.store!.id }, select: { id: true } });
    if (!product) throw notFound('Товар не найден в этом магазине');
  }
  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.chatMessage.create({ data: { threadId: thread.id, senderId: req.auth!.user.id, productId: productId ?? null, text, mediaUrl: mediaUrl ?? null, mediaType: mediaType ?? null } });
    await tx.chatThread.update({ where: { id: thread.id }, data: { updatedAt: new Date() } });
    return created;
  });
  notifyBuyer.newChatMessage(thread.buyer.telegramId, req.store!.name, req.store!.slug);
  res.status(201).json({ id: message.id });
}));
